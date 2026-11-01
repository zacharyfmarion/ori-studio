#!/usr/bin/env node
/**
 * Census 2 of the Layer order dialog (`implementation-plans/layer-order-dialog.md`,
 * row E8, phase gate 2): the dialog's calls timed through the BUILT Fold
 * bridge in Node, as its worker will make them, with the wasm memory each
 * engine instance grows to. Local only, never in CI; the native censuses it
 * compares with are `crates/oracle-tests/tests/layer_order_{witness,session,solutions}.rs`.
 *
 * Per design, folded as Edit folds a whole sheet (the CP bridge's
 * `folded_figure_fold_selected`, Order 5), and only when Oriedita folds it
 * flat:
 *
 * 1. **The dialog's worker**, one fresh Fold-wasm instance:
 *    - `layer_open_showing` on Edit's own order, read off the CP bridge's
 *      paper scene by `layerOrderSceneRelations.ts` (the source refuses what
 *      census 1 refuses: those designs are reported, not timed);
 *    - the solution count, advanced in the dialog's slice
 *      (`--slice-nodes`, `--slice-ms`) until done or `--count-ms` of slicing,
 *      the whole and the longest slice timed;
 *    - previews of single flips of open pairs (`--previews` of them, evenly
 *      spaced), none committed;
 *    - a step to the next and back, by picture and with X-ray;
 *    - three constraints as the native session census builds them, each
 *      previewed and then added by its token (`layer_commit_preview`, with no
 *      nodes, so it must adopt), or, when it can't fit, the order on screen's
 *      own way committed;
 *    - `layer_explain` on up to three candidates that can't fit, found as the
 *      native solutions census finds them;
 *    - the count again, on the constraints; `layer_save`.
 * 2. **The host engine**, another fresh instance: `layer_restore` of that
 *    record on the same source, whose order must be the dialog's.
 * 3. **Fold's own worker**, a third fresh instance: Import CP of the same file
 *    into an empty sequence and its first order landed (`import_cp`,
 *    `import_pick`), the heaviest thing Fold's worker holds for a design.
 *    `--no-fold-import` skips it.
 *
 * Each instance runs in a worker thread of its own, so its wasm memory
 * (which never shrinks) is that instance's peak; it is read after every
 * phase. Phase gate 2 takes the three instances as live at once.
 *
 *   PATH=$HOME/.nvm/versions/node/v22.14.0/bin:$PATH
 *   npm --workspace @treemaker/web run build:oristudio-fold-wasm
 *   npm --workspace @treemaker/web run build:oristudio-cp-wasm
 *   node scripts/layer-order-census.mjs --corpus /path/to/real_benchmark/cpoogle
 *
 * Without `--corpus` (or `LAYER_ORDER_CENSUS_DIR`) it runs the fixtures and
 * iguana-c0 only. `--only a,b` keeps the corpus cases whose name contains one
 * of the strings, `--jobs n` runs n designs at once (timings are cleanest at
 * 1, the default), `--out` moves the report from
 * `artifacts/layer-order-census/wasm/` (gitignored): `designs.csv`, one row
 * per design, `rows.json` with every measurement, and `summary.md`.
 *
 * Corpus files are never committed or copied in, and no case is named in a
 * committed file (`tests/corpus/README.md`).
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const generated = path.join(repoRoot, 'apps/web/src/generated');
const FOLD_GLUE = path.join(generated, 'oristudio-fold-wasm/oristudio_fold_wasm.js');
const FOLD_WASM = path.join(generated, 'oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm');
const CP_GLUE = path.join(generated, 'oristudio-cp-wasm/oristudio_cp_wasm.js');
const CP_WASM = path.join(generated, 'oristudio-cp-wasm/oristudio_cp_wasm_bg.wasm');
const SCENE_RELATIONS = path.join(repoRoot, 'apps/web/src/layer-order/engine/layerOrderSceneRelations.ts');

const FIXTURES = [
  ['kabuto', 'tests/fixtures/flat-folder/kabuto.fold'],
  ['solution_sample_1', 'tests/fixtures/oriedita/solution_sample_1.cp'],
  ['colorconstrainttest', 'third_party/oriedita/oriedita-data/src/test/resources/colorconstrainttest.cp'],
  ['solution_sample_1_black_valley', 'tests/fixtures/oriedita/solution_sample_1_black_valley.cp'],
];
const IGUANA = ['iguana-c0', 'tests/fixtures/precrease/iguana-c0.fold'];

/** Constraints built per design, as the native session census builds them. */
const STEPS = 3;
/** Candidates explained per design, and how many pairs are tried for them (the native solutions census's). */
const EXPLAINED = 3;
const TRIED = 60;
/** The deadlines the native censuses give these calls. */
const OPEN_MS = 120_000;
const PREVIEW_MS = 30_000;
const EXPLAIN_MS = 10_000;
const STEP_MS = 5_000;
/** The dialog's own preview deadline (the plan's approach 5): previews past it would read "couldn't check in time". */
const DIALOG_PREVIEW_MS = 3_000;
const MIB = 1024 * 1024;

/** Packs `(a, b)` into one number; faces stay far below it (as `layerOrderSceneRelations.ts`). */
const FACE_SPAN = 2 ** 26;

// ---------------------------------------------------------------------------
// Small helpers, both threads

function now() {
  return performance.now();
}

/** The nearest-rank percentile, as the native censuses take it. */
function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length, Math.max(1, Math.ceil(p * sorted.length)));
  return sorted[rank - 1];
}

function max(values) {
  return values.reduce((m, v) => Math.max(m, v), 0);
}

/** A call's limits: only a deadline, the native censuses' node defaults. */
function deadline(ms) {
  return { deadlineMs: ms };
}

// ---------------------------------------------------------------------------
// Worker threads: one engine instance each

async function loadFold(module) {
  const fold = await import(pathToFileURL(FOLD_GLUE).href);
  const exports = fold.initSync({ module });
  return { fold, memory: () => exports.memory.buffer.byteLength };
}

async function loadCp(module) {
  const cp = await import(pathToFileURL(CP_GLUE).href);
  const exports = cp.initSync({ module });
  return { cp, memory: () => exports.memory.buffer.byteLength };
}

/** `[a, b, a, b, …]` as pairs. */
function pairsOf(flat) {
  const pairs = [];
  for (let i = 0; i < flat.length; i += 2) pairs.push([flat[i], flat[i + 1]]);
  return pairs;
}

/** "subject in front of object", read from the front: the wire's sign rule (`layerOrderWire.ts`). */
function inFrontOf(subject, object, frontUp) {
  return [subject, object, frontUp[object] === 1 ? 1 : -1];
}

/** The order on screen's relations, by pair: `lo * FACE_SPAN + hi` → `[upper, lower]`. */
function shownByPair(relations) {
  const shown = new Map();
  for (let i = 0; i < relations.length; i += 2) {
    const upper = relations[i];
    const lower = relations[i + 1];
    shown.set(Math.min(upper, lower) * FACE_SPAN + Math.max(upper, lower), [upper, lower]);
  }
  return shown;
}

/** The constraint that reverses the order on screen on `[a, b]`: the lower face in front of the upper. */
function againstShown(shown, [a, b], frontUp) {
  const pair = shown.get(Math.min(a, b) * FACE_SPAN + Math.max(a, b));
  if (!pair) return null;
  const [upper, lower] = pair;
  return inFrontOf(lower, upper, frontUp);
}

/** The constraint that keeps the order on screen on `[a, b]`. */
function withShown(shown, [a, b], frontUp) {
  const pair = shown.get(Math.min(a, b) * FACE_SPAN + Math.max(a, b));
  if (!pair) return null;
  const [upper, lower] = pair;
  return inFrontOf(upper, lower, frontUp);
}

/**
 * The count advanced in the dialog's slice until done or `countMs` of
 * slicing. `layer_solutions_start` (the deduction and the enumeration's
 * setup) is a call of its own, timed apart: it blocks the worker too.
 */
function countInSlices(bridge, session, caps, slice, countMs) {
  const start = now();
  const cursor = bridge.layer_solutions_start(session, caps ?? undefined);
  const startMs = now() - start;
  const sliceMs = [];
  let count = null;
  for (;;) {
    const t = now();
    count = bridge.layer_solutions_advance(session, cursor, slice);
    sliceMs.push(now() - t);
    if (count.done || now() - start >= countMs) break;
  }
  return {
    cursor,
    startMs,
    totalMs: now() - start,
    slices: sliceMs.length,
    longestSliceMs: max(sliceMs),
    longestCallMs: Math.max(startMs, max(sliceMs)),
    sliceMs,
    done: count.done,
    front: count.front,
    back: count.back,
    orders: count.orders,
  };
}

function verdictOf(answer) {
  return answer.verdict ?? answer.status ?? 'unknown';
}

/** The dialog's worker: the CP bridge as the host, then one Fold instance. */
async function dialogJob(job) {
  const row = { failures: [], memory: {} };
  const { cp, memory: cpMemory } = await loadCp(job.cpModule);
  const text = readFileSync(job.file, 'utf8');
  const t0 = now();
  const document = job.file.endsWith('.cp') ? cp.load_cp(text, '') : cp.load_fold(text, '');
  const summary = cp.document_summary(document);
  const lines = Array.from({ length: summary.line_segments }, (_, index) => index + 1);
  const figure = cp.folded_figure_fold_selected(document, lines, 1, 'Order5', null, 0);
  row.cpFoldMs = now() - t0;
  if (figure.snapshot.outcome !== 'Solved') {
    row.status = `oriedita ${String(figure.snapshot.outcome).toLowerCase()}`;
    return row;
  }
  const source = cp.folded_figure_source(figure.handle, document);
  const scene = cp.folded_figure_paper_scene(figure.handle, document);
  cp.free_folded_figure(figure.handle);
  cp.free_document(document);
  row.memory.cp = cpMemory();
  if (!scene) {
    row.status = 'no scene';
    return row;
  }
  const { layerOrderSceneRelations } = await import(
    `data:text/javascript;base64,${Buffer.from(job.relationsCode).toString('base64')}`
  );
  const editRelations = layerOrderSceneRelations(scene);

  const { fold, memory } = await loadFold(job.foldModule);
  row.memory.init = memory();
  const bridge = new fold.FoldEngine();

  // Open on the order Edit shows.
  let t = now();
  const opened = bridge.layer_open_showing(source, editRelations, deadline(OPEN_MS));
  row.openMs = now() - t;
  row.memory.open = memory();
  if (opened.status !== 'ok') {
    row.status = opened.refusal.code;
    return row;
  }
  row.status = 'ok';
  const { session, front_up: frontUp } = opened;
  row.faces = opened.faces;
  row.spots = opened.spots;
  row.openedOn = opened.opened_on.kind;
  row.openPairs = opened.open_pairs.length / 2;
  const objects = new Map();
  for (const [a, b] of pairsOf(opened.open_pairs)) {
    objects.set(a, (objects.get(a) ?? 0) + 1);
    objects.set(b, (objects.get(b) ?? 0) + 1);
  }
  row.pickable = objects.size;
  // Per pickable subject, how many open objects it offers: the faces that
  // carry letters once it is picked (spec §6.4), what D7's label cap caps.
  row.objectCounts = [...objects.values()].sort((a, b) => a - b);
  row.maxObjects = max(row.objectCounts);
  row.relations = editRelations.length / 2;

  // The count, as the dialog starts it on open.
  const slice = { maxNodes: job.sliceNodes, deadlineMs: job.sliceMs };
  const count0 = phase(row, 'count', () => countInSlices(bridge, session, job.caps, slice, job.countMs));
  if (count0) row.count = { ...count0, cursor: undefined };
  row.memory.count = memory();

  // Previews of single flips, none committed.
  row.previewMs = [];
  row.previewVerdicts = {};
  row.previewsOverDialogDeadline = 0;
  phase(row, 'previews', () => {
    const shown0 = shownByPair(bridge.layer_oriedita_relations(session));
    const open0 = pairsOf(opened.open_pairs);
    const flips = Math.min(job.previews, open0.length);
    for (let k = 0; k < flips; k += 1) {
      const candidate = againstShown(shown0, open0[Math.floor((k * open0.length) / flips)], frontUp);
      if (!candidate) {
        row.failures.push(`flip${k}:undetermined`);
        continue;
      }
      t = now();
      const preview = bridge.layer_preview(session, Int32Array.from(candidate), deadline(PREVIEW_MS));
      const ms = now() - t;
      row.previewMs.push(ms);
      if (ms > DIALOG_PREVIEW_MS) row.previewsOverDialogDeadline += 1;
      const verdict = verdictOf(preview);
      row.previewVerdicts[verdict] = (row.previewVerdicts[verdict] ?? 0) + 1;
    }
  });
  row.memory.previews = memory();

  // A step to the next and back, by picture and with X-ray.
  row.stepMs = [];
  row.stepVerdicts = {};
  if (count0) {
    const by = { picture: count0.front.n >= count0.back.n ? 'front' : 'back' };
    for (const [stepBy, direction] of [
      [by, 'next'],
      [by, 'previous'],
      ['layer_order', 'next'],
      ['layer_order', 'previous'],
    ]) {
      phase(row, `step ${JSON.stringify(stepBy)} ${direction}`, () => {
        t = now();
        const stepped = bridge.layer_step(session, count0.cursor, stepBy, direction, deadline(STEP_MS));
        row.stepMs.push(now() - t);
        const verdict = verdictOf(stepped);
        row.stepVerdicts[verdict] = (row.stepVerdicts[verdict] ?? 0) + 1;
      });
    }
    phase(row, 'count close', () => bridge.layer_solutions_close(session, count0.cursor));
  }
  row.memory.steps = memory();

  // Three constraints, each previewed and added by its token.
  row.addMs = [];
  row.addAdopted = 0;
  row.commitMs = [];
  row.stepPreviewMs = [];
  phase(row, 'adds', () => addThree(bridge, session, frontUp, row));
  row.constraints = bridge.layer_constraints(session).length / 3;
  row.memory.adds = memory();

  // Explain candidates that can't fit.
  row.explainMs = [];
  row.explainVerdicts = {};
  phase(row, 'explain', () => explainSome(bridge, session, frontUp, row));
  row.memory.explain = memory();

  // The count again, on the constraints.
  if (row.constraints > 0) {
    phase(row, 'constrained count', () => {
      const count1 = countInSlices(bridge, session, job.caps, slice, job.countMs);
      bridge.layer_solutions_close(session, count1.cursor);
      row.constrainedCount = { ...count1, cursor: undefined };
    });
  }
  row.memory.count1 = memory();

  // Save.
  t = now();
  const saved = bridge.layer_save(session);
  row.saveMs = now() - t;
  if (saved.status !== 'ok') {
    row.failures.push(`save ${saved.refusal.code}`);
    return row;
  }
  row.recordBytes = Buffer.byteLength(saved.json);
  row.memory.save = memory();
  row.memory.peak = memory();
  const relations = Array.from(bridge.layer_oriedita_relations(session));
  return { ...row, handoff: { source, json: saved.json, relations } };
}

/**
 * Runs one phase of a design: a call that throws (a defect, never an
 * answer) is recorded as that phase's failure, and the census goes on.
 */
function phase(row, name, run) {
  try {
    return run();
  } catch (error) {
    row.failures.push(`${name}: ${`${error?.code ?? ''} ${error?.message ?? String(error)}`.trim()}`.replaceAll(' ', '_'));
    return undefined;
  }
}

/** Three constraints as the native session census builds them, each previewed and then added by its token. */
function addThree(bridge, session, frontUp, row) {
  let t;
  for (let step = 0; step < STEPS; step += 1) {
    const open = pairsOf(bridge.layer_open_pairs(session));
    if (open.length === 0) break;
    const pair = open[Math.floor((step * open.length) / STEPS) % open.length];
    const shown = shownByPair(bridge.layer_oriedita_relations(session));
    const candidate = againstShown(shown, pair, frontUp);
    if (!candidate) {
      row.failures.push(`s${step}:undetermined`);
      break;
    }
    const list = Int32Array.from([...bridge.layer_constraints(session), ...candidate]);
    t = now();
    const preview = bridge.layer_preview(session, Int32Array.from(candidate), deadline(PREVIEW_MS));
    const ms = now() - t;
    row.stepPreviewMs.push(ms);
    row.previewMs.push(ms);
    if (ms > DIALOG_PREVIEW_MS) row.previewsOverDialogDeadline += 1;
    const verdict = verdictOf(preview);
    row.previewVerdicts[verdict] = (row.previewVerdicts[verdict] ?? 0) + 1;
    if (preview.verdict === 'fits') {
      t = now();
      const added = bridge.layer_commit_preview(session, preview.token, list, { maxNodes: 0, fastNodes: 0 });
      row.addMs.push(now() - t);
      if (added.verdict !== 'committed' || !added.adopted) {
        row.failures.push(`s${step}:add ${verdictOf(added)}`);
        break;
      }
      row.addAdopted += 1;
    } else {
      const keep = withShown(shown, pair, frontUp);
      t = now();
      const committed = bridge.layer_commit(
        session,
        Int32Array.from([...bridge.layer_constraints(session), ...keep]),
        deadline(PREVIEW_MS)
      );
      row.commitMs.push(now() - t);
      if (committed.verdict !== 'committed') {
        row.failures.push(`s${step}:commit ${verdictOf(committed)}`);
        break;
      }
    }
  }
}

/** Up to three candidates that can't fit, explained, found as the native solutions census finds them. */
function explainSome(bridge, session, frontUp, row) {
  const relations = bridge.layer_oriedita_relations(session);
  const shown = shownByPair(relations);
  const pairs = pairsOf(relations);
  const stride = Math.max(1, Math.floor(pairs.length / TRIED));
  for (let i = 0, tried = 0; i < pairs.length && tried < TRIED; i += stride, tried += 1) {
    if (row.explainMs.length >= EXPLAINED) break;
    const candidate = againstShown(shown, pairs[i], frontUp);
    if (!candidate) continue;
    const preview = bridge.layer_preview(session, Int32Array.from(candidate), { deadlineMs: EXPLAIN_MS });
    if (preview.verdict !== 'cant_fit') continue;
    const t = now();
    const explained = bridge.layer_explain(session, Int32Array.from(candidate), { deadlineMs: EXPLAIN_MS });
    row.explainMs.push(now() - t);
    const verdict = verdictOf(explained);
    row.explainVerdicts[verdict] = (row.explainVerdicts[verdict] ?? 0) + 1;
    if (explained.verdict !== 'clash') row.failures.push(`explain ${verdict}`);
  }
}

/** The host engine: a fresh instance restores the record. */
async function hostJob(job) {
  const { fold, memory } = await loadFold(job.foldModule);
  const result = { memory: { init: memory() } };
  const engine = new fold.FoldEngine();
  const t = now();
  const restored = engine.layer_restore(job.source, job.json, { deadlineMs: OPEN_MS });
  result.restoreMs = now() - t;
  result.memory.peak = memory();
  if (restored.status !== 'ok') {
    result.outcome = restored.refusal.code;
    return result;
  }
  result.outcome = restored.outcome.kind;
  const relations = engine.layer_oriedita_relations(restored.session);
  result.sameOrder =
    relations.length === job.relations.length && relations.every((value, i) => value === job.relations[i]);
  return result;
}

/** Fold's own worker: Import CP of the same file, its first order landed. */
async function foldImportJob(job) {
  const { fold, memory } = await loadFold(job.foldModule);
  const result = { memory: { init: memory() } };
  const engine = new fold.FoldEngine();
  const bytes = readFileSync(job.file);
  const format = job.file.endsWith('.cp') ? 'cp' : 'fold';
  let t = now();
  const opened = engine.import_cp({ format, sample: false }, bytes, { kind: 'empty' }, undefined);
  result.importMs = now() - t;
  if (opened.status !== 'ok') {
    result.outcome = opened.refusal?.code ?? opened.status;
    result.memory.peak = memory();
    return result;
  }
  t = now();
  const landed = engine.import_pick(opened.import, new Uint32Array(opened.components.length));
  result.pickMs = now() - t;
  result.outcome = landed.status === 'ok' ? 'landed' : (landed.refusal?.code ?? landed.status);
  result.memory.peak = memory();
  return result;
}

if (!isMainThread) {
  const jobs = { dialog: dialogJob, host: hostJob, foldImport: foldImportJob };
  jobs[workerData.kind](workerData)
    .then((result) => parentPort.postMessage({ ok: true, result }))
    .catch((error) =>
      parentPort.postMessage({ ok: false, error: `${error?.code ?? ''} ${error?.message ?? String(error)}`.trim() })
    );
}

// ---------------------------------------------------------------------------
// The main thread: designs, workers, the report

/** One job in a worker thread of its own; a hung job is terminated at `timeoutMs`. */
function runJob(data, timeoutMs) {
  return new Promise((resolve) => {
    const worker = new Worker(fileURLToPath(import.meta.url), {
      workerData: data,
      resourceLimits: { stackSizeMb: 256 },
    });
    let settled = false;
    const finish = (answer) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      resolve(answer);
    };
    const timer = setTimeout(() => finish({ ok: false, error: `harness timeout ${timeoutMs} ms` }), timeoutMs);
    worker.on('message', finish);
    worker.on('error', (error) => finish({ ok: false, error: `worker ${error?.message ?? String(error)}` }));
    worker.on('exit', (code) => finish({ ok: false, error: `worker exited ${code}` }));
  });
}

function designsOf(options) {
  const designs = FIXTURES.map(([name, relative]) => ({ name, group: 'fixture', file: path.join(repoRoot, relative) }));
  designs.push({ name: IGUANA[0], group: 'iguana', file: path.join(repoRoot, IGUANA[1]) });
  const corpus = options.corpus ?? process.env.LAYER_ORDER_CENSUS_DIR;
  if (!corpus) return designs;
  if (!existsSync(corpus)) throw new Error(`--corpus names no directory: ${corpus}`);
  const only = (options.only ?? '').split(',').filter(Boolean);
  for (const name of readdirSync(corpus).sort()) {
    const file = path.join(corpus, name, 'truth.fold');
    if (!existsSync(file)) continue;
    if (only.length > 0 && !only.some((o) => name.includes(o))) continue;
    designs.push({ name, group: 'corpus', file });
  }
  return designs;
}

async function census(design, shared, options) {
  const row = { name: design.name, group: design.group };
  const timeoutMs = Number(options['design-timeout-ms']);
  const dialog = await runJob({ kind: 'dialog', file: design.file, ...shared }, timeoutMs);
  if (!dialog.ok) {
    return { ...row, status: 'harness', failures: [dialog.error], memory: {} };
  }
  const { handoff, ...measured } = dialog.result;
  Object.assign(row, measured);
  if (!handoff) return row;
  row.host = await runJob(
    { kind: 'host', foldModule: shared.foldModule, source: handoff.source, json: handoff.json, relations: handoff.relations },
    timeoutMs
  );
  row.host = row.host.ok ? row.host.result : { error: row.host.error };
  if (row.host.error) row.failures.push(`host ${row.host.error}`);
  else if (row.host.outcome !== 'applied') row.failures.push(`restore ${row.host.outcome}`);
  else if (!row.host.sameOrder) row.failures.push('restore_order');
  if (options['fold-import']) {
    const imported = await runJob({ kind: 'foldImport', foldModule: shared.foldModule, file: design.file }, timeoutMs);
    row.foldImport = imported.ok ? imported.result : { error: imported.error };
  }
  return row;
}

const fmt = (value, digits = 1) => (value === null || value === undefined ? '' : Number(value).toFixed(digits));
const mib = (bytes) => (bytes ? bytes / MIB : null);
const tally = (t) => (t ? `${t.n}${t.exact ? '' : '+'}` : '');

const CSV_COLUMNS = [
  ['name', (r) => r.name.replaceAll(',', ';')],
  ['group', (r) => r.group],
  ['status', (r) => r.status],
  ['faces', (r) => r.faces ?? ''],
  ['spots', (r) => r.spots ?? ''],
  ['open_pairs', (r) => r.openPairs ?? ''],
  ['pickable', (r) => r.pickable ?? ''],
  ['max_objects', (r) => r.maxObjects ?? ''],
  ['opened_on', (r) => r.openedOn ?? ''],
  ['cp_fold_ms', (r) => fmt(r.cpFoldMs)],
  ['open_ms', (r) => fmt(r.openMs)],
  ['previews', (r) => r.previewMs?.length ?? ''],
  ['preview_ms_p50', (r) => fmt(percentile(r.previewMs ?? [], 0.5), 2)],
  ['preview_ms_max', (r) => fmt(r.previewMs ? max(r.previewMs) : null, 2)],
  ['preview_verdicts', (r) => Object.entries(r.previewVerdicts ?? {}).map(([k, n]) => `${k}:${n}`).join(' ')],
  ['add_ms_max', (r) => fmt(r.addMs?.length ? max(r.addMs) : null, 2)],
  ['adds_adopted', (r) => r.addAdopted ?? ''],
  ['explained', (r) => r.explainMs?.length ?? ''],
  ['explain_ms_max', (r) => fmt(r.explainMs?.length ? max(r.explainMs) : null, 2)],
  ['count_ms', (r) => fmt(r.count?.totalMs)],
  ['count_start_ms', (r) => fmt(r.count?.startMs, 2)],
  ['count_slices', (r) => r.count?.slices ?? ''],
  ['count_longest_slice_ms', (r) => fmt(r.count?.longestSliceMs, 2)],
  ['count_done', (r) => r.count?.done ?? ''],
  ['count_front', (r) => tally(r.count?.front)],
  ['count_back', (r) => tally(r.count?.back)],
  ['count_orders', (r) => tally(r.count?.orders)],
  ['constraints', (r) => r.constraints ?? ''],
  ['count1_ms', (r) => fmt(r.constrainedCount?.totalMs)],
  ['count1_longest_slice_ms', (r) => fmt(r.constrainedCount?.longestSliceMs, 2)],
  ['count1_done', (r) => r.constrainedCount?.done ?? ''],
  ['step_ms_max', (r) => fmt(r.stepMs?.length ? max(r.stepMs) : null, 2)],
  ['save_ms', (r) => fmt(r.saveMs, 2)],
  ['record_bytes', (r) => r.recordBytes ?? ''],
  ['restore_ms', (r) => fmt(r.host?.restoreMs)],
  ['restore_outcome', (r) => r.host?.outcome ?? r.host?.error ?? ''],
  ['mem_cp_mib', (r) => fmt(mib(r.memory?.cp))],
  ['mem_dialog_open_mib', (r) => fmt(mib(r.memory?.open))],
  ['mem_dialog_count_mib', (r) => fmt(mib(r.memory?.count))],
  ['mem_dialog_peak_mib', (r) => fmt(mib(r.memory?.peak))],
  ['mem_host_peak_mib', (r) => fmt(mib(r.host?.memory?.peak))],
  ['fold_import_outcome', (r) => r.foldImport?.outcome ?? r.foldImport?.error ?? ''],
  ['fold_import_ms', (r) => fmt((r.foldImport?.importMs ?? 0) + (r.foldImport?.pickMs ?? 0) || null)],
  ['mem_fold_import_peak_mib', (r) => fmt(mib(r.foldImport?.memory?.peak))],
  ['failures', (r) => (r.failures ?? []).join(' ').replaceAll(',', ';')],
];

function line(row, i, total) {
  const at = `[${i + 1}/${total}] ${row.name}`;
  if (row.status !== 'ok') return `${at}: ${row.status}${row.failures?.length ? ` ${row.failures.join(' ')}` : ''}`;
  return (
    `${at}: ${row.faces} faces, ${row.openPairs} open; open ${fmt(row.openMs, 0)} ms; ` +
    `previews p50 ${fmt(percentile(row.previewMs, 0.5))} max ${fmt(max(row.previewMs))} ms; ` +
    (row.count
      ? `count ${fmt(row.count.totalMs, 0)} ms in ${row.count.slices} (start ${fmt(row.count.startMs)} ms, ` +
        `longest slice ${fmt(row.count.longestSliceMs)} ms)${row.count.done ? '' : ' unfinished'}; `
      : 'no count; ') +
    `restore ${fmt(row.host?.restoreMs, 0)} ms; ` +
    `dialog ${fmt(mib(row.memory.peak))} MiB, host ${fmt(mib(row.host?.memory?.peak))} MiB` +
    `${row.foldImport?.memory ? `, Fold ${fmt(mib(row.foldImport.memory.peak))} MiB` : ''}; ` +
    `${row.failures.length ? `FAIL ${row.failures.join(' ')}` : 'pass'}`
  );
}

/** `p50 / p95 / max` of `values`, with `digits`. */
function stat(values, digits = 1) {
  if (values.length === 0) return '–';
  return `${fmt(percentile(values, 0.5), digits)} / ${fmt(percentile(values, 0.95), digits)} / ${fmt(max(values), digits)}`;
}

function summary(rows, options, elapsedMs) {
  const admitted = rows.filter((r) => r.status === 'ok');
  const corpus = admitted.filter((r) => r.group === 'corpus');
  const outside = {};
  for (const r of rows.filter((r) => r.status !== 'ok')) outside[r.status] = (outside[r.status] ?? 0) + 1;
  const failing = admitted.filter((r) => r.failures.length > 0);
  const flat = (pick) => corpus.flatMap(pick);
  const verdicts = {};
  for (const r of corpus) for (const [k, n] of Object.entries(r.previewVerdicts)) verdicts[k] = (verdicts[k] ?? 0) + n;
  const counts = corpus.map((r) => r.count).filter(Boolean);
  const allCounts = corpus.flatMap((r) => [r.count, r.constrainedCount].filter(Boolean));
  const unfinished = corpus.filter((r) => r.count && !r.count.done);
  const live = corpus.map(
    (r) => (r.memory.peak ?? 0) + (r.host?.memory?.peak ?? 0) + (r.foldImport?.memory?.peak ?? 0)
  );
  const s = [];
  s.push('# Layer order census 2 (wasm)\n');
  s.push(
    `${rows.length} designs in ${fmt(elapsedMs / 1000, 0)} s, ${options.jobs} at a time, Node ${process.version}; ` +
      `slice { maxNodes: ${options['slice-nodes']}, deadlineMs: ${options['slice-ms']} }, count capped at ` +
      `${options['count-ms']} ms of slicing, ${options.previews} previews of single flips per design plus ` +
      `${STEPS} before each Add.\n`
  );
  s.push(
    `${admitted.length} admitted (${corpus.length} corpus), ${admitted.length - failing.length} pass every check; ` +
      `outside: ${JSON.stringify(outside)}\n`
  );
  if (failing.length > 0) s.push(`Failing:\n\n${failing.map((r) => `- ${r.name}: ${r.failures.join(' ')}`).join('\n')}\n`);
  const openShowing = {};
  for (const r of admitted) openShowing[r.openedOn] = (openShowing[r.openedOn] ?? 0) + 1;
  s.push(`Opened on Edit's order: ${JSON.stringify(openShowing)}.\n`);
  s.push('| Corpus (p50 / p95 / max) | |\n| --- | --- |');
  s.push(`| CP fold, ms (the host's, before the dialog) | ${stat(corpus.map((r) => r.cpFoldMs))} |`);
  s.push(`| **open** (\`layer_open_showing\`), ms | ${stat(corpus.map((r) => r.openMs))} |`);
  s.push(`| **preview**, ms (${flat((r) => r.previewMs).length}: ${JSON.stringify(verdicts)}) | ${stat(flat((r) => r.previewMs), 2)} |`);
  s.push(`| preview before an Add (the native census's three), ms | ${stat(flat((r) => r.stepPreviewMs), 2)} |`);
  s.push(`| previews over the dialog's ${DIALOG_PREVIEW_MS} ms deadline | ${corpus.reduce((n, r) => n + r.previewsOverDialogDeadline, 0)} |`);
  s.push(`| Add by token (\`layer_commit_preview\`), ms (${flat((r) => r.addMs).length}) | ${stat(flat((r) => r.addMs), 2)} |`);
  s.push(`| commit when it can't fit, ms (${flat((r) => r.commitMs).length}) | ${stat(flat((r) => r.commitMs), 2)} |`);
  s.push(`| explain, ms (${flat((r) => r.explainMs).length}) | ${stat(flat((r) => r.explainMs), 2)} |`);
  s.push(`| count on open, whole, ms (${counts.filter((c) => c.done).length} done) | ${stat(counts.map((c) => c.totalMs))} |`);
  s.push(`| count on open, slices | ${stat(counts.map((c) => c.slices), 0)} |`);
  s.push(`| count's start (\`layer_solutions_start\`), ms (every count) | ${stat(allCounts.map((c) => c.startMs), 2)} |`);
  s.push(`| **longest count slice**, ms (every count, on open and constrained) | ${stat(allCounts.map((c) => c.longestSliceMs), 2)} |`);
  s.push(`| **longest count call** (start or slice), ms | ${stat(allCounts.map((c) => c.longestCallMs), 2)} |`);
  const slices = allCounts.flatMap((c) => c.sliceMs);
  s.push(
    `| every slice, ms (${slices.length}; ${slices.filter((ms) => ms > 2 * options['slice-ms']).length} over twice the ` +
      `slice's deadline, ${slices.filter((ms) => ms > 100).length} over 100 ms) | ${stat(slices, 2)} |`
  );
  s.push(`| step, ms | ${stat(flat((r) => r.stepMs), 2)} |`);
  s.push(`| save, ms | ${stat(corpus.map((r) => r.saveMs), 2)} |`);
  s.push(`| **restore** (host engine), ms | ${stat(corpus.map((r) => r.host?.restoreMs).filter((ms) => ms !== undefined))} |`);
  s.push(`| record, bytes | ${stat(corpus.map((r) => r.recordBytes ?? 0), 0)} |`);
  s.push(`| faces | ${stat(corpus.map((r) => r.faces), 0)} |`);
  s.push(`| pickable faces (in an open pair at open) | ${stat(corpus.map((r) => r.pickable), 0)} |`);
  s.push(`| most open objects of one subject | ${stat(corpus.map((r) => r.maxObjects), 0)} |`);
  s.push(`| open pairs at open | ${stat(corpus.map((r) => r.openPairs), 0)} |`);
  s.push(`| wasm memory, CP bridge (host kernel), MiB | ${stat(corpus.map((r) => mib(r.memory.cp)))} |`);
  s.push(`| wasm memory, dialog after open, MiB | ${stat(corpus.map((r) => mib(r.memory.open)))} |`);
  s.push(`| wasm memory, dialog after the count, MiB | ${stat(corpus.map((r) => mib(r.memory.count)))} |`);
  s.push(`| **wasm memory, dialog peak**, MiB | ${stat(corpus.map((r) => mib(r.memory.peak)))} |`);
  s.push(`| **wasm memory, host engine peak**, MiB | ${stat(corpus.map((r) => mib(r.host?.memory?.peak)).filter(Boolean))} |`);
  if (options['fold-import']) {
    s.push(`| **wasm memory, Fold's worker (Import CP) peak**, MiB | ${stat(corpus.map((r) => mib(r.foldImport?.memory?.peak)).filter(Boolean))} |`);
    s.push(`| Import CP, ms | ${stat(corpus.map((r) => (r.foldImport?.importMs ?? 0) + (r.foldImport?.pickMs ?? 0)))} |`);
  }
  s.push(`| **the three live at once**, MiB | ${stat(live.map(mib))} |`);
  s.push('');
  const subjects = corpus.flatMap((r) => r.objectCounts);
  s.push(
    `Open objects per subject, over the corpus's ${subjects.length} pickable subjects: p50 ` +
      `${percentile(subjects, 0.5)}, p90 ${percentile(subjects, 0.9)}, p95 ${percentile(subjects, 0.95)}, p99 ` +
      `${percentile(subjects, 0.99)}, max ${max(subjects)}. With a label cap of N, the subjects whose open objects ` +
      `all keep letters, and the designs where every subject's do:\n`
  );
  s.push('| N | subjects | designs |\n| --- | --- | --- |');
  for (const n of [10, 20, 26, 30, 40, 50, 60, 80, 100, 150, 200]) {
    const share = (count, total) => `${fmt((100 * count) / Math.max(1, total), 1)}%`;
    s.push(
      `| ${n} | ${share(subjects.filter((k) => k <= n).length, subjects.length)} | ` +
        `${share(corpus.filter((r) => r.maxObjects <= n).length, corpus.length)} |`
    );
  }
  s.push('');
  s.push(
    `Counts left unfinished after ${options['count-ms']} ms of slicing: ${unfinished.length} on open` +
      (unfinished.length ? ` (open pairs ${unfinished.map((r) => r.openPairs).sort((a, b) => a - b).join(', ')})` : '') +
      `; constrained ${corpus.filter((r) => r.constrainedCount && !r.constrainedCount.done).length}.\n`
  );
  for (const r of admitted.filter((r) => r.group !== 'corpus')) {
    s.push(`- **${r.name}**: ${r.faces} faces, ${r.openPairs} open pairs, ${r.pickable} pickable; open ${fmt(r.openMs, 0)} ms; ` +
      `previews ${stat(r.previewMs, 1)} ms (${JSON.stringify(r.previewVerdicts)}); Add ${stat(r.addMs, 2)} ms; ` +
      `explain ${stat(r.explainMs, 1)} ms; count ${fmt(r.count?.totalMs, 0)} ms (start ${fmt(r.count?.startMs)} ms) in ` +
      `${r.count?.slices} slices, longest ${fmt(r.count?.longestSliceMs)} ms, ${r.count?.done ? 'done' : 'unfinished'} (front ${tally(r.count?.front)}, ` +
      `back ${tally(r.count?.back)}, orders ${tally(r.count?.orders)}); steps ${stat(r.stepMs, 1)} ms; restore ` +
      `${fmt(r.host?.restoreMs, 0)} ms; record ${r.recordBytes} B; memory dialog ${fmt(mib(r.memory.peak))} MiB, ` +
      `host ${fmt(mib(r.host?.memory?.peak))} MiB${r.foldImport?.memory ? `, Fold ${fmt(mib(r.foldImport.memory.peak))} MiB (${r.foldImport.outcome})` : ''}, ` +
      `CP ${fmt(mib(r.memory.cp))} MiB${r.failures.length ? `; FAIL ${r.failures.join(' ')}` : ''}`);
  }
  return `${s.join('\n')}\n`;
}

async function main() {
  const { values: options } = parseArgs({
    options: {
      corpus: { type: 'string' },
      only: { type: 'string' },
      jobs: { type: 'string', default: '1' },
      out: { type: 'string', default: path.join(repoRoot, 'artifacts/layer-order-census/wasm') },
      previews: { type: 'string', default: '8' },
      'slice-nodes': { type: 'string', default: '1000' },
      'slice-ms': { type: 'string', default: '30' },
      'count-ms': { type: 'string', default: '30000' },
      'orders-per-component': { type: 'string' },
      'combinations-per-group': { type: 'string' },
      'stored-bits': { type: 'string' },
      'design-timeout-ms': { type: 'string', default: '900000' },
      'fold-import': { type: 'boolean', default: true },
      'no-fold-import': { type: 'boolean', default: false },
    },
  });
  if (options['no-fold-import']) options['fold-import'] = false;
  for (const file of [FOLD_GLUE, FOLD_WASM, CP_GLUE, CP_WASM]) {
    if (!existsSync(file)) throw new Error(`${path.relative(repoRoot, file)} is missing: build the bridges first`);
  }
  const { transform } = await import('esbuild');
  const relationsCode = (await transform(readFileSync(SCENE_RELATIONS, 'utf8'), { loader: 'ts', format: 'esm' })).code;
  const caps = {};
  if (options['orders-per-component']) caps.ordersPerComponent = Number(options['orders-per-component']);
  if (options['combinations-per-group']) caps.combinationsPerGroup = Number(options['combinations-per-group']);
  if (options['stored-bits']) caps.storedBits = Number(options['stored-bits']);
  const shared = {
    foldModule: new WebAssembly.Module(readFileSync(FOLD_WASM)),
    cpModule: new WebAssembly.Module(readFileSync(CP_WASM)),
    relationsCode,
    caps: Object.keys(caps).length > 0 ? caps : null,
    previews: Number(options.previews),
    sliceNodes: Number(options['slice-nodes']),
    sliceMs: Number(options['slice-ms']),
    countMs: Number(options['count-ms']),
  };
  options.jobs = Math.max(1, Number(options.jobs));
  const designs = designsOf(options);
  const rows = new Array(designs.length);
  let next = 0;
  const started = now();
  await Promise.all(
    Array.from({ length: options.jobs }, async () => {
      for (let i = next++; i < designs.length; i = next++) {
        rows[i] = await census(designs[i], shared, options);
        console.log(line(rows[i], i, designs.length));
      }
    })
  );
  const elapsedMs = now() - started;
  mkdirSync(options.out, { recursive: true });
  const csv = [CSV_COLUMNS.map(([name]) => name).join(','), ...rows.map((r) => CSV_COLUMNS.map(([, get]) => get(r)).join(','))];
  writeFileSync(path.join(options.out, 'designs.csv'), `${csv.join('\n')}\n`);
  writeFileSync(path.join(options.out, 'rows.json'), JSON.stringify(rows, null, 1));
  const text = summary(rows, options, elapsedMs);
  writeFileSync(path.join(options.out, 'summary.md'), text);
  console.log(`\n${text}`);
  console.log(`report: ${options.out}`);
}

if (isMainThread) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
