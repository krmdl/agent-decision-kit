import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BrowserManager } from "../src/browser/manager.js";
import type { DecisionProvider } from "../src/core/types.js";

describe("Playwright browser safety flow", () => {
  let server: Server;
  let baseUrl = "";
  let profile = "";
  let browser: BrowserManager;
  let visualHtml: Buffer;
  let checkboxHtml: Buffer;
  let submitHtml: Buffer;
  let checkboxTaskHtml: Buffer;
  let tabHtml: Buffer;
  let expandHtml: Buffer;

  beforeAll(async () => {
    const html = await readFile(path.resolve("examples/browser-demo.html"));
    visualHtml = await readFile(path.resolve("examples/visual-only-demo.html"));
    checkboxHtml = Buffer.from('<!doctype html><label><input type="checkbox" name="updates"> Receive product updates</label>');
    submitHtml = Buffer.from('<!doctype html><form onsubmit="event.preventDefault(); document.querySelector(\'#status\').textContent = \'Submitted locally\'"><input type="submit" value="Send test"></form><p id="status">Not sent</p>');
    checkboxTaskHtml = Buffer.from('<!doctype html><form id="sample" onsubmit="event.preventDefault(); document.querySelector(\'#status\').textContent = \'Submitted locally\'"><label><input type="checkbox" name="target"> Neb</label><button type="submit">Submit</button></form><p id="status">Not sent</p>');
    tabHtml = Buffer.from('<!doctype html><div role="tab">Tab #1</div><div role="tab">Tab #2</div><div role="tab">Tab #3</div>');
    expandHtml = Buffer.from('<!doctype html><button id="toggle" aria-expanded="false" aria-controls="details">Section details</button><div id="details" hidden><p role="tab" aria-expanded="false">Submit</p><form onsubmit="event.preventDefault(); document.querySelector(\'#status\').textContent = \'Submitted locally\'"><button type="submit">Submit</button></form></div><p id="status">Not sent</p><script>document.querySelector(\'#toggle\').addEventListener(\'click\',e=>{const open=e.currentTarget.getAttribute(\'aria-expanded\')!==\'true\';e.currentTarget.setAttribute(\'aria-expanded\',String(open));document.querySelector(\'#details\').hidden=!open;location.hash=\'details\'})</script>');
    server = createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(request.url === "/visual-only" ? visualHtml : request.url === "/checkbox" ? checkboxHtml : request.url === "/submit" ? submitHtml : request.url === "/checkbox-task" ? checkboxTaskHtml : request.url === "/tabs" ? tabHtml : request.url === "/expand" ? expandHtml : html);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Unable to start local browser demo server");
    baseUrl = `http://127.0.0.1:${address.port}/`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(async () => {
    await browser?.close();
    if (profile) await rm(profile, { recursive: true, force: true });
  });

  it("inspects accessible controls, fills a draft locally, and gates a delete action", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(baseUrl);
    const snapshot = await browser.inspect();
    const complete = snapshot.candidates.find((item) => item.label.includes("Mark setup task complete"));
    const remove = snapshot.candidates.find((item) => item.label === "Delete draft");
    const draft = snapshot.candidates.find((item) => item.label.includes("Release note draft"));
    expect(complete?.risk).toBe("low");
    expect(remove?.risk).toBe("approval-required");
    expect(draft?.kind).toBe("text");

    const filled = await browser.fill(draft!.ref, "Safe test-only draft");
    expect(filled).toMatchObject({ status: "filled", valueReturned: false });
    expect(JSON.stringify(filled)).not.toContain("Safe test-only draft");

    const proposed = await browser.act(remove!.ref);
    expect(proposed.status).toBe("awaiting-user-approval");
    const token = "approvalToken" in proposed ? proposed.approvalToken : "";
    const clicked = await browser.act(complete!.ref);
    expect(clicked.status).toBe("action-executed");
    await expect(browser.confirm(token, true)).rejects.toThrow("The page changed after the action was proposed");

    const updated = await browser.inspect();
    expect(updated.candidates.some((item) => item.label === "Setup task complete")).toBe(true);
  }, 45_000);

  it("returns a visual-only page without loading the slower vision model", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-visual-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}visual-only`);
    const provider: DecisionProvider = {
      id: "semantic-local",
      model: "unused-test-provider",
      decide: async () => { throw new Error("A page without DOM actions must not ask the decision provider"); },
    };

    const result = await browser.decideAndAct("Open the task", provider);
    expect(result.status).toBe("visual-only-page");
    expect(result.visualFallbackAvailable).toBe(true);
    expect(result.suggestedTool).toBe("browser_visual_inspect");
    expect("visual" in result).toBe(false);
  }, 45_000);

  it("clicks a visible checkbox without submitting its form", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-checkbox-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}checkbox`);

    const snapshot = await browser.inspect();
    const checkbox = snapshot.candidates.find((candidate) => candidate.kind === "checkbox");
    expect(checkbox?.label).toContain("Currently unchecked");

    const result = await browser.act(checkbox!.ref);
    expect(result.status).toBe("action-executed");
    expect(result.effect.checked).toBe(true);
  }, 45_000);

  it("uses an exact quoted visible label locally and still gates a risky action", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-label-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(baseUrl);
    const provider: DecisionProvider = {
      id: "remote-test-provider",
      model: "unused-test-provider",
      decide: async () => { throw new Error("A unique quoted label should resolve locally"); },
    };

    const result = await browser.decideAndAct('Click the "Delete draft" button', provider);
    expect(result.status).toBe("awaiting-user-approval");
    expect(result.selectionRule).toBe("unique-exact-quoted-label");
    expect(result.confidence).toBeNull();
    expect(result.calibration).toBe("not-applicable-rule");
  }, 45_000);

  it("executes a submit input only after the separate approval call", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-submit-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}submit`);

    const snapshot = await browser.inspect();
    const submit = snapshot.candidates.find((candidate) => candidate.kind === "submit");
    expect(submit?.risk).toBe("approval-required");

    const proposed = await browser.act(submit!.ref);
    expect(proposed.status).toBe("awaiting-user-approval");
    const token = "approvalToken" in proposed ? proposed.approvalToken : "";
    const result = await browser.confirm(token, true);
    expect(result.status).toBe("action-executed-after-approval");
    expect(result.effect.textDelta.excerpt).toContain("Submitted locally");
  }, 45_000);

  it("matches an explicitly numbered ARIA tab without calling a provider", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-tab-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}tabs`);
    const provider: DecisionProvider = {
      id: "remote-test-provider",
      model: "unused-test-provider",
      decide: async () => { throw new Error("An explicit tab number should resolve locally"); },
    };

    const result = await browser.decideAndAct("Click on Tab #2.", provider);
    expect(result.status).toBe("action-executed");
    expect(result.selectionRule).toBe("explicit-tab-number");
    expect(result.action.label).toBe("Tab #2");
  }, 45_000);

  it("selects requested checkboxes in order, then pauses for submit approval", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-checkbox-task-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}checkbox-task`);
    const provider: DecisionProvider = {
      id: "remote-test-provider",
      model: "unused-test-provider",
      decide: async () => { throw new Error("A named checkbox and follow-up submit should resolve locally"); },
    };

    const checkbox = (await browser.inspect()).candidates.find((candidate) => candidate.kind === "checkbox");
    expect(checkbox?.label).toContain("Neb");
    expect(checkbox?.checked).toBe(false);

    const first = await browser.decideAndAct("Select Neb and click Submit.", provider);
    expect(first.status).toBe("action-executed");
    expect(first.selectionRule).toBe("explicit-checkbox-target");
    expect(first.effect.checked).toBe(true);

    const second = await browser.decideAndAct("Select Neb and click Submit.", provider);
    expect(second.status).toBe("awaiting-user-approval");
    expect(second.selectionRule).toBe("checkbox-targets-then-submit");
    const token = "approvalToken" in second ? second.approvalToken : "";
    const final = await browser.confirm(token, true);
    expect(final.status).toBe("action-executed-after-approval");
    expect(final.effect.textDelta.excerpt).toContain("Submitted locally");
  }, 45_000);

  it("expands an explicit disclosure before proposing its submit control", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-expand-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}expand`);
    const provider: DecisionProvider = {
      id: "remote-test-provider",
      model: "unused-test-provider",
      decide: async () => { throw new Error("The collapsed section and ordered submit should resolve locally"); },
    };

    const disclosure = (await browser.inspect()).candidates.find((candidate) => candidate.label.includes("Section details"));
    expect(disclosure).toMatchObject({ role: "button", risk: "low", expanded: false });

    const first = await browser.decideAndAct("Expand the section below and click submit.", provider);
    expect(first.selectionRule).toBe("single-collapsed-control");
    expect(first.status).toBe("action-executed");
    const second = await browser.decideAndAct("Expand the section below and click submit.", provider);
    expect(second.status).toBe("awaiting-user-approval");
    expect(second.selectionRule).toBe("expanded-section-then-submit");
    expect(second.proposedAction).toMatchObject({ role: "button", kind: "button", label: "Submit" });
    const token = "approvalToken" in second ? second.approvalToken : "";
    const final = await browser.confirm(token, true);
    expect(final.status).toBe("action-executed-after-approval");
    expect(final.effect.textDelta.excerpt).toContain("Submitted locally");
  }, 45_000);
});
