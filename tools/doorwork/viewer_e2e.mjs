import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { mkdirSync } from "fs";

const CARS = {
  golf: "Golf MK4 GTI", mercedes: "S 63 AMG", audi: "RS 6 Avant", mustang: "Mustang GT",
  ferrari: "458 Italia", r8: "R8", challenger: "Challenger", rangerover: "Range Rover",
};
const DOORS = ["FL", "FR", "RL", "RR"];
const OUT = "/home/user/Claude-shooter/tools/doorwork/renders/viewer";
mkdirSync(OUT, { recursive: true });

const exePath = await chromium.executablePath();
const browser = await puppeteer.launch({
  executablePath: exePath,
  args: [...chromium.args, "--enable-unsafe-swiftshader"],
  headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al2023-libs/lib" },
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); });
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

const clickBtn = async (label) => {
  await page.evaluate((l) => {
    const norm = (s) => s.toLowerCase().replace(/\s+/g, "");
    const b = [...document.querySelectorAll("button")].find((x) => norm(x.textContent).includes(norm(l)));
    if (!b) throw new Error("no button " + l);
    b.click();
  }, label);
};

await page.goto("http://localhost:5173/", { waitUntil: "networkidle2", timeout: 60000 });
await page.waitForSelector("canvas", { timeout: 30000 });
await new Promise((r) => setTimeout(r, 1500));

for (const [id, name] of Object.entries(CARS)) {
  await clickBtn(name);
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: `${OUT}/${id}_closed.png` });
  await clickBtn("Open all");
  await new Promise((r) => setTimeout(r, 1900));
  await page.screenshot({ path: `${OUT}/${id}_open.png` });
  await clickBtn("Close");
  await new Promise((r) => setTimeout(r, 800));
  // per-door swings
  for (const d of DOORS) {
    const disabled = await page.evaluate((l) => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === l);
      return !b || b.disabled;
    }, d);
    if (disabled) { console.log(id, d, "n/a"); continue; }
    await page.screenshot({ path: `${OUT}/${id}_base.png` });
    await clickBtn(d);
    await new Promise((r) => setTimeout(r, 1200));
    await page.screenshot({ path: `${OUT}/${id}_${d}.png` });
    await clickBtn(d);
    await new Promise((r) => setTimeout(r, 800));
  }
  console.log("OK", id, name);
}
console.log("CONSOLE-ERRORS:", errors.length ? errors.slice(0, 10) : "none");
await browser.close();
