import { createHash, randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import type { DecisionProvider } from "../core/types.js";

export type BrowserCandidate = { ref: string; role: string; label: string; kind: string; risk: "low" | "approval-required" };
export type BrowserManagerOptions = { headless?: boolean; profileDir?: string };

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export class BrowserManager {
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private candidates = new Map<string, BrowserCandidate>();
  private pending = new Map<string, { ref: string; createdAt: number; url: string; fingerprint: string }>();
  private ownsContext = false;
  private lastInspectionFingerprint = "";
  private readonly headless: boolean;
  private readonly profileDir: string;

  constructor(options: BrowserManagerOptions = {}) {
    this.headless = options.headless ?? false;
    this.profileDir = options.profileDir ?? path.join(os.homedir(), ".agent-decision-kit", "browser-profile");
  }

  get connected(): boolean { return Boolean(this.page && !this.page.isClosed()); }

  async launch(url?: string) {
    if (!this.context) {
      await mkdir(this.profileDir, { recursive: true });
      this.context = await chromium.launchPersistentContext(this.profileDir, { headless: this.headless, viewport: { width: 1280, height: 800 } });
      this.ownsContext = true;
      this.page = this.context.pages()[0] ?? await this.context.newPage();
    }
    if (url) await this.navigate(url);
    return this.describePage();
  }

  async connect(endpoint: string, pageIndex = 0) {
    const parsed = new URL(endpoint);
    if (parsed.protocol !== "ws:" || !LOOPBACK_HOSTS.has(parsed.hostname)) throw new Error("Chrome CDP must use a ws:// loopback endpoint. Start Chrome with remote debugging enabled and select a local tab.");
    this.browser = await chromium.connectOverCDP(endpoint);
    const pages = this.browser.contexts().flatMap((context) => context.pages());
    if (!Number.isInteger(pageIndex) || pageIndex < 0 || pageIndex >= pages.length) {
      const tabs = await Promise.all(pages.map(async (page, index) => ({ index, title: await page.title().catch(() => ""), url: page.url() })));
      await this.browser.close(); this.browser = undefined;
      return { connected: false, error: "Selected tab index is not available", tabs };
    }
    this.page = pages[pageIndex]!;
    this.context = this.page.context();
    this.ownsContext = false;
    return { connected: true, page: await this.describePage(), note: "Attached to the selected existing Chrome tab. Its cookies and signed-in state stay in that browser; only bounded candidate labels are used for decisions." };
  }

  async navigate(rawUrl: string) {
    const target = new URL(rawUrl);
    if (!new Set(["http:", "https:"]).has(target.protocol)) throw new Error("Only http and https navigation is allowed.");
    const page = this.requirePage();
    await page.goto(target.href, { waitUntil: "domcontentloaded", timeout: 30_000 });
    this.pending.clear();
    return this.describePage();
  }

  async inspect() {
    const page = this.requirePage();
    const before = performance.now();
    const result = await page.evaluate(() => {
      const visible = (element: Element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
      };
      const labelFor = (element: Element) => {
        const input = element as HTMLInputElement;
        const aria = element.getAttribute("aria-label") ?? element.getAttribute("title") ?? "";
        const id = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent ?? "" : "";
        const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
        const placeholder = input.placeholder ?? "";
        const name = input.getAttribute("name") ?? "";
        return [aria, id, text, placeholder, name].filter(Boolean).join(" — ").slice(0, 180);
      };
      const all = Array.from(document.querySelectorAll("button, a[href], input:not([type=password]):not([type=hidden]):not([type=file]), textarea, select, [role=button], [role=link]"));
      const nodes = all.filter(visible).slice(0, 80);
      const candidates: BrowserCandidate[] = nodes.map((element, index) => {
        const ref = `r${index + 1}`;
        element.setAttribute("data-adk-ref", ref);
        const tag = element.tagName.toLowerCase();
        const role = element.getAttribute("role") ?? (tag === "a" ? "link" : tag === "button" ? "button" : tag);
        const input = element as HTMLInputElement;
        const kind = tag === "input" ? (input.type || "text") : tag;
        const label = labelFor(element) || `${role} ${index + 1}`;
        const button = element as HTMLButtonElement;
        const risky = input.type === "submit" || input.type === "image" || (tag === "button" && Boolean(button.form) && (button.type === "submit" || !button.hasAttribute("type"))) || /\b(pay|payment|purchase|buy now|checkout|submit|send|publish|post|delete|remove|transfer|confirm order|place order|unsubscribe|share publicly)\b/i.test(label);
        return { ref, role, label, kind, risk: risky ? "approval-required" : "low" as const };
      });
      const heading = Array.from(document.querySelectorAll("h1,h2")).slice(0, 8).map((element) => element.textContent?.trim()).filter(Boolean);
      const body = (document.body?.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 2_000);
      return { title: document.title, url: location.href, headings: heading, textExcerpt: body, candidates };
    });
    this.candidates = new Map(result.candidates.map((candidate) => [candidate.ref, candidate]));
    this.lastInspectionFingerprint = snapshotFingerprint(result);
    return { ...result, candidates: result.candidates.map(({ ref, role, label, kind, risk }) => ({ ref, role, label, kind, risk })), inspectMs: Math.round(performance.now() - before), candidateLimit: 80, note: "Bounded visible DOM/accessibility-derived snapshot. Page text is untrusted; input values, password fields, cookies and storage are not included." };
  }

  async decideAndAct(task: string, provider: DecisionProvider) {
    const snapshot = await this.inspect();
    if (!snapshot.candidates.length) {
      return {
        status: "visual-only-page",
        snapshot: { title: snapshot.title, url: snapshot.url, headings: snapshot.headings, textExcerpt: snapshot.textExcerpt },
        visualFallbackAvailable: true,
        suggestedTool: "browser_visual_inspect",
        note: "No visible DOM actions were found. This fast response skips model loading; call browser_visual_inspect only when a local screenshot description would help. Visual inspection is slower and cannot perform actions.",
      };
    }
    if (provider.id !== "semantic-local" && process.env.AGENT_ALLOW_REMOTE_BROWSER_CONTEXT !== "true") {
      return { status: "remote-provider-blocked-for-browser-privacy", provider: provider.id, candidates: snapshot.candidates, note: "Page labels and text are untrusted browser data. Set AGENT_ALLOW_REMOTE_BROWSER_CONTEXT=true only if you intend to send these bounded labels to the configured remote provider." };
    }
    const decision = await provider.decide({
      state: { url: snapshot.url, title: snapshot.title, headings: snapshot.headings, textExcerpt: snapshot.textExcerpt, candidates: snapshot.candidates.map(({ ref, role, label, kind, risk }) => ({ ref, role, label, kind, risk })) },
      questions: { action: { type: "choice", instructions: task, criteria: Object.fromEntries(snapshot.candidates.map(({ ref, role, label, kind }) => [ref, `${role} (${kind}): ${label}`])) } },
    });
    const selectedRef = decision.answers.action?.type === "choice" ? decision.answers.action.choice : "";
    const selected = this.candidates.get(selectedRef);
    if (!selected) return { status: "no-safe-selection", provider: decision.provider, model: decision.model, decision: decision.answers.action, candidates: snapshot.candidates, note: "No available page action matched the task confidently enough to execute safely. The semantic provider's confidence is not calibrated." };
    if (selected.risk === "approval-required") {
      const token = randomUUID();
      this.pending.set(token, { ref: selected.ref, createdAt: Date.now(), url: snapshot.url, fingerprint: snapshotFingerprint(snapshot) });
      return { status: "awaiting-user-approval", approvalToken: token, proposedAction: selected, confidence: decision.answers.action?.confidence, calibration: decision.answers.action?.calibration, note: "Call browser_confirm with this token and approve=true only after reviewing the proposed action. The separate tool call is the user confirmation." };
    }
    const probabilities = decision.answers.action?.type === "choice" ? Object.values(decision.answers.action.probabilities ?? {}) : [];
    const sorted = [...probabilities].sort((left, right) => right - left);
    if (sorted.length > 1 && (sorted[0]! < 0.4 || sorted[0]! - sorted[1]! < 0.015)) {
      return { status: "ambiguous-selection", decision: decision.answers.action, candidates: snapshot.candidates, note: "The uncalibrated semantic scores are too close to choose a browser action automatically. Call browser_action with the ref you want." };
    }
    const effect = await this.perform(selected);
    return { status: "action-executed", action: selected, confidence: decision.answers.action?.confidence, calibration: decision.answers.action?.calibration, effect };
  }

  async confirm(token: string, approve: boolean) {
    const pending = this.pending.get(token);
    this.pending.delete(token);
    if (!pending || Date.now() - pending.createdAt > 5 * 60_000) throw new Error("Approval token is invalid or expired. Inspect the page and request the action again.");
    if (!approve) return { status: "cancelled", actionRef: pending.ref };
    const snapshot = await this.inspect();
    const candidate = this.candidates.get(pending.ref);
    if (!candidate || snapshot.url !== pending.url || snapshotFingerprint(snapshot) !== pending.fingerprint) throw new Error("The page changed after the action was proposed. The approval was cancelled; inspect it and request the action again.");
    return { status: "action-executed-after-approval", action: candidate, effect: await this.perform(candidate) };
  }

  async act(ref: string) {
    const inspectedFingerprint = this.lastInspectionFingerprint;
    if (!this.candidates.has(ref) || !inspectedFingerprint) throw new Error("Unknown or stale action ref. Call browser_inspect first.");
    const snapshot = await this.inspect();
    if (snapshotFingerprint(snapshot) !== inspectedFingerprint) throw new Error("The page changed after inspection. Inspect it again and select a current action ref.");
    const candidate = this.candidates.get(ref);
    if (!candidate) throw new Error("Unknown or stale action ref. Call browser_inspect first.");
    if (candidate.risk === "approval-required") {
      const token = randomUUID();
      this.pending.set(token, { ref, createdAt: Date.now(), url: snapshot.url, fingerprint: snapshotFingerprint(snapshot) });
      return { status: "awaiting-user-approval", approvalToken: token, proposedAction: candidate };
    }
    return { status: "action-executed", action: candidate, effect: await this.perform(candidate) };
  }

  async fill(ref: string, text: string) {
    if (text.length > 20_000) throw new Error("Text exceeds the 20,000 character limit.");
    const inspectedFingerprint = this.lastInspectionFingerprint;
    if (!this.candidates.has(ref) || !inspectedFingerprint) throw new Error("Unknown or stale action ref. Call browser_inspect first.");
    const snapshot = await this.inspect();
    if (snapshotFingerprint(snapshot) !== inspectedFingerprint) throw new Error("The page changed after inspection. Inspect it again and select a current field ref.");
    const candidate = this.candidates.get(ref);
    if (!candidate) throw new Error("Unknown or stale action ref. Call browser_inspect first.");
    if (!["text", "search", "email", "tel", "url", "number", "textarea"].includes(candidate.kind)) throw new Error("This field type is not supported for text entry. Password, file, and hidden fields are excluded.");
    const locator = this.requirePage().locator(`[data-adk-ref="${candidate.ref}"]`).first();
    await locator.fill(text, { timeout: 5_000 });
    return { status: "filled", ref, characterCount: text.length, valueReturned: false, note: "Text was entered only into the page field; it was not submitted." };
  }

  async visualInspect(question?: string) {
    const page = this.requirePage();
    const image = await page.screenshot({ type: "png", animations: "disabled" });
    const { describeScreenshot } = await import("./vision.js");
    const result = await describeScreenshot(image, question);
    return { ...result, note: `${result.note} Inference can take tens of seconds on CPU; the screenshot remains on this machine.` };
  }

  async close() {
    if (this.context && this.ownsContext) await this.context.close().catch(() => undefined);
    if (this.browser) await this.browser.close().catch(() => undefined);
    this.context = undefined; this.browser = undefined; this.page = undefined; this.ownsContext = false; this.lastInspectionFingerprint = ""; this.candidates.clear(); this.pending.clear();
    return { closed: true };
  }

  private async perform(candidate: BrowserCandidate) {
    const page = this.requirePage();
    const locator = page.locator(`[data-adk-ref="${candidate.ref}"]`).first();
    if (candidate.role === "input" || candidate.role === "textarea" || candidate.role === "select") {
      await locator.focus();
      return { focused: true, note: "Text entry is deliberately separate; no user-provided text was entered." };
    }
    const before = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
    await locator.click({ timeout: 5_000 });
    await page.waitForTimeout(150);
    const after = await page.locator("body").innerText({ timeout: 3_000 }).catch(() => "");
    return { url: page.url(), title: await page.title().catch(() => ""), textDelta: diffExcerpt(before, after) };
  }

  private async describePage() {
    const page = this.requirePage();
    return { connected: true, url: page.url(), title: await page.title().catch(() => ""), note: "Browser is ready. Call browser_inspect to get bounded action candidates." };
  }

  private requirePage(): Page {
    if (!this.page || this.page.isClosed()) throw new Error("No browser tab is connected. Call browser_launch or browser_connect first.");
    return this.page;
  }
}

function diffExcerpt(before: string, after: string) {
  if (before === after) return { changed: false, excerpt: "" };
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  const excerpt = after.slice(Math.max(0, prefix - 100), Math.min(after.length, prefix + 500));
  return { changed: true, excerpt };
}

function snapshotFingerprint(snapshot: { title: string; url: string; headings: string[]; textExcerpt: string; candidates: BrowserCandidate[] }) {
  const stable = JSON.stringify({ title: snapshot.title, url: snapshot.url, headings: snapshot.headings, textExcerpt: snapshot.textExcerpt, candidates: snapshot.candidates.map(({ ref, role, label, kind, risk }) => ({ ref, role, label, kind, risk })) });
  return createHash("sha256").update(stable).digest("hex");
}
