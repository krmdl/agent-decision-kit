#!/usr/bin/env node
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "website", "dist");
const site = new URL(process.env.SITE_URL ?? "https://krmdl.github.io/agent-decision-kit/");
const basePath = site.pathname.endsWith("/") ? site.pathname : `${site.pathname}/`;
const files = await walk(root);
const demoAsset = path.join(root, "demos", "visual-only-demo.html");
const htmlFiles = files.filter((file) => file.endsWith(".html") && path.resolve(file) !== demoAsset);
const canonicals = new Set();
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

for (const file of htmlFiles) {
  const html = await readFile(file, "utf8");
  const relativePagePath = path.relative(root, file).split(path.sep).join("/").replace(/(?:^|\/)index\.html$/, "");
  const canonical = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/i)?.[1];
  const title = html.match(/<title>(.*?)<\/title>/is)?.[1]?.trim();
  const description = html.match(/<meta\s+name="description"\s+content="([^"]+)"/i)?.[1];
  const robots = html.match(/<meta\s+name="robots"\s+content="([^"]+)"/i)?.[1];
  const ogUrl = html.match(/<meta\s+property="og:url"\s+content="([^"]+)"/i)?.[1];
  const jsonLd = [...html.matchAll(/<script\s+type="application\/ld\+json">(.*?)<\/script>/gis)];

  check(Boolean(title && title.length <= 70), `${path.relative(root, file)}: missing or overlong title`);
  check(Boolean(description && description.length >= 50 && description.length <= 180), `${path.relative(root, file)}: missing or unsuitable description`);
  check(robots === "index,follow,max-image-preview:large", `${path.relative(root, file)}: incorrect robots directive`);
  const expectedCanonical = new URL(`${basePath}${relativePagePath ? `${relativePagePath}/` : ""}`, site.origin).href;
  check(Boolean(canonical && canonical === expectedCanonical), `${path.relative(root, file)}: canonical URL does not match the page`);
  check(Boolean(canonical && ogUrl === canonical), `${path.relative(root, file)}: Open Graph URL does not match canonical`);
  check(Boolean(canonical && !canonicals.has(canonical)), `${path.relative(root, file)}: duplicate canonical URL`);
  if (canonical) canonicals.add(canonical);
  check(jsonLd.length > 0, `${path.relative(root, file)}: missing JSON-LD`);
  for (const match of jsonLd) {
    try { JSON.parse(match[1]); }
    catch { check(false, `${path.relative(root, file)}: invalid JSON-LD`); }
  }

  for (const [, attribute, value] of html.matchAll(/<(?:a|img|script|link)\b[^>]*?\s(href|src)="([^"]+)"/gi)) {
    if (attribute.toLowerCase() === "href" && value.startsWith("#")) continue;
    const target = new URL(value.replaceAll("&amp;", "&"), site);
    if (target.origin !== site.origin) continue;
    const publicPath = decodeURIComponent(target.pathname);
    if (!publicPath.startsWith(basePath)) {
      check(false, `${path.relative(root, file)}: local URL escapes the configured site base: ${value}`);
      continue;
    }
    const relative = publicPath.slice(basePath.length);
    let destination = path.resolve(root, relative);
    if (publicPath.endsWith("/") || !path.extname(destination)) destination = path.join(destination, "index.html");
    try { await stat(destination); }
    catch { check(false, `${path.relative(root, file)}: broken local ${attribute}: ${value}`); }
  }
}

check(htmlFiles.length >= 20, `expected at least 20 useful HTML pages, found ${htmlFiles.length}`);

const robots = await readFile(path.join(root, "robots.txt"), "utf8");
check(robots.includes(new URL("sitemap-index.xml", site).href), "robots.txt does not point to the sitemap index");
const visualDemo = await readFile(demoAsset, "utf8");
check(/<meta\s+name="robots"\s+content="noindex,nofollow"/i.test(visualDemo), "visual-only demo asset must stay out of search results");
const sitemapIndex = await readFile(path.join(root, "sitemap-index.xml"), "utf8");
const sitemapLocations = [...sitemapIndex.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
check(sitemapLocations.length > 0, "sitemap index contains no sitemap locations");
for (const location of sitemapLocations) {
  const pathname = new URL(location).pathname;
  try { await stat(path.join(root, pathname.slice(basePath.length))); }
  catch { check(false, `sitemap index points to a missing file: ${location}`); }
}
const sitemapFile = path.join(root, "sitemap-0.xml");
try {
  const sitemap = await readFile(sitemapFile, "utf8");
  for (const match of sitemap.matchAll(/<loc>(.*?)<\/loc>/g)) {
    check(canonicals.has(match[1]), `sitemap URL has no matching page canonical: ${match[1]}`);
  }
} catch { check(false, "missing sitemap-0.xml"); }

for (const image of ["images/logo.svg", "images/social-preview.png", "images/demo-browser.png", "images/visual-only-demo.png", "images/browser-demo.gif", "images/browser-drag-demo.png", "images/architecture.svg", "images/decision-flow.svg", "demos/visual-only-demo.html"]) {
  try { await stat(path.join(root, image)); }
  catch { check(false, `missing visual asset ${image}`); }
}

if (failures.length) {
  process.stderr.write(`${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`Site checks passed: ${htmlFiles.length} pages, unique canonical URLs, valid JSON-LD, internal links, sitemap, robots.txt, and visual assets.\n`);
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const children = await Promise.all(entries.map((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : Promise.resolve([target]);
  }));
  return children.flat();
}
