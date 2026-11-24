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
await page.setContent("<canvas id=c width=64 height=64></canvas>");
const gl = await page.evaluate(() => { const c = document.getElementById("c"); const gl = c.getContext("webgl2") || c.getContext("webgl"); return gl ? gl.getParameter(gl.VERSION) + " | " + gl.getParameter(gl.RENDERER) : "NO WEBGL"; });
console.log("WebGL:", gl);
await browser.close();
