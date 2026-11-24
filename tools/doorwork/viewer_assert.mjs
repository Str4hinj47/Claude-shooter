import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";

const CARS = {
  golf: "Golf MK4 GTI", mercedes: "S 63 AMG", audi: "RS 6 Avant", mustang: "Mustang GT",
  ferrari: "458 Italia", r8: "R8", challenger: "Challenger", rangerover: "Range Rover",
};
const DOORS = ["FL", "FR", "RL", "RR"];

const exePath = await chromium.executablePath();
const browser = await puppeteer.launch({
  executablePath: exePath,
  args: [...chromium.args, "--enable-unsafe-swiftshader"],
  headless: true,
  env: { ...process.env, LD_LIBRARY_PATH: "/tmp/al2023-libs/lib" },
});
const page = await browser.newPage();
await page.setViewport({ width: 640, height: 420 });
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
const state = () => page.evaluate(() => window.__doorState ?? null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// poll until predicate(state) is true, or timeout
const waitFor = async (pred, timeoutMs = 30000, label = "") => {
  const t0 = Date.now();
  for (;;) {
    const s = await state();
    if (s && pred(s)) return s;
    if (Date.now() - t0 > timeoutMs) return s; // return last state (caller asserts)
    await sleep(400);
  }
};

await page.goto("http://localhost:5173/", { waitUntil: "networkidle2", timeout: 60000 });
await page.waitForSelector("canvas", { timeout: 30000 });
await sleep(1200);

let failures = 0;
for (const [id, name] of Object.entries(CARS)) {
  const problems = [];
  await clickBtn(name);
  // wait until the viewer reports this car with all doors near 0
  let s = await waitFor((st) => st.car === id && Object.values(st.deg).every((d) => Math.abs(d) < 1.5), 40000, "closed");
  const keys = s.car === id ? Object.keys(s.deg) : [];
  if (s.car !== id) problems.push(`car=${s.car}`);
  else {
    for (const k of keys) if (Math.abs(s.deg[k]) > 1.5) problems.push(`${k} start=${s.deg[k].toFixed(1)}`);
    // open all doors
    await clickBtn("Open all");
    s = await waitFor((st) => st.car === id && keys.every((k) => Math.abs(Math.abs(st.deg[k]) - 62) < 3), 40000, "open");
    for (const k of keys) {
      const d = s.deg[k] ?? 0;
      if (Math.abs(Math.abs(d) - 62) > 3) problems.push(`${k} open=${d.toFixed(1)}`);
    }
    // close and toggle each door individually
    await clickBtn("Close");
    s = await waitFor((st) => st.car === id && keys.every((k) => Math.abs(st.deg[k]) < 1.5), 40000, "close");
    for (const d of DOORS) {
      const k = d.toLowerCase();
      if (!keys.includes(k)) continue;
      await clickBtn(d);
      s = await waitFor((st) => st.car === id && Math.abs(Math.abs(st.deg[k]) - 62) < 3 && keys.filter((o) => o !== k).every((o) => Math.abs(st.deg[o]) < 1.5), 40000, `solo ${k}`);
      if (Math.abs(Math.abs(s.deg[k] ?? 0) - 62) > 3) problems.push(`${k} solo=${(s.deg[k] ?? 0).toFixed(1)}`);
      for (const o of keys) if (o !== k && Math.abs(s.deg[o]) > 1.5) problems.push(`${o} leak=${s.deg[o].toFixed(1)}`);
      await clickBtn(d);
      await waitFor((st) => st.car === id && keys.every((o) => Math.abs(st.deg[o]) < 1.5), 40000, `re-close ${k}`);
    }
  }
  console.log(`${id.padEnd(11)} doors=[${keys.join(",")}] ${problems.length ? "FAIL: " + problems.join("; ") : "PASS"}`);
  if (problems.length) failures++;
}
console.log("CONSOLE-ERRORS:", errors.length ? errors.slice(0, 10) : "none");
console.log(failures === 0 ? "ALL CARS PASS" : `${failures} CARS FAILED`);
await browser.close();
