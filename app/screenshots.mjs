// Opens the standalone preview in a headless browser and saves pictures of it, so that a change to the
// scene can be looked at. Needs Playwright and a Chrome or Chromium:
//   npm install --no-save playwright && npm run preview && npm run screenshots
// Environment: BROWSER_CHANNEL (default chrome), PLAYWRIGHT_MODULE (path of the module, if it is not
// installed here), SHOTS (output folder, default ./screenshots).
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const out = path.resolve(process.env.SHOTS ?? path.join(here, 'screenshots'));
await mkdir(out, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.BROWSER_CHANNEL ?? 'chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
page.on('pageerror', (e) => problems.push(String(e)));

// `?fullquality` stops the twin from lowering its picture quality, which it would do on a software renderer.
await page.goto(`${pathToFileURL(path.join(here, 'preview', 'windfarm-twin-preview.html')).href}?fullquality`);
await page.waitForFunction(() => window.__twin !== undefined, undefined, { timeout: 60000 });
await page.evaluate(() => window.__twin.ready);
const shot = async (name, waitMs) => {
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path: path.join(out, `${name}.png`) });
  console.log(`saved ${name}.png`);
};

await shot('1-site', 9000);
// Clicks go without waiting for the page to settle: a software renderer keeps it busy for seconds.
await page.click('.twin-fleet li:nth-child(7) button', { noWaitAfter: true }); // WT-07, the turbine with the warm gearbox
await shot('2-turbine', 9000);
await page.evaluate(() => {
  window.__preview.provider.injectFault('WT-07');
  window.__preview.advance(120); // the fault at its height: derated, alarm raised
});
await shot('3-fault-building', 12000);
await page.evaluate(() => window.__preview.advance(50)); // tripped
await shot('4-tripped', 12000);
await page.click('.twin-button', { noWaitAfter: true }); // whole site
await shot('5-site-with-fault', 9000);

const counts = await page.evaluate(() => ({
  labels: document.querySelectorAll('.twin-label').length,
  fleet: document.querySelectorAll('.twin-fleet li').length,
  canvas: document.querySelector('.twin-canvas')?.width ?? 0,
}));
await browser.close();
console.log(JSON.stringify({ ...counts, problems }));
if (problems.length > 0 || counts.labels !== 15 || counts.fleet !== 12 || counts.canvas === 0) process.exit(1);
