import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BrowserManager } from "../src/browser/manager.js";

describe("Playwright browser safety flow", () => {
  let server: Server;
  let baseUrl = "";
  let profile = "";
  let browser: BrowserManager;

  beforeAll(async () => {
    const html = await readFile(path.resolve("examples/browser-demo.html"));
    server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(html);
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
});
