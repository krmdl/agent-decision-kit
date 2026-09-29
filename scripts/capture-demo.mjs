#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(import.meta.dirname, "..");
const imageDir = path.join(root, "website", "public", "images");
const demoFile = path.join(root, "examples", "browser-demo.html");
const scratch = await mkdtemp(path.join(os.tmpdir(), "agent-decision-demo-"));
await mkdir(imageDir, { recursive: true });
let browser;

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, recordVideo: { dir: scratch, size: { width: 1180, height: 820 } } });
  const page = await context.newPage();
  await page.goto(pathToFileURL(demoFile).href, { waitUntil: "load" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(imageDir, "demo-browser.png"), fullPage: true });
  await page.waitForTimeout(700);
  await page.getByRole("button", { name: "Mark setup task complete" }).click();
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Save local draft" }).click();
  await page.waitForTimeout(1_300);
  const videoPath = await page.video().path();
  await context.close();

  const gifPath = path.join(imageDir, "browser-demo.gif");
  const palettePath = path.join(scratch, "palette.png");
  const palette = spawnSync("ffmpeg", ["-y", "-i", videoPath, "-vf", "fps=6,scale=900:-1:flags=lanczos,palettegen=stats_mode=diff", palettePath], { encoding: "utf8" });
  if (palette.status !== 0) throw new Error(`ffmpeg palette generation failed: ${palette.stderr}`);
  const gif = spawnSync("ffmpeg", ["-y", "-i", videoPath, "-i", palettePath, "-lavfi", "fps=6,scale=900:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer", gifPath], { encoding: "utf8" });
  if (gif.status !== 0) throw new Error(`ffmpeg GIF conversion failed: ${gif.stderr}`);

  const cardPath = path.join(imageDir, "social-preview.png");
  const cardPage = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const logo = `data:image/svg+xml;base64,${(await readFile(path.join(imageDir, "logo.svg"))).toString("base64")}`;
  await cardPage.setContent(`<!doctype html><html lang="en"><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:radial-gradient(ellipse at 12% 4%,#1c4054,transparent 43%),#08111f;color:#edf3fb;font-family:Inter,Segoe UI,Arial,sans-serif;padding:62px 74px}.top{display:flex;align-items:center;gap:17px;color:#b2c5d6;font-size:17px;font-weight:700;letter-spacing:.02em}.top img{display:block;width:62px;height:62px}h1{font-size:71px;line-height:.98;letter-spacing:-5px;margin:54px 0 17px}h1 span{color:#75e2c2}.sub{max-width:810px;color:#b5c6d5;font-size:24px;line-height:1.45}.pills{display:flex;gap:12px;margin-top:43px}.pills span{border:1px solid #34516a;padding:11px 16px;border-radius:99px;font-size:14px;color:#d8e6f3}.mark{position:absolute;right:74px;bottom:52px;color:#75e2c2;font:700 15px ui-monospace,monospace;letter-spacing:.08em}</style><body><div class="top"><img src="${logo}" alt=""><span>AGENT DECISION KIT</span></div><h1>Small decisions.<br><span>Clear browser actions.</span></h1><div class="sub">Local-first MCP tools for coding agents. Playwright · typed choices · human approval for sensitive actions.</div><div class="pills"><span>Apache-2.0</span><span>Local by default</span><span>Experimental alpha</span></div><div class="mark">NO UNSUPPORTED BENCHMARK CLAIMS</div></body></html>`, { waitUntil: "load" });
  await cardPage.screenshot({ path: cardPath });
  process.stdout.write(`${JSON.stringify({ screenshot: path.relative(root, path.join(imageDir, "demo-browser.png")), gif: path.relative(root, gifPath), socialPreview: path.relative(root, cardPath) }, null, 2)}\n`);
} finally {
  await browser?.close().catch(() => undefined);
  await rm(scratch, { recursive: true, force: true });
}
