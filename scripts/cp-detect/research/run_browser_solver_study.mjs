// Real browser worker replay, one fresh solve session per case, sequentially.
// Inputs and the case order come from a frozen native study, never from truth.
import { chromium } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';

const [base, nativeDir, outDir, keysFile] = process.argv.slice(2);
if (!base || !nativeDir || !outDir) throw new Error('BASE NATIVE_STUDY_DIR OUT_DIR required');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const sha = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2));
const nativeProtocol = read(join(nativeDir, 'protocol.json'));
const keys = keysFile ? read(keysFile) : Object.keys(nativeProtocol.inputs);
const options = nativeProtocol.options;
const wasm = 'apps/web/src/generated/oristudio-cp-detect-wasm/oristudio_cp_detect_wasm_bg.wasm';
const protocol = { nativeProtocol, keys, options, wasmSha256: sha(wasm),
  scriptSha256: sha(new URL(import.meta.url)), jobs: 1, includesWorkerStartup: true,
  normalizedInputs: Object.fromEntries(keys.map(key => {
    const file = join(nativeDir, key.replaceAll('/', '__'), 'input.json');
    return [key, existsSync(file) ? sha(file) : null];
  })),
  workerSha256: sha('apps/web/src/workers/cpExactSolveWorker.ts'),
  sessionSha256: sha('apps/web/src/engine/cpExactSolveSession.ts'),
};
mkdirSync(outDir, { recursive: true });
const protocolPath = join(outDir, 'protocol.json');
if (existsSync(protocolPath) && JSON.stringify(read(protocolPath)) !== JSON.stringify(protocol)) {
  throw new Error('Refusing to mix browser protocols');
}
write(protocolPath, protocol);
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const results = [];
try {
  await page.goto(base);
  write(join(outDir, 'environment.json'), await page.evaluate(() => ({
    userAgent: navigator.userAgent, cores: navigator.hardwareConcurrency,
    isolated: crossOriginIsolated,
  })));
  for (const key of keys) {
    if (sha(wasm) !== protocol.wasmSha256) throw new Error('WASM changed during browser replay');
    const name = key.replaceAll('/', '__');
    const source = join(nativeDir, name);
    const directory = join(outDir, name);
    mkdirSync(directory, { recursive: true });
    const done = join(directory, 'complete.json');
    if (existsSync(done)) { results.push(read(done)); continue; }
    const record = { ...read(join(source, 'complete.json')) };
    delete record.score;
    delete record.recovered_25s;
    delete record.prediction;
    if (existsSync(join(source, 'input.json'))) {
      const input = readFileSync(join(source, 'input.json'), 'utf8');
      const answer = await page.evaluate(async ({ input, options, module }) => {
        const { openCpExactSolveSession } = await import(/* @vite-ignore */ module);
        const started = performance.now();
        const session = openCpExactSolveSession();
        const timer = setTimeout(() => session.stop(), 35000);
        try {
          const solver = await session.solver;
          const result = await solver.solveExactToFold(input, JSON.stringify(options));
          return { seconds: (performance.now() - started) / 1000, ...result };
        } catch (error) {
          return { seconds: (performance.now() - started) / 1000,
            error: error?.message || String(error) };
        } finally { clearTimeout(timer); session.dispose(); }
      }, { input, options, module: `/@fs/${resolve('apps/web/src/engine/cpExactSolveSession.ts')}` });
      write(join(directory, 'result.json'), answer);
      record.seconds = answer.seconds;
      record.error = answer.error;
      record.status = answer.solved?.status;
      record.accepted = answer.solved?.movement_report?.accepted === true;
      record.after = answer.solved?.theorem_residual_report?.after;
      record.solved_25s = record.status === 'solved' && record.accepted && record.seconds <= 25;
      if (answer.fold) {
        const fold = typeof answer.fold === 'string' ? JSON.parse(answer.fold) : answer.fold;
        const transform = read(join(source, 'result.json')).input_transform;
        if (transform) for (const p of fold.vertices_coords) {
          const x = p[0] * transform.side;
          const y = p[1] * transform.side * transform.flip;
          p[0] = transform.origin.x + x * transform.ux[0] + y * transform.uy[0];
          p[1] = transform.origin.y + x * transform.ux[1] + y * transform.uy[1];
        }
        write(join(directory, 'solved.fold'), fold);
        record.prediction = join(directory, 'solved.fold');
      }
    }
    write(done, record);
    results.push(record);
    console.log(JSON.stringify({ done: results.length, key, status: record.status,
      seconds: record.seconds, solved_25s: record.solved_25s, error: record.error }));
  }
  write(join(outDir, 'runs.json'), results);
} finally { await browser.close(); }
