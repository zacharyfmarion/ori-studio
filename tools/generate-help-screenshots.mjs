import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'apps/web/public/help');
const appUrl = process.env.TREEMAKER_WEB_URL ?? 'http://127.0.0.1:5274/';

async function waitForWorkspace(page) {
  await page.waitForFunction(
    () => globalThis.__treemakerWorkspaceStore?.getState().engineReady === true,
    { timeout: 30_000 },
  );
}

async function resetToStarter(page) {
  await page.evaluate(async () => {
    globalThis.confirm = () => true;
    await globalThis.__treemakerWorkspaceStore.getState().loadStarterProject();
  });
  await page.waitForTimeout(250);
}

async function activateTab(page, title) {
  const tab = page.locator('.dv-tab').filter({ hasText: title }).last();
  await tab.click();
  await page.waitForTimeout(250);
}

async function capture(page, filename) {
  await page.screenshot({
    path: path.join(outputDir, filename),
    animations: 'disabled',
  });
}

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 960 },
  deviceScaleFactor: 1,
});
await context.addInitScript(() => {
  localStorage.clear();
});

const page = await context.newPage();
await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
await waitForWorkspace(page);
await resetToStarter(page);

await activateTab(page, 'Files');
await capture(page, 'files-workflow.png');

await activateTab(page, 'Design');
await capture(page, 'design-workspace.png');

await page.evaluate(() => {
  globalThis.__treemakerWorkspaceStore.getState().select({ kind: 'node', id: 2 });
});
await activateTab(page, 'Inspector');
await capture(page, 'inspector-details.png');

await page.evaluate(async () => {
  const store = globalThis.__treemakerWorkspaceStore.getState();
  await store.setSymmetry({
    hasSymmetry: true,
    symAngle: 90,
    symLoc: { x: 0.5, y: 0.5 },
  });
  store.select({ kind: 'node', id: 2 });
});
await activateTab(page, 'Conditions');
await capture(page, 'conditions-symmetry.png');

await resetToStarter(page);
await page.evaluate(async () => {
  await globalThis.__treemakerWorkspaceStore.getState().optimizeScale();
});
await activateTab(page, 'Diagnostics');
await capture(page, 'optimize-build.png');

await page.evaluate(async () => {
  await globalThis.__treemakerWorkspaceStore.getState().buildCreasePattern();
});
await activateTab(page, 'Crease Pattern');
await capture(page, 'crease-pattern-review.png');

await activateTab(page, 'Simulator');
await activateTab(page, 'Folded Base');
await page.waitForTimeout(1_000);
await capture(page, 'simulator-folded-base.png');

await page.getByRole('button', { name: 'Settings' }).click();
await page.waitForTimeout(250);
await capture(page, 'workspace-settings.png');

await browser.close();
