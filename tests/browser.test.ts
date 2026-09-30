import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { BrowserManager } from "../src/browser/manager.js";
import type { DecisionProvider } from "../src/core/types.js";

describe("Playwright browser safety flow", () => {
  let server: Server;
  let baseUrl = "";
  let cdpWebSocketUrl = "";
  let cdpRedirect = false;
  let profile = "";
  let browser: BrowserManager;
  let debugContext: BrowserContext | undefined;
  let visualHtml: Buffer;
  let pointerTextHtml: Buffer;
  let iconPointerHtml: Buffer;
  let mixedPointerHtml: Buffer;
  let checkboxHtml: Buffer;
  let submitHtml: Buffer;
  let checkboxTaskHtml: Buffer;
  let tabHtml: Buffer;
  let expandHtml: Buffer;
  let nativeFieldsHtml: Buffer;
  let copyFieldsHtml: Buffer;
  let ambiguousLabelsHtml: Buffer;
  let editableContentHtml: Buffer;
  let silentFormHtml: Buffer;
  let decisionRaceHtml: Buffer;
  let replacementActionHtml: Buffer;
  let dynamicRefsHtml: Buffer;
  let menuHtml: Buffer;
  let ordinalFieldsHtml: Buffer;
  let multiDisclosureHtml: Buffer;
  let textareaWidgetsHtml: Buffer;
  let ordinalButtonHtml: Buffer;
  let sliderHtml: Buffer;
  let silentPointerHtml: Buffer;
  let silentInputHtml: Buffer;
  let autocompleteHtml: Buffer;
  let multipleSelectHtml: Buffer;
  let ariaSliderHtml: Buffer;
  let jqueryUiSliderHtml: Buffer;

  beforeAll(async () => {
    const html = await readFile(path.resolve("examples/browser-demo.html"));
    visualHtml = await readFile(path.resolve("examples/visual-only-demo.html"));
    pointerTextHtml = Buffer.from('<!doctype html><style>.faux-link { cursor: pointer; color: blue; text-decoration: underline }</style><span id="target" class="faux-link">adipiscing.</span><p id="status">Not clicked</p><script>document.querySelector("#target").addEventListener("click",()=>document.querySelector("#status").textContent="Clicked locally")</script>');
    iconPointerHtml = Buffer.from('<!doctype html><style>#controls{cursor:pointer}.icon{display:inline-block;width:18px;height:18px;content:url("/icons/reply-message.png")}#search{display:inline-block;width:18px;height:18px;cursor:pointer;background-image:url("/icons/search.png")}</style><div id="controls"><span id="reply"><span class="icon"></span><span>Reply</span></span><span id="forward">Forward</span></div><span id="search" aria-hidden="true"></span>');
    silentPointerHtml = Buffer.from('<!doctype html><style>.faux-link{cursor:pointer}</style><span class="faux-link">Open item</span>');
    silentInputHtml = Buffer.from('<!doctype html><label>Search <input type="text"></label>');
    sliderHtml = Buffer.from('<!doctype html><form onsubmit="event.preventDefault();document.querySelector(\'#status\').textContent=\'Submitted\'"><label for="level">Level</label><input id="level" type="range" min="0" max="20" step="1" value="5"><button type="submit">Submit</button></form><p id="status">Not submitted</p>');
    ariaSliderHtml = Buffer.from('<!doctype html><div id="level" role="slider" aria-label="Level" aria-valuemin="0" aria-valuemax="20" aria-valuenow="4" tabindex="0" style="width:120px;height:20px"></div><p id="value">4</p><script>document.querySelector("#level").addEventListener("keydown",event=>{const control=event.currentTarget;let value=Number(control.getAttribute("aria-valuenow"));if(event.key==="ArrowRight")value=Math.min(20,value+1);else if(event.key==="ArrowLeft")value=Math.max(0,value-1);else return;event.preventDefault();control.setAttribute("aria-valuenow",String(value));document.querySelector("#value").textContent=String(value)})</script>');
    jqueryUiSliderHtml = Buffer.from('<!doctype html><div id="slider-1" class="ui-slider" data-output="value"><span class="ui-slider-handle" tabindex="0" style="display:block;position:absolute;width:16px;height:16px"></span></div><p id="value">4</p><script>document.querySelector(".ui-slider-handle").addEventListener("keydown",event=>{let value=Number(document.querySelector("#value").textContent);if(event.key==="ArrowRight")value=Math.min(20,value+1);else if(event.key==="ArrowLeft")value=Math.max(0,value-1);else return;event.preventDefault();document.querySelector("#value").textContent=String(value)})</script>');
    autocompleteHtml = Buffer.from('<!doctype html><style>.suggestion{cursor:pointer}</style><label>Tag <input id="tag" type="text"></label><div><span class="suggestion">Poland</span><span class="suggestion">Portugal</span></div>');
    multipleSelectHtml = Buffer.from('<!doctype html><label for="tags">Tags</label><select id="tags" multiple><option value="alpha" selected>Alpha</option><option value="beta">Beta</option><option value="gamma">Gamma</option></select><p id="status">Not submitted</p>');
    mixedPointerHtml = Buffer.from('<!doctype html><style>.faux-link { cursor: pointer }</style><button>Section</button><span id="target" class="faux-link">Ultrices</span><p id="status">Not clicked</p><script>document.querySelector("#target").addEventListener("click",()=>document.querySelector("#status").textContent="Clicked locally")</script>');
    ambiguousLabelsHtml = Buffer.from('<!doctype html><button type="button">Continue</button><a href="#next">Continue</a><p id="status">No action</p>');
    checkboxHtml = Buffer.from('<!doctype html><label><input type="checkbox" name="updates"> Receive product updates</label>');
    submitHtml = Buffer.from('<!doctype html><form onsubmit="event.preventDefault(); document.querySelector(\'#status\').textContent = \'Submitted locally\'"><input type="submit" value="Send test"></form><p id="status">Not sent</p>');
    checkboxTaskHtml = Buffer.from('<!doctype html><form id="sample" onsubmit="event.preventDefault(); document.querySelector(\'#status\').textContent = \'Submitted locally\'"><label><input type="checkbox" name="target"> Neb</label><label><input type="checkbox" name="other"> Other</label><button type="submit">Submit</button></form><p id="status">Not sent</p>');
    tabHtml = Buffer.from('<!doctype html><div role="tab">Tab #1</div><div role="tab">Tab #2</div><div role="tab">Tab #3</div>');
    expandHtml = Buffer.from('<!doctype html><button id="toggle" aria-expanded="false" aria-controls="details">Section details</button><div id="details" hidden><p role="tab" aria-expanded="false">Submit</p><form onsubmit="event.preventDefault(); document.querySelector(\'#status\').textContent = \'Submitted locally\'"><button type="submit">Submit</button></form></div><p id="status">Not sent</p><script>document.querySelector(\'#toggle\').addEventListener(\'click\',e=>{const open=e.currentTarget.getAttribute(\'aria-expanded\')!==\'true\';e.currentTarget.setAttribute(\'aria-expanded\',String(open));document.querySelector(\'#details\').hidden=!open;location.hash=\'details\'})</script>');
    nativeFieldsHtml = Buffer.from(`<!doctype html><form id="native-form" onsubmit="event.preventDefault(); document.querySelector('#status').textContent = 'Submitted'"><label for="country">Country</label><select id="country" name="country"><option value="">Choose one</option><option value="ca">Canada</option><option value="cn">China</option><optgroup label="Disabled" disabled><option value="blocked">Unavailable</option></optgroup></select><label for="date">Date</label><input id="date" name="date" type="date"><label for="datepicker">Appointment date</label><input id="datepicker" name="appointment" type="text" aria-label="Appointment date" readonly><div id="picker" role="group" aria-label="December 2016 date picker" hidden><button id="day22" type="button" aria-label="December 22, 2016">22</button></div><button type="submit">Submit</button></form><p id="status">Not submitted</p><script>document.querySelector('#country').addEventListener('change',()=>document.querySelector('#status').textContent='Selected country');document.querySelector('#date').addEventListener('change',()=>document.querySelector('#status').textContent='Date entry updated');document.querySelector('#datepicker').addEventListener('click',()=>document.querySelector('#picker').hidden=false);document.querySelector('#day22').addEventListener('click',()=>{document.querySelector('#datepicker').value='12/22/2016';document.querySelector('#picker').hidden=true;document.querySelector('#status').textContent='Date selected'})</script>`);
    copyFieldsHtml = Buffer.from('<!doctype html><form id="copy-form" onsubmit="event.preventDefault();document.querySelector(\'#status\').textContent=\'Submitted\'"><label for="source">Source text</label><textarea id="source">private-copy-fixture-61c9</textarea><label for="target">Destination text</label><input id="target" type="text"><button type="submit">Submit</button></form><p id="status">Not submitted</p>');
    editableContentHtml = Buffer.from('<!doctype html><h1>Sample page</h1><div contenteditable="true">private-note-do-not-send-73b1</div><p>Public page context</p>');
    silentFormHtml = Buffer.from('<!doctype html><form onsubmit="event.preventDefault();document.querySelector(\'#status\').textContent=\'Submitted\'"><label for="draft">Draft</label><input id="draft" type="text"><button type="submit">Submit draft</button></form><p id="status">No visible change</p>');
    decisionRaceHtml = Buffer.from('<!doctype html><button>Read guide</button><p>Waiting for a decision</p>');
    replacementActionHtml = Buffer.from('<!doctype html><button data-adk-ref="r1" onclick="document.querySelector(\'#status\').textContent=\'Dangerous action executed\'">Delete all data</button><p id="status">Not executed</p>');
    dynamicRefsHtml = Buffer.from('<!doctype html><button id="old">Old action</button><button id="new" hidden onclick="document.querySelector(\'#status\').textContent=\'New action clicked\'">New action</button><p id="status">Not clicked</p>');
    menuHtml = Buffer.from('<!doctype html><style>#items{cursor:pointer}</style><button id="menu" aria-expanded="false">Menu</button><div id="items" role="menu" hidden><button role="menuitem" onclick="document.querySelector(\'#status\').textContent=\'Zoomed\'">Zoom In</button></div><p id="status">Menu closed</p><script>document.querySelector(\'#menu\').addEventListener(\'click\',e=>{const open=e.currentTarget.getAttribute(\'aria-expanded\')!==\'true\';e.currentTarget.setAttribute(\'aria-expanded\',String(open));document.querySelector(\'#items\').hidden=!open})</script>');
    ordinalFieldsHtml = Buffer.from('<!doctype html><form><label><input type="radio" name="choice"> Alpha</label><label><input type="radio" name="choice"> Beta</label><label><input type="radio" name="choice"> Gamma</label><label>Text one <input type="text"></label><label>Text two <input type="text"></label></form>');
    textareaWidgetsHtml = Buffer.from('<!doctype html><textarea aria-label="First notes" onclick="document.querySelector(\'#status\').textContent=\'Clicked textarea\'"></textarea><textarea aria-label="Second notes"></textarea><p id="status">Not clicked</p>');
    ordinalButtonHtml = Buffer.from('<!doctype html><button>ONE</button><button>TWO</button>');
    multiDisclosureHtml = Buffer.from('<!doctype html><button id="one" aria-expanded="false">Section one</button><div id="content-one" hidden><p>Nothing here</p></div><button id="two" aria-expanded="false">Section two</button><div id="content-two" hidden><a href="#target">Ultrices</a></div><script>for(const id of [\'one\',\'two\'])document.querySelector(`#${id}`).addEventListener(\'click\',e=>{const open=e.currentTarget.getAttribute(\'aria-expanded\')!==\'true\';e.currentTarget.setAttribute(\'aria-expanded\',String(open));document.querySelector(`#content-${id}`).hidden=!open})</script>');
    server = createServer((request, response) => {
      if (request.url === "/json/version") {
        if (cdpRedirect) {
          response.writeHead(302, { location: "http://example.com/redirected" });
          response.end();
          return;
        }
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ webSocketDebuggerUrl: cdpWebSocketUrl }));
        return;
      }
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(request.url === "/visual-only" ? visualHtml : request.url === "/pointer-text" ? pointerTextHtml : request.url === "/icon-pointer" ? iconPointerHtml : request.url === "/silent-pointer" ? silentPointerHtml : request.url === "/silent-input" ? silentInputHtml : request.url === "/mixed-pointer" ? mixedPointerHtml : request.url === "/checkbox" ? checkboxHtml : request.url === "/submit" ? submitHtml : request.url === "/checkbox-task" ? checkboxTaskHtml : request.url === "/tabs" ? tabHtml : request.url === "/expand" ? expandHtml : request.url === "/native-fields" ? nativeFieldsHtml : request.url === "/copy-fields" ? copyFieldsHtml : request.url === "/slider" ? sliderHtml : request.url === "/aria-slider" ? ariaSliderHtml : request.url === "/jquery-ui-slider" ? jqueryUiSliderHtml : request.url === "/autocomplete" ? autocompleteHtml : request.url === "/multi-select" ? multipleSelectHtml : request.url === "/ambiguous-labels" ? ambiguousLabelsHtml : request.url === "/editable" ? editableContentHtml : request.url === "/silent-form" ? silentFormHtml : request.url === "/decision-race" ? decisionRaceHtml : request.url === "/replacement-action" ? replacementActionHtml : request.url === "/dynamic-refs" ? dynamicRefsHtml : request.url === "/menu" ? menuHtml : request.url === "/ordinal-fields" ? ordinalFieldsHtml : request.url === "/textareas" ? textareaWidgetsHtml : request.url === "/ordinal-button" ? ordinalButtonHtml : request.url === "/multi-disclosure" ? multiDisclosureHtml : html);
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Unable to start local browser demo server");
    baseUrl = `http://127.0.0.1:${address.port}/`;
    cdpWebSocketUrl = `ws://127.0.0.1:${address.port}/devtools/browser/test`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  afterEach(async () => {
    await browser?.close();
    await debugContext?.close();
    debugContext = undefined;
    if (profile) await rm(profile, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("lists loopback Chrome tabs first and attaches only to an explicitly selected tab", async () => {
    const pages = [
      { title: async () => "First tab", url: () => "https://user:secret@first.example.test/path?access_token=private#session", isClosed: () => false },
      { title: async () => "Second tab", url: () => "https://second.example.test", isClosed: () => false },
    ];
    const context = { pages: () => pages };
    for (const page of pages) Object.assign(page, { context: () => context });
    const cdpBrowser = { contexts: () => [context], close: vi.fn(async () => undefined) } as unknown as Browser;
    const connectOverCDP = vi.spyOn(chromium, "connectOverCDP").mockResolvedValue(cdpBrowser);
    browser = new BrowserManager();

    const listed = await browser.connect(baseUrl);
    expect(listed).toMatchObject({ connected: false, selectedTabRequired: true, tabs: [
      { index: 0, title: "First tab", url: "https://first.example.test/path" },
      { index: 1, title: "Second tab", url: "https://second.example.test/" },
    ] });
    expect(browser.connected).toBe(false);
    expect(connectOverCDP).toHaveBeenNthCalledWith(1, cdpWebSocketUrl);
    expect(cdpBrowser.close).toHaveBeenCalledTimes(1);

    const connected = await browser.connect(baseUrl, 1);
    expect(connected).toMatchObject({ connected: true, page: { title: "Second tab", url: "https://second.example.test/" } });
    expect(browser.connected).toBe(true);
    expect(connectOverCDP).toHaveBeenNthCalledWith(2, cdpWebSocketUrl);
  });

  it("rejects remote endpoints, redirects, and remote WebSocket addresses before connecting", async () => {
    const connectOverCDP = vi.spyOn(chromium, "connectOverCDP");
    browser = new BrowserManager();

    try {
      await expect(browser.connect("http://example.com:9222")).rejects.toThrow("loopback");
      await expect(browser.connect("ws://example.com/devtools/browser/test")).rejects.toThrow("loopback");
      cdpRedirect = true;
      await expect(browser.connect(baseUrl)).rejects.toThrow("Could not reach Chrome's local DevTools endpoint");
      cdpRedirect = false;
      cdpWebSocketUrl = "ws://example.com/devtools/browser/test";
      await expect(browser.connect(baseUrl)).rejects.toThrow("non-loopback WebSocket endpoint");
      expect(connectOverCDP).not.toHaveBeenCalled();
    } finally {
      cdpRedirect = false;
      cdpWebSocketUrl = `ws://127.0.0.1:${new URL(baseUrl).port}/devtools/browser/test`;
    }
  });

  it("connects to a real isolated Chrome tab only after its index is selected", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-cdp-test-"));
    const port = await findAvailablePort();
    debugContext = await chromium.launchPersistentContext(path.join(profile, "chrome-profile"), {
      headless: true,
      args: [`--remote-debugging-port=${port}`],
    });
    const page = debugContext.pages()[0] ?? await debugContext.newPage();
    await page.goto(baseUrl);
    browser = new BrowserManager();

    const endpoint = `http://127.0.0.1:${port}`;
    await waitForDevTools(endpoint);
    const listed = await browser.connect(endpoint);
    expect(listed).toMatchObject({ connected: false, selectedTabRequired: true });
    expect(listed.tabs).toContainEqual(expect.objectContaining({ title: "Agent Decision Kit — Local Browser Demo", url: baseUrl }));
    expect(browser.connected).toBe(false);

    const selected = listed.tabs.find((tab) => tab.title === "Agent Decision Kit — Local Browser Demo");
    expect(selected).toBeDefined();
    const attached = await browser.connect(endpoint, selected!.index);
    expect(attached).toMatchObject({ connected: true, page: { title: "Agent Decision Kit — Local Browser Demo", url: baseUrl } });
    expect((await browser.inspect()).candidates.length).toBeGreaterThan(0);

    await browser.close();
    expect(page.isClosed()).toBe(false);
  }, 45_000);

  it("inspects accessible controls, fills a draft locally, and gates a delete action", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}?session_token=private#secret`);
    const snapshot = await browser.inspect();
    expect(snapshot.url).toBe(baseUrl);
    expect(JSON.stringify(snapshot)).not.toContain("session_token");
    expect(JSON.stringify(snapshot)).not.toContain("secret");
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

  it("keeps contenteditable drafts out of browser snapshots", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-editable-privacy-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}editable`);

    const snapshot = await browser.inspect();
    const serialized = JSON.stringify(snapshot);
    expect(serialized).not.toContain("private-note-do-not-send-73b1");
    expect(serialized).not.toContain("privateFormState");
    expect(snapshot.textExcerpt).toContain("Public page context");
  }, 45_000);

  it("invalidates a pending submit approval when a private form value changes", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-form-state-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}silent-form`);

    const snapshot = await browser.inspect();
    const submit = snapshot.candidates.find((candidate) => candidate.label === "Submit draft");
    const draft = snapshot.candidates.find((candidate) => candidate.kind === "text");
    expect(submit?.risk).toBe("approval-required");
    const proposed = await browser.act(submit!.ref);
    const token = "approvalToken" in proposed ? proposed.approvalToken : "";
    const filled = await browser.fill(draft!.ref, "private value changed after proposal");
    expect(JSON.stringify(filled)).not.toContain("private value changed after proposal");
    await expect(browser.confirm(token, true)).rejects.toThrow("The page changed after the action was proposed");
    expect((await browser.inspect()).textExcerpt).toContain("No visible change");
  }, 45_000);

  it("does not execute a stale semantic choice after the page changes during inference", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-decision-race-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}decision-race`);
    const provider: DecisionProvider = {
      id: "semantic-local",
      model: "fixture-model",
      decide: async () => {
        await browser.navigate(`${baseUrl}replacement-action`);
        return {
          provider: "semantic-local",
          model: "fixture-model",
          latencyMs: 1,
          answers: {
            action: { type: "choice", choice: "r1", probabilities: { r1: 1 }, confidence: 1, confidenceSource: "maximum-probability", calibration: "uncalibrated-estimate" },
          },
        };
      },
    };

    const result = await browser.decideAndAct("Identify the most relevant control.", provider);
    expect(result.status).toBe("page-changed-during-decision");
    expect((await browser.inspect()).textExcerpt).toContain("Not executed");
  }, 45_000);

  it("removes stale DOM refs before targeting a replacement control", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-dynamic-refs-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}dynamic-refs`);

    const original = await browser.inspect();
    expect(original.candidates[0]?.label).toContain("Old action");
    const page = (browser as unknown as { page: Page }).page;
    await page.evaluate(() => {
      document.querySelector<HTMLButtonElement>("#old")!.hidden = true;
      document.querySelector<HTMLButtonElement>("#new")!.hidden = false;
    });

    const refreshed = await browser.inspect();
    const target = refreshed.candidates.find((candidate) => candidate.label.includes("New action"));
    expect(target).toBeDefined();
    const currentRefs = await page.locator("*").evaluateAll((elements) => elements.flatMap((element) => Array.from(element.attributes).filter((attribute) => attribute.name.startsWith("data-adk-ref-")).map((attribute) => attribute.value)));
    expect(currentRefs.filter((ref) => ref === target!.ref)).toHaveLength(1);

    expect((await browser.act(target!.ref)).status).toBe("action-executed");
    expect((await browser.inspect()).textExcerpt).toContain("New action clicked");
  }, 45_000);

  it("redacts sensitive URL parts but still detects URL changes before acting", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-url-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}?token=first#private`);
    const snapshot = await browser.inspect();
    expect(snapshot.url).toBe(baseUrl);

    await browser.navigate(`${baseUrl}?token=second#private`);
    await expect(browser.act(snapshot.candidates[0]!.ref)).rejects.toThrow("page changed");
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
    expect(result.suggestedTool).toBe("browser_visual_text");
    expect(result.descriptionTool).toBe("browser_visual_inspect");
    expect("visual" in result).toBe(false);
  }, 45_000);

  it("finds non-semantic CSS pointer targets but requires explicit approval", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-pointer-target-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}pointer-text`);
    const provider: DecisionProvider = {
      id: "semantic-local",
      model: "unused-test-provider",
      decide: vi.fn(async () => { throw new Error("An exact pointer target must resolve without model inference"); }),
    };

    const snapshot = await browser.inspect();
    expect(snapshot.candidates).toHaveLength(1);
    expect(snapshot.candidates[0]).toMatchObject({ role: "pointer-target", kind: "custom-pointer", label: "adipiscing.", risk: "approval-required" });

    const cancelledProposal = await browser.decideAndAct('Click on the link "adipiscing.".', provider);
    expect(cancelledProposal).toMatchObject({ status: "awaiting-user-approval", selectionRule: "unique-exact-quoted-label" });
    const cancelToken = "approvalToken" in cancelledProposal ? cancelledProposal.approvalToken : "";
    expect(await browser.confirm(cancelToken, false)).toMatchObject({ status: "cancelled" });
    expect(await browser.inspect().then((result) => result.textExcerpt)).toContain("Not clicked");

    const approvedProposal = await browser.decideAndAct('Click on the link "adipiscing.".', provider);
    const approvalToken = "approvalToken" in approvedProposal ? approvedProposal.approvalToken : "";
    expect(await browser.confirm(approvalToken, true)).toMatchObject({ status: "action-executed-after-approval" });
    expect(await browser.inspect().then((result) => result.textExcerpt)).toContain("Clicked locally");
    expect(provider.decide).not.toHaveBeenCalled();
  }, 45_000);

  it("labels icon-only actions and splits distinct nested pointer targets", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-icon-pointer-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}icon-pointer`);
    const provider: DecisionProvider = {
      id: "semantic-local",
      model: "unused-test-provider",
      decide: vi.fn(async () => { throw new Error("Exact nested labels must resolve without model inference"); }),
    };

    const snapshot = await browser.inspect();
    expect(snapshot.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "pointer-target", label: "Reply", risk: "approval-required" }),
      expect.objectContaining({ role: "pointer-target", label: "Forward", risk: "approval-required" }),
      expect.objectContaining({ role: "pointer-target", label: "reply message icon", risk: "approval-required" }),
      expect.objectContaining({ role: "pointer-target", label: "search icon", risk: "approval-required" }),
    ]));
    expect(snapshot.candidates.some((candidate) => candidate.label === "Reply Forward")).toBe(false);

    const proposed = await browser.decideAndAct('Click the "Reply" control.', provider);
    expect(proposed).toMatchObject({ status: "awaiting-user-approval", proposedAction: { label: "Reply", risk: "approval-required" } });
    expect(provider.decide).not.toHaveBeenCalled();
  }, 45_000);

  it("includes pointer-only labels alongside semantic controls and keeps their approval gate", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-mixed-pointer-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}mixed-pointer`);
    const provider: DecisionProvider = {
      id: "remote-test-provider",
      model: "unused-test-provider",
      decide: async () => { throw new Error("The quoted pointer target is exact and should match locally"); },
    };

    const snapshot = await browser.inspect();
    expect(snapshot.candidates).toHaveLength(2);
    expect(snapshot.candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "button", label: "Section" }),
      expect.objectContaining({ role: "pointer-target", label: "Ultrices", risk: "approval-required" }),
    ]));

    const proposed = await browser.decideAndAct('Click the link "Ultrices".', provider);
    expect(proposed).toMatchObject({ status: "awaiting-user-approval", selectionRule: "unique-exact-quoted-label", proposedAction: { role: "pointer-target", label: "Ultrices", risk: "approval-required" } });
    const token = "approvalToken" in proposed ? proposed.approvalToken : "";
    expect(await browser.confirm(token, false)).toMatchObject({ status: "cancelled" });
    expect((await browser.inspect()).textExcerpt).toContain("Not clicked");
  }, 45_000);

  it("blocks a repeated approval loop when a pointer-only click makes no visible progress", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-pointer-loop-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}silent-pointer`);
    const provider: DecisionProvider = {
      id: "semantic-local",
      model: "fixture-model",
      decide: vi.fn(async () => ({ provider: "semantic-local", model: "fixture-model", latencyMs: 1, answers: { action: { type: "choice" as const, choice: "r1", probabilities: { r1: 1 }, confidence: 1, confidenceSource: "maximum-probability" as const, calibration: "uncalibrated-estimate" as const } } })),
    };

    const proposed = await browser.decideAndAct("Choose the relevant visible action.", provider);
    expect(proposed.status).toBe("awaiting-user-approval");
    const token = "approvalToken" in proposed ? proposed.approvalToken : "";
    expect(await browser.confirm(token, true)).toMatchObject({ status: "action-executed-after-approval", visibleStateChanged: false });
    expect(await browser.decideAndAct("Choose the relevant visible action.", provider)).toMatchObject({ status: "repeated-action-blocked" });
    expect(provider.decide).toHaveBeenCalledTimes(1);
  }, 45_000);

  it("blocks a repeated automatic no-op focus while keeping explicit browser_action available", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-noop-focus-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}silent-input`);
    const provider: DecisionProvider = {
      id: "semantic-local",
      model: "fixture-model",
      decide: vi.fn(async () => ({ provider: "semantic-local", model: "fixture-model", latencyMs: 1, answers: { action: { type: "choice" as const, choice: "r1", probabilities: { r1: 1 }, confidence: 1, confidenceSource: "maximum-probability" as const, calibration: "uncalibrated-estimate" as const } } })),
    };

    expect(await browser.decideAndAct("Focus the search field.", provider)).toMatchObject({ status: "action-executed", visibleStateChanged: false });
    expect(await browser.decideAndAct("Focus the search field.", provider)).toMatchObject({ status: "repeated-action-blocked" });
    expect(provider.decide).toHaveBeenCalledTimes(1);
    expect(await browser.act("r1")).toMatchObject({ status: "action-executed", effect: { focused: true } });
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

  it("exposes labeled native date and select controls without disclosing entered values", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-native-field-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}native-fields`);

    const snapshot = await browser.inspect();
    const country = snapshot.candidates.find((candidate) => candidate.kind === "select-one");
    const date = snapshot.candidates.find((candidate) => candidate.kind === "date");
    expect(country?.role).toBe("combobox");
    expect(country?.label).toContain("Country");
    expect(country?.label).toContain("Options: Choose one, Canada, China");
    expect(country?.label).not.toContain("Unavailable");
    expect(date?.label).toContain("Date");
    expect(JSON.stringify(snapshot)).not.toContain('value="cn"');
  }, 45_000);

  it("selects an exact requested native option before proposing the approval-gated submit", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-native-select-flow-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}native-fields`);
    const provider: DecisionProvider = { id: "semantic-local", model: "unused-provider", decide: async () => { throw new Error("An exact visible option must be resolved locally"); } };

    const selected = await browser.decideAndAct("Select Canada from the dropdown and click Submit.", provider);
    expect(selected).toMatchObject({ status: "action-executed", selectionRule: "explicit-native-select-option", effect: { status: "selected", submitted: false, valueReturned: false } });
    expect((await browser.inspect()).candidates.find((candidate) => candidate.kind === "select-one")?.selectedOptionLabels).toContain("Canada");
    const submit = await browser.decideAndAct("Select Canada from the dropdown and click Submit.", provider);
    expect(submit).toMatchObject({ status: "awaiting-user-approval", selectionRule: "unique-explicit-submit-control", proposedAction: { label: "Submit", risk: "approval-required" } });
    const token = "approvalToken" in submit ? submit.approvalToken : "";
    expect(await browser.confirm(token, false)).toMatchObject({ status: "cancelled" });
  }, 45_000);

  it("adds one exact multiselect option without clearing the existing selection", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-multiselect-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}multi-select`);
    const control = (await browser.inspect()).candidates.find((candidate) => candidate.kind === "select-multiple");
    const result = await browser.selectOption(control!.ref, "Beta");
    expect(result).toMatchObject({ status: "selected", optionLabel: "Beta", submitted: false, valueReturned: false });
    expect((await browser.inspect()).candidates.find((candidate) => candidate.kind === "select-multiple")?.selectedOptionLabels).toEqual(["Alpha", "Beta"]);
    expect(JSON.stringify(result)).not.toContain("beta");
  }, 45_000);

  it("copies textarea text into another field locally without exposing the value or submitting", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-copy-field-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}copy-fields`);

    const snapshot = await browser.inspect();
    const sourceText = "private-copy-fixture-61c9";
    expect(JSON.stringify(snapshot)).not.toContain(sourceText);
    const source = snapshot.candidates.find((candidate) => candidate.kind === "textarea");
    const target = snapshot.candidates.find((candidate) => candidate.kind === "text");
    expect(source?.label).toContain("Source text");
    expect(target?.label).toContain("Destination text");

    const result = await browser.copyField(source!.ref, target!.ref);
    expect(result).toMatchObject({ status: "copied", sourceRef: source!.ref, targetRef: target!.ref, characterCount: sourceText.length, valueReturned: false, submitted: false });
    expect(JSON.stringify(result)).not.toContain(sourceText);

    const page = (browser as unknown as { page: Page }).page;
    expect(await page.locator("#target").inputValue()).toBe(sourceText);
    expect(await page.locator("#status").innerText()).toBe("Not submitted");
    expect(JSON.stringify(await browser.inspect())).not.toContain(sourceText);
  }, 45_000);

  it("sets only explicit slider values and blocks submission until requested text fields are filled", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-range-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}slider`);
    const provider: DecisionProvider = { id: "semantic-local", model: "unused-provider", decide: async () => { throw new Error("The explicit slider target must be resolved locally"); } };
    const inspected = await browser.inspect();
    const slider = inspected.candidates.find((candidate) => candidate.kind === "range");
    expect(slider).toMatchObject({ min: 0, max: 20, step: 1 });
    expect(JSON.stringify(slider)).not.toContain("value");
    await expect(browser.setRange(slider!.ref, 21)).rejects.toThrow("between 0 and 20");

    const set = await browser.decideAndAct("Set the slider to [16].", provider);
    expect(set).toMatchObject({ status: "action-executed", selectionRule: "explicit-slider-values-in-order", effect: { status: "set", valueReturned: false, submitted: false } });
    expect(JSON.stringify(set)).not.toContain("16");
    const submission = await browser.decideAndAct("Set the slider to [16] and click Submit.", provider);
    expect(submission).toMatchObject({ status: "awaiting-user-approval", proposedAction: { label: "Submit", risk: "approval-required" } });
    const token = "approvalToken" in submission ? submission.approvalToken : "";
    expect(await browser.confirm(token, false)).toMatchObject({ status: "cancelled" });

    await browser.navigate(`${baseUrl}silent-form`);
    const blockedProvider: DecisionProvider = { id: "semantic-local", model: "unused-provider", decide: async () => { throw new Error("An unfilled form must not reach the provider"); } };
    const blocked = await browser.decideAndAct("Enter a note into the form and submit when done.", blockedProvider);
    expect(blocked).toMatchObject({ status: "prerequisite-fields-required", requiredFields: [expect.objectContaining({ kind: "text" })] });
    const fieldRef = "requiredFields" in blocked ? blocked.requiredFields[0]!.ref : "";
    await browser.fill(fieldRef, "local synthetic note");
    const approved = await browser.decideAndAct("Enter a note into the form and submit when done.", blockedProvider);
    expect(approved).toMatchObject({ status: "awaiting-user-approval", proposedAction: { label: "Submit draft", risk: "approval-required" } });
  }, 45_000);

  it("sets accessible ARIA sliders with keyboard input while keeping the value out of tool results", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-aria-range-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}aria-slider`);
    const inspected = await browser.inspect();
    const slider = inspected.candidates.find((candidate) => candidate.role === "slider");
    expect(slider).toMatchObject({ kind: "range", min: 0, max: 20 });
    expect(JSON.stringify(slider)).not.toContain("aria-valuenow");

    const set = await browser.setRange(slider!.ref, 16);
    expect(set).toMatchObject({ status: "set", valueReturned: false, submitted: false });
    expect(JSON.stringify(set)).not.toContain("16");
    expect((await browser.inspect()).textExcerpt).toContain("16");
    await expect(browser.setRange(slider!.ref, 21)).rejects.toThrow("between 0 and 20");

    await browser.navigate(`${baseUrl}aria-slider`);
    const provider: DecisionProvider = { id: "semantic-local", model: "unused-provider", decide: async () => { throw new Error("The explicit ARIA slider target must be resolved locally"); } };
    const automatic = await browser.decideAndAct("Set the slider to [16].", provider);
    expect(automatic).toMatchObject({ status: "action-executed", selectionRule: "explicit-slider-values-in-order", effect: { status: "set", valueReturned: false, submitted: false } });
    expect(JSON.stringify(automatic)).not.toContain("16");
  }, 45_000);

  it("supports keyboard-operated jQuery UI sliders and restores an unreachable target", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-jquery-slider-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}jquery-ui-slider`);
    const inspected = await browser.inspect();
    const slider = inspected.candidates.find((candidate) => candidate.kind === "range");
    expect(slider).toMatchObject({ role: "slider", kind: "range" });
    expect(slider).not.toHaveProperty("min");
    expect(slider).not.toHaveProperty("max");

    const set = await browser.setRange(slider!.ref, 16);
    expect(set).toMatchObject({ status: "set", valueReturned: false, submitted: false });
    expect(JSON.stringify(set)).not.toContain("16");
    expect((await browser.inspect()).textExcerpt).toContain("16");
    const unreachable = await browser.setRange(slider!.ref, 21);
    expect(unreachable).toMatchObject({ status: "range-value-not-applied", restored: true, submitted: false });
    expect(JSON.stringify(unreachable)).not.toContain("21");
    expect((await browser.inspect()).textExcerpt).toContain("16");

    await browser.navigate(`${baseUrl}jquery-ui-slider`);
    const provider: DecisionProvider = { id: "semantic-local", model: "unused-provider", decide: async () => { throw new Error("The explicit keyboard slider target must be resolved locally"); } };
    const automatic = await browser.decideAndAct("Set the slider to [16].", provider);
    expect(automatic).toMatchObject({ status: "action-executed", selectionRule: "explicit-slider-values-in-order", effect: { status: "set", valueReturned: false, submitted: false } });
    expect(JSON.stringify(automatic)).not.toContain("16");
  }, 45_000);

  it("chooses the first visible item when the task explicitly accepts any matching prefix", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-autocomplete-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}autocomplete`);
    const provider: DecisionProvider = { id: "semantic-local", model: "unused-provider", decide: async () => { throw new Error("A permissive exact prefix must resolve locally"); } };
    const input = (await browser.inspect()).candidates.find((candidate) => candidate.kind === "text");
    await browser.fill(input!.ref, "Po");

    const result = await browser.decideAndAct('Enter an item that starts with "Po".', provider);
    expect(result).toMatchObject({ status: "awaiting-user-approval", selectionRule: "first-visible-option-matching-explicit-prefix", proposedAction: { label: "Poland", risk: "approval-required" } });
    const token = "approvalToken" in result ? result.approvalToken : "";
    expect(await browser.confirm(token, false)).toMatchObject({ status: "cancelled" });
  }, 45_000);

  it("selects one exact visible native option and fills a date without submitting", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-native-action-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}native-fields`);

    let snapshot = await browser.inspect();
    let country = snapshot.candidates.find((candidate) => candidate.kind === "select-one");
    expect(country).toBeDefined();
    await expect(browser.selectOption(country!.ref, "CN")).rejects.toThrow("exact, enabled option label");
    await expect(browser.selectOption(country!.ref, "Unavailable")).rejects.toThrow("exact, enabled option label");
    const selected = await browser.selectOption(country!.ref, "China");
    expect(selected).toMatchObject({ status: "selected", optionLabel: "China", submitted: false, valueReturned: false });

    snapshot = await browser.inspect();
    const date = snapshot.candidates.find((candidate) => candidate.kind === "date");
    expect(date).toBeDefined();
    const filled = await browser.fill(date!.ref, "2016-12-22");
    expect(filled).toMatchObject({ status: "filled", valueReturned: false });
    expect(JSON.stringify(filled)).not.toContain("2016-12-22");
    const result = await browser.inspect();
    expect(result.textExcerpt).toContain("Date entry updated");
    expect(result.textExcerpt).not.toContain("Submitted");
  }, 45_000);

  it("opens a read-only date picker without exposing or filling its value", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-readonly-date-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}native-fields`);

    const snapshot = await browser.inspect();
    const datePicker = snapshot.candidates.find((candidate) => candidate.label.includes("Appointment date"));
    expect(datePicker).toMatchObject({ kind: "text", readOnly: true, risk: "low" });
    expect(JSON.stringify(snapshot)).not.toContain("12/22/2016");
    await expect(browser.fill(datePicker!.ref, "12/22/2016")).rejects.toThrow("field is read-only");

    const opened = await browser.act(datePicker!.ref);
    expect(opened.effect).toMatchObject({ openedPicker: true, valueReturned: false });
    const picker = await browser.inspect();
    const day = picker.candidates.find((candidate) => candidate.label.includes("December 22, 2016"));
    expect(day).toMatchObject({ role: "button", risk: "low" });
    const selected = await browser.act(day!.ref);
    expect(selected.status).toBe("action-executed");
    expect((await browser.inspect()).textExcerpt).toContain("Date selected");
    expect(JSON.stringify(selected)).not.toContain("12/22/2016");
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
    expect(result.confidenceSource).toBe("not-applicable-rule");
    expect(result.calibration).toBe("not-applicable-rule");
  }, 45_000);

  it("uses a unique explicit command label locally without a model round trip", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-command-label-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(baseUrl);
    const provider: DecisionProvider = {
      id: "remote-test-provider",
      model: "unused-test-provider",
      decide: async () => { throw new Error("A unique exact visible label should resolve locally"); },
    };

    const result = await browser.decideAndAct("Click Save local draft button.", provider);
    expect(result.status).toBe("action-executed");
    expect(result.selectionRule).toBe("unique-explicit-command-label");
    expect(result.action.label).toBe("Save local draft");
    expect(result.effect.textDelta.excerpt).toContain("Saved the local sample draft.");
  }, 45_000);

  it("matches a role-prefixed button label exactly", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-role-label-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}ordinal-button`);
    const provider: DecisionProvider = {
      id: "remote-test-provider",
      model: "unused-test-provider",
      decide: async () => { throw new Error("An explicit role-prefixed label should resolve locally"); },
    };

    const result = await browser.decideAndAct("Click button ONE.", provider);
    expect(result).toMatchObject({ status: "action-executed", selectionRule: "unique-explicit-command-label", action: { label: "ONE" } });
  }, 45_000);

  it("uses the label of the next revealed menu item after opening a menu", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-menu-sequence-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}menu`);
    const provider: DecisionProvider = {
      id: "remote-test-provider",
      model: "unused-test-provider",
      decide: async () => { throw new Error("The menu steps have exact visible labels"); },
    };
    const task = 'Click the "Menu" button, and then find and click on the item labeled "Zoom In".';

    const opened = await browser.decideAndAct(task, provider);
    expect(opened).toMatchObject({ status: "action-executed", action: { role: "button" } });
    expect(opened.action.label).toContain("Menu");
    const selected = await browser.decideAndAct(task, provider);
    expect(selected).toMatchObject({ status: "action-executed", action: { label: "Zoom In" } });
    expect((await browser.inspect()).textExcerpt).toContain("Zoomed");
  }, 45_000);

  it("uses explicit radio and text-field ordinals without entering inferred text", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-ordinal-fields-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}ordinal-fields`);
    const provider: DecisionProvider = {
      id: "remote-test-provider",
      model: "unused-test-provider",
      decide: async () => { throw new Error("Explicit form-field ordinals should resolve locally"); },
    };
    const task = 'Check the 3rd radio button and enter the number "-3" into the 2nd textbox.';

    const radio = await browser.decideAndAct(task, provider);
    expect(radio).toMatchObject({ status: "action-executed", selectionRule: "explicit-radio-ordinal", action: { kind: "radio", checked: false } });
    const focused = await browser.decideAndAct(task, provider);
    expect(focused).toMatchObject({ status: "action-executed", selectionRule: "explicit-text-field-ordinal", action: { label: "Text two" } });
    expect((await browser.inspect()).textExcerpt).not.toContain("-3");
  }, 45_000);

  it("focuses any requested visible textarea deterministically", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-any-textarea-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}textareas`);
    const provider: DecisionProvider = {
      id: "remote-test-provider",
      model: "unused-test-provider",
      decide: async () => { throw new Error("The task accepts any visible textarea"); },
    };

    const result = await browser.decideAndAct('Click on a "textarea" widget.', provider);
    expect(result).toMatchObject({ status: "action-executed", selectionRule: "explicit-any-textarea", action: { label: "First notes" }, effect: { clicked: true } });
    expect((await browser.inspect()).textExcerpt).toContain("Clicked textarea");
  }, 45_000);

  it("opens multiple collapsed sections in DOM order when searching for an exact target", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-disclosure-search-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}multi-disclosure`);
    const provider: DecisionProvider = {
      id: "remote-test-provider",
      model: "unused-test-provider",
      decide: async () => { throw new Error("Visible disclosure controls and target labels resolve locally"); },
    };
    const task = 'Expand the sections below, to find and click on the link "Ultrices."';

    const first = await browser.decideAndAct(task, provider);
    expect(first).toMatchObject({ status: "action-executed", selectionRule: "ordered-disclosure-search", action: { role: "button" } });
    expect(first.action.label).toContain("Section one");
    const second = await browser.decideAndAct(task, provider);
    expect(second).toMatchObject({ status: "action-executed", action: { role: "button" } });
    expect(second.action.label).toContain("Section two");
    const target = await browser.decideAndAct(task, provider);
    expect(target).toMatchObject({ status: "action-executed", selectionRule: "unique-exact-quoted-label", action: { label: "Ultrices" } });
  }, 45_000);

  it("does not guess when the same explicit command label appears twice", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-ambiguous-label-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}ambiguous-labels`);
    const provider: DecisionProvider = {
      id: "remote-test-provider",
      model: "unused-test-provider",
      decide: async () => { throw new Error("Remote page context is blocked by default"); },
    };

    const result = await browser.decideAndAct("Click Continue", provider);
    expect(result.status).toBe("remote-provider-blocked-for-browser-privacy");
    expect(result.candidates).toHaveLength(2);
  }, 45_000);

  it("executes a submit input only after the separate approval call", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-submit-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}submit`);

    const snapshot = await browser.inspect();
    const submit = snapshot.candidates.find((candidate) => candidate.kind === "submit");
    expect(submit?.risk).toBe("approval-required");

    const provider: DecisionProvider = {
      id: "remote-test-provider",
      model: "unused-test-provider",
      decide: async () => { throw new Error("An explicit submit request should match locally"); },
    };
    const proposed = await browser.decideAndAct("Press Submit", provider);
    expect(proposed.status).toBe("awaiting-user-approval");
    expect(proposed.selectionRule).toBe("unique-explicit-submit-control");
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

  it("sets several uniquely labeled native checkboxes in one local call without submitting", async () => {
    profile = await mkdtemp(path.join(os.tmpdir(), "adk-browser-checkbox-batch-test-"));
    browser = new BrowserManager({ headless: true, profileDir: path.join(profile, "chromium") });
    await browser.launch(`${baseUrl}checkbox-task`);

    const snapshot = await browser.inspect();
    const refs = snapshot.candidates.filter((candidate) => candidate.kind === "checkbox").map((candidate) => candidate.ref);
    const submit = snapshot.candidates.find((candidate) => candidate.label === "Submit");
    expect(refs).toHaveLength(2);
    expect(submit).toBeDefined();
    await expect(browser.setCheckboxes([...refs, submit!.ref], true)).rejects.toThrow("Only visible native checkboxes");
    await expect(browser.setCheckboxes([refs[0]!, refs[0]!], true)).rejects.toThrow("Each checkbox ref must be unique");

    const result = await browser.setCheckboxes(refs, true);
    expect(result).toMatchObject({ status: "updated", count: 2, changedCount: 2, submitted: false, valueReturned: false });
    expect(JSON.stringify(result)).not.toContain("Neb");
    const page = (browser as unknown as { page: Page }).page;
    expect(await page.locator('input[type="checkbox"]').count()).toBe(2);
    expect(await page.locator('input[type="checkbox"]').nth(0).isChecked()).toBe(true);
    expect(await page.locator('input[type="checkbox"]').nth(1).isChecked()).toBe(true);
    expect(await page.locator("#status").innerText()).toBe("Not sent");

    const repeated = await browser.setCheckboxes(refs, true);
    expect(repeated).toMatchObject({ status: "updated", count: 2, changedCount: 0, submitted: false });
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

async function findAvailablePort() {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not reserve a local port for the Chrome CDP test");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

async function waitForDevTools(endpoint: string) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${endpoint}/json/version`);
      if (response.ok) return;
    } catch {
      // Chrome may need a short moment to open the remote debugging port.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The isolated Chrome test profile did not expose its loopback DevTools endpoint");
}
