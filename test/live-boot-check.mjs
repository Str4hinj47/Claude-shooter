/*
 * Live headless boot verification (SwiftShader).
 *
 * Boots the real app, clicks "1-Click Safe Spawn (Low VRAM)", waits for the
 * Westgate open world to reach phase === "ready", captures a screenshot, and
 * asserts that zero "Texture marked for update but no image data found"
 * warnings were emitted.
 *
 * Usage: URL=http://localhost:5173/ node test/live-boot-check.mjs
 */
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";
import { mkdirSync } from "node:fs";

const URL = process.env.URL || "http://localhost:5173/";
const SHOT_DIR = process.env.SHOT_DIR || "test/shots";
const SHOT_NAME = process.env.SHOT_NAME || "live-boot-safe-spawn";
const READY_TIMEOUT_MS = Number(process.env.READY_TIMEOUT_MS || 180000);

mkdirSync(SHOT_DIR, { recursive: true });

const errors = [];
const texWarnings = [];
const allLogs = [];

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [
    ...chromium.args,
    "--no-sandbox",
    "--enable-unsafe-swiftshader",
    "--use-gl=angle",
    "--use-angle=swiftshader",
    "--disable-dev-shm-usage",
    "--mute-audio",
  ],
  defaultViewport: { width: 1280, height: 720 },
  headless: "shell",
});

const page = await browser.newPage();
page.on("console", (msg) => {
  const t = msg.text();
  allLogs.push(t);
  if (t.includes("Texture marked for update")) texWarnings.push(t);
  if (msg.type() === "error") errors.push(`[console.error] ${t}`);
});
page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
page.on("requestfailed", (req) => {
  const u = req.url();
  if (!u.includes("favicon")) errors.push(`[requestfailed] ${u} — ${req.failure()?.errorText}`);
});

const result = { phase: null, ready: false, telemetry: null, menuVisible: false, shot: null };

try {
  console.log("→ loading", URL);
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });

  // The launcher runs a WebGL capability probe before rendering its launch
  // buttons, so poll instead of assuming a fixed delay.
  const lt0 = Date.now();
  while (Date.now() - lt0 < 60000) {
    result.menuVisible = await page.evaluate(() =>
      [...document.querySelectorAll("button")].some((b) =>
        b.textContent?.includes("Safe Spawn"),
      ),
    );
    if (result.menuVisible) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  console.log(
    "launcher ready:",
    result.menuVisible,
    `(+${((Date.now() - lt0) / 1000).toFixed(1)}s)`,
  );
  if (!result.menuVisible) throw new Error("Launcher UI never rendered");

  // 1-Click Safe Spawn (Low VRAM) -> preset "safe", autoStartOpenWorld: true
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("1-Click Safe Spawn"),
    );
    btn?.click();
  });
  console.log("→ clicked '1-Click Safe Spawn (Low VRAM)'");

  const t0 = Date.now();
  let lastPhase = "<none>";
  while (Date.now() - t0 < READY_TIMEOUT_MS) {
    const st = await page.evaluate(() => {
      const g = window.__game;
      if (!g) return { phase: null };
      let telemetry = null;
      try {
        telemetry = g.engineTelemetry ?? g.level?.engineTelemetry ?? null;
      } catch {
        /* ignore */
      }
      return { phase: typeof g.getPhase === "function" ? g.getPhase() : null, telemetry };
    });
    if (st.phase && st.phase !== lastPhase) {
      lastPhase = st.phase;
      console.log(`   phase: ${st.phase} (+${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    }
    if (st.phase === "ready") {
      result.phase = st.phase;
      result.ready = true;
      result.telemetry = st.telemetry;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  // let a few frames render so late texture uploads surface their warnings
  await new Promise((r) => setTimeout(r, 4000));

  result.telemetry = await page.evaluate(() => {
    const g = window.__game;
    try {
      return g?.engineTelemetry ?? g?.level?.engineTelemetry ?? null;
    } catch {
      return null;
    }
  });

  result.shot = `${SHOT_DIR}/${SHOT_NAME}.png`;
  await page.screenshot({ path: result.shot });
  console.log("shot:", result.shot);

  result.world = await page.evaluate(() => {
    const g = window.__game;
    return g
      ? {
          enemies: g.enemies?.length ?? null,
          colliders: g.level?.colliders?.length ?? null,
          objectives: g.objectives?.map((o) => o.label) ?? null,
        }
      : null;
  });
} catch (e) {
  errors.push(`[test-exception] ${e.message}`);
}

await browser.close();

console.log("\n================ LIVE BOOT RESULT ================");
console.log("menu visible        :", result.menuVisible);
console.log("phase               :", result.phase);
console.log("phase === 'ready'   :", result.ready ? "YES" : "NO");
console.log("screenshot          :", result.shot);
console.log("engine telemetry    :", JSON.stringify(result.telemetry));
console.log("world               :", JSON.stringify(result.world));
console.log("-----------------------------------------------");
console.log("'Texture marked for update but no image data found' warnings:", texWarnings.length);
texWarnings.slice(0, 10).forEach((w) => console.log("   ", w));
console.log("console errors / page errors / failed requests:", errors.length);
errors.slice(0, 25).forEach((e) => console.log("   ", e));
console.log("===============================================");

const ok = result.ready && texWarnings.length === 0 && errors.length === 0;
console.log(ok ? "LIVE BOOT: PASS ✔" : "LIVE BOOT: FAIL ✘");
process.exit(ok ? 0 : 1);
