const { chromium } = require(process.env.PW_CORE || "playwright-core");
const [mode, t0, t1, out] = [process.argv[2], +process.argv[3], +process.argv[4], process.argv[5]];
(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1080 / 390 });
  await p.goto("file://" + __dirname + "/rec.html");
  await p.evaluate((m) => window.__make(m), mode);
  await p.waitForTimeout(500);
  let i = 0;
  for (let t = t0; t <= t1 + 0.01; t += 1000 / 60) {
    await p.evaluate((ms) => window.__seek(ms), t);
    await p.screenshot({ path: `${out}/f${String(i++).padStart(4, "0")}.jpg`, type: "jpeg", quality: 93 });
  }
  console.log(mode, "frames", i);
  await b.close();
})();
