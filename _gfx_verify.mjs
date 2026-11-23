import fs from "node:fs";
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "/tmp/chromium",
  headless: "shell",
  env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al2023/lib" },
  args: ["--no-sandbox", "--disable-setuid-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader", "--disable-dev-shm-usage", "--mute-audio"],
  defaultViewport: { width: 960, height: 540 },
});
const errors = [];
try {
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error") errors.push(`console.error: ${m.text()}`); });

  await page.goto("http://127.0.0.1:4181/", { waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForSelector("button", { timeout: 15000 });
  await page.evaluate(() => {
    const raw = localStorage.getItem("vanguard_blackout_save_v1");
    const save = raw ? JSON.parse(raw) : {};
    save.unlocked = 6;
    localStorage.setItem("vanguard_blackout_save_v1", JSON.stringify(save));
  });
  await page.reload({ waitUntil: "domcontentloaded", timeout: 25000 });
  await page.waitForFunction(() => /6\s*\/\s*6\s*unlocked/i.test(document.body.innerText), { polling: 200, timeout: 20000 });

  // Open Controls screen
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => /Field Manual/i.test(b.textContent || ""))?.click();
  });
  await page.waitForFunction(() => /Stealth Doctrine/i.test(document.body.innerText), { polling: 200, timeout: 10000 });
  const controlsText = await page.evaluate(() => document.body.innerText);

  // Back -> Missions -> ROOFTOPS -> Deploy
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => /Back/i.test(b.textContent || ""))?.click();
  });
  await page.waitForFunction(() => /MISSIONS/i.test(document.body.innerText), { polling: 200, timeout: 10000 });
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => /MISSIONS/i.test(b.textContent || ""))?.click();
  });
  await page.waitForFunction(() => /ROOFTOPS/i.test(document.body.innerText), { polling: 200, timeout: 10000 });
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => /ROOFTOPS/i.test(b.textContent || ""))?.click();
  });
  await page.waitForFunction(() => /Downtown District/i.test(document.body.innerText), { polling: 200, timeout: 10000 });
  await page.evaluate(() => {
    [...document.querySelectorAll("button")].find((b) => /^Deploy$/i.test((b.textContent || "").trim()))?.click();
  });

  await page.waitForFunction(() => window.__game?.getPhase?.() === "ready", { polling: 250, timeout: 35000 });

  // Verify backup keys are ignored
  await page.keyboard.down("ArrowUp");
  await page.keyboard.down("KeyF");
  await page.keyboard.down("KeyZ");
  await page.keyboard.down("ControlLeft");
  await new Promise((r) => setTimeout(r, 350));
  const backupCheck = await page.evaluate(() => {
    const g = window.__game;
    return { rigPosZ: g.rig.root.position.z, ads: g.rig.input.ads, crouch: g.rig.input.crouch, mag: g.rig.mag };
  });
  await page.keyboard.up("ArrowUp");
  await page.keyboard.up("KeyF");
  await page.keyboard.up("KeyZ");
  await page.keyboard.up("ControlLeft");

  // Position player along avenue looking north near patrolling guard (-2, -4..12) + streetlights
  await page.evaluate(() => {
    const g = window.__game;
    g.rig.root.position.set(0, 0, 22);
    g.camYaw = g.yaw = Math.PI;
    g.camPitch = g.pitch = -0.02;
  });
  await new Promise((r) => setTimeout(r, 1500));

  const m3Info = await page.evaluate(() => {
    const g = window.__game;
    return {
      enemiesWithFlashlights: g.enemies.filter((e) => Boolean(e.flashlightMount)).length,
      pooledGuardSpotLights: g.guardFlashlights.length,
      activeGuardSpotLights: g.guardFlashlights.filter((s) => s.visible).length,
      hasSvgCrosshair: Boolean(document.querySelector("svg circle")),
      hudHasCodename: /ROOFTOPS/i.test(document.body.innerText),
    };
  });

  console.log(JSON.stringify({
    controlsHasNoBackups: !/LMB \/ F|RMB \/ Z|C \/ Ctrl|Scroll \/ 1-4/i.test(controlsText),
    backupKeysIgnored: backupCheck.rigPosZ === 46 && !backupCheck.ads && !backupCheck.crouch && backupCheck.mag === 30,
    m3Info,
    errors,
  }, null, 2));

  // Take one screenshot cleanly
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("/tmp/gfx_m3_hud.png", Buffer.from(data, "base64"));
  console.log("saved /tmp/gfx_m3_hud.png");
} finally {
  await browser.close();
}
