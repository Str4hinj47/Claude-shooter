/*
 * Boot performance harness (headless Chromium + SwiftShader).
 *
 * Measures the metrics the optimisation playbook tracks:
 *   BUILD_WORLD_MS   - phase "loading" -> "ready"
 *   FIRST_RENDER_MS  - click -> first presented frame
 *   calls / tris     - first-frame renderer.info
 *   click-to-ready   - 1-Click Safe Spawn (Low VRAM)
 * and asserts zero texture warnings / console errors.
 *
 * Screenshots use CDP Page.captureScreenshot (page.screenshot() yields black
 * viewports under SwiftShader) after a rAF settle.
 *
 * Usage: URL=http://localhost:5173/ node test/boot-perf.mjs
 */
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { mkdirSync, writeFileSync } from "node:fs";

const URL = process.env.URL || "http://localhost:5173/";
const SHOT_DIR = process.env.SHOT_DIR || "test/shots";
const LABEL = process.env.LABEL || "boot-perf";
const READY_TIMEOUT_MS = Number(process.env.READY_TIMEOUT_MS || 180000);

mkdirSync(SHOT_DIR, { recursive: true });

const errors = [];
const texWarnings = [];

const browser = await puppeteer.launch({
  protocolTimeout: 180000,
  executablePath: await chromium.executablePath(),
  args: [
    ...chromium.args,
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--ignore-gpu-blocklist",
    "--disable-dev-shm-usage",
    "--mute-audio",
  ],
  defaultViewport: { width: 1280, height: 720 },
  headless: "shell",
});

const page = await browser.newPage();
page.on("console", (msg) => {
  const t = msg.text();
  if (t.includes("Texture marked for update")) texWarnings.push(t);
  if (msg.type() === "error") errors.push(`[console.error] ${t}`);
});
page.on("pageerror", (err) => errors.push(`[pageerror] ${err.stack || err.message}`));
page.on("requestfailed", (req) => {
  const u = req.url();
  if (!u.includes("favicon")) errors.push(`[requestfailed] ${u} — ${req.failure()?.errorText}`);
});

const cdp = await page.createCDPSession();
const out = { label: LABEL, url: URL };

try {
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });

  // Wait for the launcher's WebGL probe to finish rendering the launch buttons.
  const lt0 = Date.now();
  while (Date.now() - lt0 < 60000) {
    const ready = await page.evaluate(() =>
      [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Safe Spawn")),
    );
    if (ready) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  out.launcherMs = Date.now() - lt0;

  // Long-task instrumentation covers the whole boot window.
  await page.evaluate(() => {
    window.__perf = { longTasks: 0, longTaskMs: 0 };
    try {
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          window.__perf.longTasks++;
          window.__perf.longTaskMs += e.duration;
        }
      }).observe({ entryTypes: ["longtask"] });
    } catch {}
  });

  const tClick = Date.now();
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Safe Spawn"))?.click();
  });

  // Sample phase transitions and first-render presence.
  const timeline = [];
  let lastPhase = "<none>";
  let firstRenderMs = null;
  while (Date.now() - tClick < READY_TIMEOUT_MS) {
    const st = await page.evaluate(() => {
      const g = window.__game;
      if (!g) return { phase: null, frames: 0 };
      const info = g.renderer?.info;
      return {
        phase: typeof g.getPhase === "function" ? g.getPhase() : null,
        frames: g.frameCount ?? (g.renderer?.info?.render?.frame ?? 0),
        info: info ? { calls: info.render.calls, tris: info.render.triangles } : null,
      };
    });
    const el = Date.now() - tClick;
    if (st.phase && st.phase !== lastPhase) {
      lastPhase = st.phase;
      timeline.push({ phase: st.phase, ms: el });
    }
    if (firstRenderMs === null && st.frames > 0) firstRenderMs = el;
    if (st.phase === "ready") {
      out.readyMs = el;
      out.firstFrameInfo = st.info;
      break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  out.firstRenderMs = firstRenderMs;
  out.timeline = timeline;
  out.buildWorldMs = out.readyMs != null && timeline.some((t) => t.phase === "loading")
    ? out.readyMs - timeline.find((t) => t.phase === "loading").ms
    : null;

  const perf = await page.evaluate(() => window.__perf ?? null);
  out.longTasks = perf?.longTasks ?? null;
  out.longTaskMs = perf?.longTaskMs ? Math.round(perf.longTaskMs) : null;

  // Let the first frames settle, then capture via CDP after a rAF.
  await new Promise((r) => setTimeout(r, 2500));
  await page.evaluate(
    () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res))),
  );
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  out.screenshot = `${SHOT_DIR}/${LABEL}.png`;
  writeFileSync(out.screenshot, Buffer.from(shot.data, "base64"));

  out.texWarnings = texWarnings.length;
  out.errors = errors.length;
} catch (e) {
  errors.push(`[harness-exception] ${e.message}`);
  out.errors = errors.length;
}

await browser.close();

out.ok = out.readyMs != null && texWarnings.length === 0 && errors.length === 0;

console.log("================ BOOT PERF ================");
console.log("label              :", out.label);
console.log("launcher ready     :", out.launcherMs, "ms");
console.log("click -> ready     :", out.readyMs, "ms");
console.log("  BUILD_WORLD_MS   :", out.buildWorldMs, "ms   (loading -> ready)");
console.log("  FIRST_RENDER_MS  :", out.firstRenderMs, "ms   (click -> first frame)");
console.log("first-frame calls  :", out.firstFrameInfo?.calls);
console.log("first-frame tris   :", out.firstFrameInfo?.tris);
console.log("long tasks         :", out.longTasks, `(${out.longTaskMs} ms blocked)`);
console.log("timeline           :", (out.timeline ?? []).map((t) => `${t.phase}@${t.ms}ms`).join(" -> "));
console.log("texture warnings   :", out.texWarnings);
console.log("console errors     :", out.errors);
errors.slice(0, 20).forEach((e) => console.log("   ", e));
console.log("screenshot         :", out.screenshot);
console.log("==========================================");
console.log(out.ok ? "BOOT PERF: PASS ✔" : "BOOT PERF: FAIL ✘");

writeFileSync(`${SHOT_DIR}/${LABEL}.json`, JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
