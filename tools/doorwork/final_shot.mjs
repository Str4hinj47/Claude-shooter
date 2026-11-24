import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
const exePath = await chromium.executablePath();
const browser = await puppeteer.launch({
  executablePath: exePath,
  args: [...chromium.args, "--enable-unsafe-swiftshader"],
  headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al2023-libs/lib" },
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
await page.goto("http://localhost:5173/", { waitUntil: "networkidle2", timeout: 60000 });
await page.waitForSelector("canvas", { timeout: 30000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const click = async (l) => page.evaluate((label) => {
  const norm = (s) => s.toLowerCase().replace(/\s+/g, "");
  [...document.querySelectorAll("button")].find((x) => norm(x.textContent).includes(norm(label)))?.click();
}, l);
await click("458 Italia");
await sleep(4000);
await click("Open all");
await sleep(6000);
await page.screenshot({ path: "/home/user/Claude-shooter/tools/doorwork/renders/viewer/final_ferrari.png" });
console.log("SHOT saved");
await browser.close();
