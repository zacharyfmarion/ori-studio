/** External-corpus browser check. No private inputs are copied into the repository. */
import { chromium } from 'playwright';
import { mkdir, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
const input = process.argv[2];
if (!input) throw new Error('usage: node scripts/diagram-import-check.mjs FILE_OR_FOLDER [finish]');
let files = /\.defox$/i.test(input)
  ? [input]
  : (await readdir(input))
      .filter((n) => /\.(cp|svg)$/i.test(n))
      .sort()
      .map((n) => path.join(input, n));
if (process.env.ORI_IMPORT_LIMIT) files = files.slice(0, Number(process.env.ORI_IMPORT_LIMIT));
const browser = await chromium.launch({ channel: 'chromium', args: ['--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on('console', (m) => {
  if (process.env.ORI_IMPORT_PROFILE) console.log(m.text());
});
await page.routeWebSocket('**', () => {}); // Freeze HMR while measuring an in-flight job.
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await page.goto(process.env.ORI_IMPORT_URL ?? 'http://localhost:5237/', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'Create a CP' }).click();
  await page.waitForFunction(() => Boolean(window.__treemakerWorkspaceStore?.getState().oristudioCpDocument));
  await page.evaluate(async () => {
    window.__importModules = {
      commands: await import('/src/commands/menuActions.ts'),
      file: await import('/src/diagram/document/diagramFile.ts'),
      cold: await import('/src/cp-workspace/cpSegmentationArtifacts.ts?cold-import-check'),
      link: await import('/src/diagram/capture/linkStatus.ts'),
    };
    await window.__importModules.commands.handleMenuAction('view.diagram');
    await window.__importModules.commands.handleMenuAction('file.importDiagramSteps');
  });
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Choose files…', exact: true }).click();
  await (await chooser).setFiles(files);
  await page.getByRole('button', { name: 'Import', exact: true }).waitFor();
  await mkdir('artifacts/diagram-import', { recursive: true });
  await page.screenshot({ path: 'artifacts/diagram-import/preview.png' });
  await page.evaluate(() => {
    window.__importLongTasks = [];
    window.__importObserver = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__importLongTasks.push(e.duration);
    });
    window.__importObserver.observe({ type: 'longtask', buffered: false });
  });
  const cdp = process.env.ORI_IMPORT_PROFILE ? await page.context().newCDPSession(page) : null;
  if (cdp) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.start');
  }
  const at = Date.now();
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  if (process.argv[3] === 'finish')
    await page.getByRole('button', { name: 'Finish import now', exact: true }).click();
  await page.waitForFunction(
    () =>
      document.querySelector('[role=dialog]')?.textContent?.includes('Steps added:') ||
      document.querySelector('[role=dialog] [role=alert]'),
    {},
    { timeout: 1800000 },
  );
  const alert = await page.locator('[role=dialog] [role=alert]').allTextContents();
  if (alert.length) throw new Error(alert.join(' '));
  const importMs = Date.now() - at;
  console.log('Import completed', importMs);
  if (cdp)
    await writeFile(
      'artifacts/diagram-import/import.cpuprofile',
      JSON.stringify((await cdp.send('Profiler.stop')).profile),
    );

  await page.screenshot({ path: 'artifacts/diagram-import/result.png', timeout: 180000 });
  const result = await page.evaluate(async () => {
    const s = window.__treemakerWorkspaceStore.getState();
    const { writeDiagram, readDiagram } = window.__importModules.file;
    console.log('Starting diagram roundtrip');
    const written = writeDiagram(s.diagram);
    console.log('Diagram written');
    const serialized = JSON.stringify(written);
    console.log('Diagram serialized', serialized.length);
    const parsed = JSON.parse(serialized);
    console.log('Diagram parsed');
    const read = readDiagram(parsed);
    console.log('Diagram validated');
    return {
      steps: s.diagram.steps.length,
      segments: s.oristudioCpDocument.document.crease_pattern.line_segments.length,
      failed: s.diagram.steps.filter((x) => x.importStatus === 'failed').length,
      pending: s.diagram.steps.filter((x) => x.importStatus === 'pending').length,
      wireframes: s.diagram.steps.filter((x) => x.source?.render?.mode === 'folded-flat' && x.picture?.kind === 'fixed').length,
      readOnly: read?.readOnly,
      readSteps: read?.document.steps.length,
      unknownSteps: read?.document.steps.filter((x) => x.unknown).length,
      longTasks: window.__importLongTasks,
    };
  });
  result.importMs = importMs;
  result.elapsedMs = Date.now() - at;
  result.errors = errors;
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await writeFile('artifacts/diagram-import/result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await page.screenshot({ path: 'artifacts/diagram-import/diagram.png', timeout: 90000 });

  // Optional interaction measurement: run after import and before cold analysis
  // so it measures card painting, not a whole-document cache reconstruction.
  if (process.env.ORI_IMPORT_SCROLL_CHECK) {
    result.scrolling = await page.evaluate(async () => {
      const grid = document.querySelector('[data-diagram-steps]');
      const scroller = grid?.parentElement;
      if (!grid || !scroller) throw new Error('The Steps grid is not mounted');
      const samples = [];
      for (const position of [0.25, 0.5, 0.75, 1, 0]) {
        let previous = performance.now();
        const start = previous;
        let maxFrameMs = 0;
        let readyAtMs = null;
        scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * position;
        while (performance.now() - start < 2000) {
          await new Promise(requestAnimationFrame);
          const now = performance.now();
          maxFrameMs = Math.max(maxFrameMs, now - previous);
          previous = now;
          if (readyAtMs === null) {
            const viewport = scroller.getBoundingClientRect();
            const visible = [...grid.querySelectorAll('[data-step-id]')].filter((card) => {
              const box = card.getBoundingClientRect();
              return box.bottom > viewport.top && box.top < viewport.bottom;
            });
            if (visible.length && visible.every((card) => card.querySelector('canvas[data-picture-preview]:not([hidden])'))) {
              readyAtMs = now - start;
            }
          }
        }
        samples.push({ position, maxFrameMs, readyAtMs, mountedCards: grid.querySelectorAll('[role=option]').length });
      }
      return samples;
    });
    console.log('Scroll samples', JSON.stringify(result.scrolling));
  }

  const links = await page.evaluate(async () => {
    const { ensureCpSegmentationArtifacts } = window.__importModules.cold;
    const { linkStatus } = window.__importModules.link;
    const s = window.__treemakerWorkspaceStore.getState();
    const at = performance.now();
    const artifacts = await ensureCpSegmentationArtifacts(s.oristudioCpDocument.document);
    const statuses = s.diagram.steps
      .filter((step) => step.source?.kind === 'cp')
      .map((step) => linkStatus(step.source, s.oristudioCpDocument.document, artifacts));
    return {
      ms: performance.now() - at,
      ready: !!artifacts,
      statuses: statuses.reduce((counts, status) => ({ ...counts, [status]: (counts[status] ?? 0) + 1 }), {}),
    };
  });
  result.coldSegmentation = links;
  console.log('Cold links', JSON.stringify(links));
  await writeFile('artifacts/diagram-import/result.json', JSON.stringify(result, null, 2));
  const native = await page.evaluate(async () => {
    const store = window.__treemakerWorkspaceStore;
    let text = '';
    const service = {
      surface: 'web',
      supportsNativeDialogs: false,
      saveTextFile: async (options) => {
        text = options.contents;
        return { name: 'import-check.osf', path: null };
      },
      openTextFile: async () => ({ name: 'import-check.osf', path: null, text }),
      openBinaryFiles: async () => null,
      openBinaryFile: async () => null,
      saveBinaryFile: async () => null,
    };
    const before = store.getState();
    const at = performance.now();
    console.log('Saving native project');
    if (!(await before.saveProjectAs(service)))
      throw new Error('Native save failed: ' + store.getState().projectMessage);
    const bytes = text.length,
      saveMs = performance.now() - at;
    console.log('Reopening native project', bytes);
    if (!(await store.getState().openProject(service, { confirmDiscard: false })))
      throw new Error('Native reopen failed: ' + store.getState().projectMessage);
    const s = store.getState();
    return {
      bytes,
      saveMs,
      reopenMs: performance.now() - at - saveMs,
      steps: s.diagram?.steps.length,
      segments: s.oristudioCpDocument?.document.crease_pattern.line_segments.length,
      readOnly: s.diagramReadOnly,
    };
  });
  result.nativeRoundtrip = native;
  console.log('Native roundtrip', JSON.stringify(native));
  await writeFile('artifacts/diagram-import/result.json', JSON.stringify(result, null, 2));
  await page.evaluate(async () => {
    await window.__importModules.commands.handleMenuAction('view.edit');
  });
  await page.screenshot({ path: 'artifacts/diagram-import/edit.png', timeout: 60000 }).catch((e) => {
    result.editScreenshotError = e.message;
  });
  await writeFile('artifacts/diagram-import/result.json', JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
