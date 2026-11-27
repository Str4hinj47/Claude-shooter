/*
 * Phase 3 proximity-streaming check for CityShops clerk hydration.
 *
 * Confirms that:
 *   1. A fresh CityShopsManager does NOT request clerk GLBs during construction
 *      (the boot-time skinned-mesh cost is gone).
 *   2. update() only hydrates a clerk once the player is within 95 m.
 *   3. Hydration is idempotent (one GLB request per store).
 *
 * Usage: URL=http://localhost:5173/ node test/clerk-hydration-check.mjs
 */
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const URL = process.env.URL || "http://localhost:5173/";

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
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });

const report = await page.evaluate(async () => {
  const mod = await import("/src/game/city/CityShops.ts");
  const stores = mod.WESTGATE_STORES;
  const requests = [];
  const netLog = [];

  // GLTFLoader -> FileLoader uses fetch(); count both fetch and XHR so the
  // probe is transport-agnostic.
  const origFetch = window.fetch;
  window.fetch = (...args) => {
    const u = String(args[0] instanceof Request ? args[0].url : args[0]);
    netLog.push(`fetch ${u}`);
    if (u.includes("/characters/")) requests.push(u);
    return origFetch(...args);
  };
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    const u = String(url);
    netLog.push(`xhr ${u}`);
    if (u.includes("/characters/")) requests.push(u);
    return origOpen.call(this, method, url, ...rest);
  };

  // Positive control: prove the instrumentation can observe a clerk GLB load
  // even when the module-level promise cache is already warm.
  const { loadCachedSoldierGltf } = await import("/src/character/SoldierRig.ts");
  const { characterUrl } = await import("/src/game/characters.ts");
  await loadCachedSoldierGltf(characterUrl("firefighter")).catch(() => {});
  const afterControl = requests.length;
  requests.length = 0;

  const terrainAt = () => 0;
  const mgr = new mod.CityShopsManager(terrainAt);
  const afterConstruct = requests.length;

  const far = { x: stores[0].x + 100000, z: stores[0].z + 100000, y: 0 };
  mgr.update(0.016, far);
  await new Promise((r) => setTimeout(r, 1200));
  const afterFarUpdate = requests.length;

  const target = stores[0];
  mgr.update(0.016, { x: target.x + 5, z: target.z, y: 0 });
  await new Promise((r) => setTimeout(r, 5000));
  const afterNearUpdate = requests.length;

  // Re-running update must not re-request for already-hydrated clerks.
  mgr.update(0.016, { x: target.x + 5, z: target.z, y: 0 });
  await new Promise((r) => setTimeout(r, 1500));
  const afterRepeatUpdate = requests.length;

  window.fetch = origFetch;
  XMLHttpRequest.prototype.open = origOpen;
  return {
    storeCount: stores.length,
    afterControl,
    afterConstruct,
    afterFarUpdate,
    afterNearUpdate,
    afterRepeatUpdate,
    targets: requests.map((u) => u.split("/").pop()),
    netLogSample: netLog.slice(0, 12),
    hydratedFlags: mgr.stores.map((s) => s.clerkHydrated),
  };
});

await browser.close();

console.log(JSON.stringify(report, null, 2));
console.log("\npage errors:", errors.length === 0 ? "none ✔" : errors);

const checks = [
  ["no clerk GLB requested during construction", report.afterConstruct === 0],
  ["no clerk GLB requested while player is 100 km away", report.afterFarUpdate === 0],
  ["exactly one clerk GLB requested on approach", report.afterNearUpdate === 1],
  ["repeat update does not re-request", report.afterRepeatUpdate === report.afterNearUpdate],
  ["only the approached store is hydrated", report.hydratedFlags.filter(Boolean).length === 1],
  ["no page errors", errors.length === 0],
];

let ok = true;
for (const [label, pass] of checks) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) ok = false;
}
console.log(ok ? "\nCLERK HYDRATION: PASS ✔" : "\nCLERK HYDRATION: FAIL ✘");
process.exit(ok ? 0 : 1);
