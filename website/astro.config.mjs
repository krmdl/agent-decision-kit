import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

const site = new URL(process.env.SITE_URL ?? "https://krmdl.github.io/agent-decision-kit/");
const base = site.pathname.replace(/\/$/, "") || "/";

export default defineConfig({
  site: site.href,
  base,
  output: "static",
  integrations: [sitemap()],
});
