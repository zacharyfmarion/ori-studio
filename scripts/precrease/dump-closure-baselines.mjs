#!/usr/bin/env node
/**
 * Byte-for-byte baselines of the precrease planner's `dump_closure` output.
 *
 * The evidence that moving the planner's geometry into `oristudio-geometry`
 * changed nothing (implementation-plans/fold-workspace.md, D9 and Phase 1a):
 * the full sha256 of `dump_closure`'s stdout, with and without `--plan`, for
 * every fixture in `tests/fixtures/precrease/` plus the bird base molecule and
 * kabuto. Every line, round, witness, point and status the planner reports is
 * inside that output, so an identical hash means an identical plan.
 *
 *   node scripts/precrease/dump-closure-baselines.mjs           # check
 *   node scripts/precrease/dump-closure-baselines.mjs --print   # print the table
 *
 * Checking exits 1 and names each case whose hash moved. `--print` writes the
 * current table to stdout in the golden file's shape, for a deliberate update
 * of `dump-closure-baselines.json` when planner behaviour is meant to change.
 *
 * Paths are passed repo-relative from the repo root because `dump_closure`
 * echoes its argument into the output. The example runs with a frozen clock
 * and no budgets, so its output is deterministic.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const goldenPath = join(repoRoot, 'scripts/precrease/dump-closure-baselines.json');
const fixtureDir = 'tests/fixtures/precrease';
const extraFixtures = [
  'crates/oristudio-cp/resources/default-molecules/bird_base.fold',
  'tests/fixtures/flat-folder/kabuto.fold',
];
const binary = join(repoRoot, 'target/release/examples/dump_closure');

function fixtures() {
  const own = readdirSync(join(repoRoot, fixtureDir))
    .filter((name) => name.endsWith('.fold') || name.endsWith('.cp'))
    .sort()
    .map((name) => `${fixtureDir}/${name}`);
  return [...own, ...extraFixtures];
}

function hashOf(file, plan) {
  const args = plan ? [file, '--plan'] : [file];
  const out = execFileSync(binary, args, { cwd: repoRoot, maxBuffer: 1 << 30 });
  return createHash('sha256').update(out).digest('hex');
}

function currentTable() {
  const table = {};
  for (const file of fixtures()) {
    table[file] = { closure: hashOf(file, false), plan: hashOf(file, true) };
  }
  return table;
}

execFileSync('cargo', ['build', '--release', '-p', 'oristudio-precrease', '--example', 'dump_closure'], {
  cwd: repoRoot,
  stdio: 'inherit',
});

const table = currentTable();
if (process.argv.includes('--print')) {
  const comment =
    'sha256 of `dump_closure <file>` (closure) and `dump_closure <file> --plan` (plan) stdout; ' +
    'checked by scripts/precrease/dump-closure-baselines.mjs.';
  process.stdout.write(`${JSON.stringify({ $comment: comment, baselines: table }, null, 2)}\n`);
  process.exit(0);
}

const golden = JSON.parse(readFileSync(goldenPath, 'utf8')).baselines;
const mismatches = [];
for (const file of new Set([...Object.keys(golden), ...Object.keys(table)])) {
  for (const mode of ['closure', 'plan']) {
    const want = golden[file]?.[mode];
    const got = table[file]?.[mode];
    if (want !== got) mismatches.push(`${file} [${mode}]: want ${want ?? 'none'}, got ${got ?? 'none'}`);
  }
}
if (mismatches.length > 0) {
  console.error(`dump_closure baselines moved in ${mismatches.length} case(s):`);
  for (const line of mismatches) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`dump_closure baselines: ${Object.keys(table).length} fixtures x 2 modes identical`);
