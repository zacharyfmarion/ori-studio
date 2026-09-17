// Exercise the shared product entry point, including worker startup and defaults.
// The manifest names normalized solve inputs; no reference file is read here.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const [base, manifestPath, out] = process.argv.slice(2);
if (!base || !manifestPath || !out) throw new Error('BASE MANIFEST OUT required');
const digest = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const cases = JSON.parse(readFileSync(manifestPath, 'utf8'));
const wasm = 'apps/web/src/generated/oristudio-cp-detect-wasm/oristudio_cp_detect_wasm_bg.wasm';
const modulePath = 'apps/web/src/engine/cpExactSolve.ts';
const wasmSha256 = digest(wasm);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'protocol.json'), JSON.stringify({
  wasmSha256, productEntrySha256: digest(modulePath), scriptSha256: digest(new URL(import.meta.url)),
  manifestSha256: digest(manifestPath), timeoutSeconds: 25, recognitionFallback: true,
  inputs: cases.map(row => ({ ...row, sha256: digest(row.input) })),
}, null, 2));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(base);
  const runs = [];
  for (const row of cases) {
    if (digest(wasm) !== wasmSha256) throw new Error('WASM changed during replay');
    const answer = await page.evaluate(async ({ input, module }) => {
      const { runCpExactSolve } = await import(/* @vite-ignore */ module);
      const start = performance.now();
      const result = await runCpExactSolve(input, { timeoutSeconds: 25, recognitionFallback: true });
      return { seconds: (performance.now() - start) / 1000, ...result };
    }, { input: readFileSync(row.input, 'utf8'), module: `/@fs/${resolve(modulePath)}` });
    const directory = join(out, row.key.replaceAll('/', '__'));
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'result.json'), JSON.stringify(answer));
    if (answer.fold) writeFileSync(join(directory, 'solved.fold'), JSON.stringify(answer.fold));
    const record = { key: row.key, seconds: answer.seconds, status: answer.outcome.kind,
      solved_25s: answer.outcome.kind === 'solved' && answer.seconds <= 25 };
    runs.push(record);
    console.log(JSON.stringify(record));
    writeFileSync(join(out, 'runs.json'), JSON.stringify(runs, null, 2));
  }
  if (runs.some(row => !row.solved_25s)) process.exitCode = 1;
} finally {
  await browser.close();
}
