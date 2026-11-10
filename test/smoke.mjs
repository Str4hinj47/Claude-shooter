/* Headless smoke test: loads the game, deploys missions, plays, reports errors. */
import puppeteer from "puppeteer-core";
import chromium from "@sparticuz/chromium";

const URL = process.env.URL || "http://localhost:5173/";
const errors = [];
const logs = [];

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
  logs.push(t);
  if (msg.type() === "error") errors.push(`[console.error] ${t}`);
});
page.on("pageerror", (err) => errors.push(`[pageerror] ${err.message}`));
page.on("requestfailed", (req) => {
  const u = req.url();
  if (!u.includes("favicon")) errors.push(`[requestfailed] ${u} — ${req.failure()?.errorText}`);
});

async function shot(name) {
  await page.screenshot({ path: `test/shots/${name}.png` });
  console.log("shot:", name);
}

try {
  console.log("→ loading", URL);
  await page.goto(URL, { waitUntil: "networkidle2", timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  await shot("01-menu");

  // sanity: menu rendered?
  const hasMenu = await page.evaluate(() => document.body.innerText.includes("Blackout Protocol"));
  console.log("menu visible:", hasMenu);

  // deploy mission 1 (First Light)
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll("button")];
    const m1 = cards.find((b) => b.textContent?.includes("FIRST LIGHT"));
    m1?.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  await shot("02-briefing");
  const briefOk = await page.evaluate(() => document.body.innerText.includes("Deploy"));
  console.log("briefing visible:", briefOk);

  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    btns.find((b) => b.textContent?.trim() === "Deploy")?.click();
  });
  console.log("→ deployed mission 1, waiting for ready…");
  await new Promise((r) => setTimeout(r, 9000));
  await shot("03-mission1-ready");

  const state1 = await page.evaluate(() => {
    const g = window.__game;
    return g
      ? {
          phase: g.getPhase(),
          enemies: g.enemies?.length,
          world: g.level?.colliders?.length,
          aabbs: g.level?.aabbs?.length,
          objectives: g.objectives?.map((o) => o.label + (o.done ? " [done]" : "")),
        }
      : "no game";
  });
  console.log("mission1 state:", JSON.stringify(state1));

  // play: move + fire for a few seconds
  await page.keyboard.down("KeyW");
  await new Promise((r) => setTimeout(r, 1500));
  await page.keyboard.up("KeyW");
  await page.keyboard.down("KeyD");
  await new Promise((r) => setTimeout(r, 800));
  await page.keyboard.up("KeyD");
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("KeyF");
    await new Promise((r) => setTimeout(r, 200));
  }
  await shot("04-mission1-play");
  const play1 = await page.evaluate(() => {
    const g = window.__game;
    return g ? { phase: g.getPhase(), health: g.health, killed: g.killed, dialogue: g.dialogue?.speaker } : "no game";
  });
  console.log("after play:", JSON.stringify(play1));

  // mission 2 (construction site)
  await page.evaluate(() => {
    document.querySelector("canvas")?.blur();
  });
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 500));
  // quit to menu via pause overlay
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    btns.find((b) => b.textContent?.includes("Quit to menu"))?.click();
  });
  await new Promise((r) => setTimeout(r, 800));
  await shot("05-menu-again");

  await page.evaluate(() => {
    const cards = [...document.querySelectorAll("button")];
    cards.find((b) => b.textContent?.includes("CONCRETE HEART"))?.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    btns.find((b) => b.textContent?.trim() === "Deploy")?.click();
  });
  console.log("→ deployed mission 2…");
  await new Promise((r) => setTimeout(r, 9000));
  await shot("06-mission2");
  const state2 = await page.evaluate(() => {
    const g = window.__game;
    return g ? { phase: g.getPhase(), enemies: g.enemies?.length, destroyables: g.level?.destroyables?.length } : "no game";
  });
  console.log("mission2 state:", JSON.stringify(state2));

  // mission 4 (port, night) + mission 5 (HQ, storm) quick load checks
  for (const [name, code] of [["M4", "IRON TIDE"], ["M5", "BLACKOUT"]]) {
    await page.evaluate(() => {
      document.querySelector("canvas")?.blur();
    });
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 400));
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      btns.find((b) => b.textContent?.includes("Quit to menu"))?.click();
    });
    await new Promise((r) => setTimeout(r, 700));
    await page.evaluate((c) => {
      const cards = [...document.querySelectorAll("button")];
      cards.find((b) => b.textContent?.includes(c))?.click();
    }, code);
    await new Promise((r) => setTimeout(r, 500));
    await page.evaluate(() => {
      const btns = [...document.querySelectorAll("button")];
      btns.find((b) => b.textContent?.trim() === "Deploy")?.click();
    });
    console.log("→ deployed", name);
    await new Promise((r) => setTimeout(r, 9000));
    await shot(`07-${name}`);
    const st = await page.evaluate(() => {
      const g = window.__game;
      return g ? { phase: g.getPhase(), enemies: g.enemies?.length, ally: !!g.ally, world: g.level?.colliders?.length } : "no game";
    });
    console.log(name, "state:", JSON.stringify(st));
  }

  // back to menu, check final errors
  await page.evaluate(() => {
    document.querySelector("canvas")?.blur();
  });
  await page.keyboard.press("Escape");
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    btns.find((b) => b.textContent?.includes("Quit to menu"))?.click();
  });
  await new Promise((r) => setTimeout(r, 600));
  await shot("08-menu-final");
} catch (e) {
  errors.push(`[test-exception] ${e.message}`);
}

console.log("\n===== CONSOLE ERRORS =====");
if (errors.length === 0) console.log("none ✔");
else errors.slice(0, 40).forEach((e) => console.log(e));
console.log("\n===== last 15 console logs =====");
logs.slice(-15).forEach((l) => console.log(l));

await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
