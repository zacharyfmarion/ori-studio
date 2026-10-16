/** Continuous-scroll regression check against an external OSF; never commits its contents. */
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

const input = process.argv[2];
if (!input) throw new Error('usage: node scripts/diagram-pages-check.mjs PROJECT.osf');
const output = 'artifacts/diagram-pages';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
await page.routeWebSocket('**', () => {}); // Keep HMR out of the measurement.
// Exercise the browser file-input path; the native picker needs a human gesture.
await page.addInitScript(() => { delete window.showOpenFilePicker; });
try {
  await page.goto(process.env.ORI_PAGES_URL ?? 'http://localhost:5237/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Create a CP' }).click();
  await page.waitForFunction(() => window.__treemakerWorkspaceStore?.getState().oristudioCpDocument);
  await page.evaluate(async () => { window.__commands = await import('/src/commands/menuActions.ts'); });
  const chooser = page.waitForEvent('filechooser');
  await page.evaluate(() => { void window.__commands.handleMenuAction('file.open'); });
  await (await chooser).setFiles(input);
  await page.waitForFunction(() => window.__treemakerWorkspaceStore?.getState().diagram?.steps.length > 0, {}, { timeout: 120000 });
  await page.evaluate(() => window.__commands.handleMenuAction('view.diagram'));
  await page.getByRole('tab', { name: 'Pages', exact: true }).click();
  await page.locator('[data-page="0"] canvas[data-picture-preview]:not([hidden])').waitFor({ timeout: 120000 });
  await page.waitForTimeout(2000);
  const extent = await page.locator('[data-page]').evaluateAll((pages) => ({
    pages: pages.length,
    distance: pages.at(-1).getBoundingClientRect().top - pages[0].getBoundingClientRect().top,
  }));
  const dev = await page.context().newCDPSession(page);
  await dev.send('Profiler.enable');
  await dev.send('Profiler.start');
  const samples = [];
  await page.mouse.move(700, 500);
  for (const phase of ['cold', 'warm']) {
    await page.evaluate(() => {
      window.__frames = [];
      window.__long = [];
      let last = performance.now();
      const frame = (time) => { window.__frames.push(time - last); last = time; window.__raf = requestAnimationFrame(frame); };
      window.__raf = requestAnimationFrame(frame);
      window.__observer = new PerformanceObserver((list) => window.__long.push(...list.getEntries().map((entry) => entry.duration)));
      window.__observer.observe({ type: 'longtask' });
    });
    const ticks = Math.max(1, Math.ceil(extent.distance / 240));
    for (const direction of [1, -1]) {
      for (let i = 0; i < ticks; i++) {
        await page.mouse.wheel(0, direction * extent.distance / ticks);
        await page.waitForTimeout(50);
      }
      await page.waitForTimeout(500);
    }
    samples.push({ phase, ...await page.evaluate(() => {
      cancelAnimationFrame(window.__raf);
      window.__observer.disconnect();
      const frames = window.__frames.sort((a, b) => a - b);
      return {
        frames: frames.length,
        maxFrameMs: Math.max(...frames),
        p95FrameMs: frames[Math.floor(frames.length * 0.95)],
        over50Ms: frames.filter((value) => value > 50).length,
        longTasksMs: window.__long,
        mountedTargets: document.querySelectorAll('[data-page] [role=option]').length,
        mountedBitmaps: document.querySelectorAll('[data-page] canvas').length,
      };
    }) });
  }
  const profile = (await dev.send('Profiler.stop')).profile;
  await writeFile(`${output}/scroll.cpuprofile`, JSON.stringify(profile));

  // Offscreen keyboard selection must mount and reveal its target, then come back.
  await page.locator('[data-page="0"] [role=option]').first().click();
  await page.keyboard.press('End');
  await page.waitForTimeout(500);
  const end = await page.locator('[data-page] [role=option][aria-selected=true]').getAttribute('data-step-id');
  const expected = await page.evaluate(() => window.__treemakerWorkspaceStore.getState().diagram.steps.at(-1).id);
  if (end !== expected) throw new Error('End did not reveal the last step');
  await page.keyboard.press('Home');
  await page.waitForTimeout(500);
  const selected = page.locator('[data-page="0"] [role=option][aria-selected=true]');
  await selected.waitFor();
  const box = await selected.boundingBox();
  const before = await page.evaluate(() => JSON.stringify(window.__treemakerWorkspaceStore.getState().diagram.steps[0].place ?? null));
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 24, box.y + box.height / 2 + 16, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const placed = await page.evaluate(() => JSON.stringify(window.__treemakerWorkspaceStore.getState().diagram.steps[0].place ?? null));
  if (placed === before) throw new Error('Page placement drag did not commit');
  await page.keyboard.press('ControlOrMeta+z');
  await page.waitForTimeout(500);
  const undone = await page.evaluate(() => JSON.stringify(window.__treemakerWorkspaceStore.getState().diagram.steps[0].place ?? null));
  if (undone !== before) throw new Error('Page placement undo did not restore the original');
  await page.screenshot({ path: `${output}/pages.png` });
  const result = { pages: extent.pages, samples, keyboard: true, placementAndUndo: true, errors };
  await writeFile(`${output}/result.json`, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (errors.length) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}
