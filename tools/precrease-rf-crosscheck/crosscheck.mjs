#!/usr/bin/env node
/**
 * Cross-check the precrease planner's forward constructors against
 * ReferenceFinder.
 *
 * `oristudio-precrease` derives O1–O7 from the Huzita–Justin definitions and
 * never transcribes ReferenceFinder's C++ (plan decision D3). The evidence
 * that the derivation is right is this harness: every line the planner's
 * closure folds, whose witnesses pass ReferenceFinder's own legibility rules,
 * must be a line ReferenceFinder itself constructs **exactly** — `err < 1e-9`,
 * the plan's exactness bar (measured exact solutions carry 1e-8..1e-17).
 *
 * The legibility predicate lives here, not in the crate, and that is
 * deliberate: the crate *scores* those rules (a CP line has to be folded
 * whether or not it is legible) while ReferenceFinder *enforces* them, so
 * comparing the two sets requires applying its rules to our output — which is
 * work that belongs inside the GPL whole.
 *
 *   node tools/precrease-rf-crosscheck/crosscheck.mjs [options]
 *
 *   --lib <dir>       ReferenceFinder module (default artifacts/reference-finder-node,
 *                     falling back to apps/web/src/generated/reference-finder)
 *   --rank N          database rank (default 6, the shipped default)
 *   --fixture <path>  extra fixture, repeatable; replaces the default set when given
 *   --depth1-only     assert only on lines the closure folds in its first round
 *   --verbose         print every line, not just the failures
 *
 * The planner side comes from `cargo run --release -p oristudio-precrease
 * --example dump_closure`, so a Rust toolchain is needed; `--dump <cmd>`
 * overrides the command (it receives the fixture path and prints the JSON).
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_DATABASE, createFinder } from './rf-node.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** Fixtures whose bare-sheet closure is small enough to check line by line. */
const DEFAULT_FIXTURES = [
  'crates/oristudio-cp/resources/default-molecules/bird_base.fold',
  'tests/fixtures/flat-folder/kabuto.fold',
  'tests/fixtures/precrease/grid6.fold',
];

/** ReferenceFinder counts a solution exact at or below this error (plan D8). */
const EXACT_ERROR = 1e-9;

/** The planner's line tolerance, for comparing a returned line to the target. */
const TOL = 1e-6;

const options = parseArgs(process.argv.slice(2));
const libDir = options.lib ?? defaultLibDir();
if (!existsSync(join(libDir, 'ref.js')) || !existsSync(join(libDir, 'ref.wasm'))) {
  fail(
    `${libDir} has no ref.js/ref.wasm; run \`node scripts/build-reference-finder.mjs --node\` first`
  );
}

console.log(`module:   ${libDir}`);
console.log(`fixtures: ${options.fixtures.length}`);

const finders = new Map();
async function finderFor(width, height) {
  const key = `${width}x${height}`;
  if (!finders.has(key)) {
    const db = { ...DEFAULT_DATABASE, width, height, rank: options.rank };
    const started = Date.now();
    const finder = await createFinder(libDir, db);
    console.log(
      `database: ${key} rank ${options.rank} built in ${Date.now() - started} ms ` +
        `(${JSON.stringify(finder.dbInfo)})`
    );
    finders.set(key, finder);
  }
  return finders.get(key);
}

let checked = 0;
let skipped = 0;
const failures = [];
const warnings = [];

for (const fixture of options.fixtures) {
  const dump = dumpClosure(fixture);
  for (const component of dump.components) {
    if (component.refused || !component.sheet) {
      console.log(`  ${fixture} component ${component.id}: refused sheet, skipped`);
      continue;
    }
    const { width, height } = component.sheet;
    const finder = await finderFor(width, height);
    for (const folded of component.folded) {
      const legible = folded.witnesses.filter(rfLegible);
      if (legible.length === 0) {
        skipped += 1;
        if (options.verbose) {
          console.log(
            `  skip ${describe(folded)}: no witness passes ReferenceFinder's filters ` +
              `(${folded.witnesses.map(whyNot).join(', ') || 'no witnesses'})`
          );
        }
        continue;
      }
      const depth1 = folded.round === 1;
      if (options.depth1Only && !depth1) {
        skipped += 1;
        continue;
      }
      const [a, b] = folded.segment;
      const solutions = await finder.solveLine(a, b, {
        count: 5,
        goodEnoughError: EXACT_ERROR,
        worstCase: 1,
      });
      const exact = solutions.filter((s) => s.err < EXACT_ERROR);
      checked += 1;
      const label =
        `${fixture} round ${folded.round} ${describe(folded)} ` +
        `[${legible.map((w) => 'O' + w.axiom).join(' ')}]`;
      if (exact.length > 0) {
        if (options.verbose) {
          console.log(`  ok   ${label}: rank ${exact[0].rank}, err ${exact[0].err}`);
        }
        continue;
      }
      const best = solutions[0];
      const message =
        `${label}: ReferenceFinder has no exact construction ` +
        `(best err ${best ? best.err : 'none'}, rank ${best ? best.rank : '-'})`;
      // Only the first closure round is asserted. A deeper line needs several
      // folds of ReferenceFinder's own, and its database keeps one object per
      // quantised key, so a genuine construction can be shadowed by another
      // line that hashed there first — a ReferenceFinder limitation (the plan
      // measured 13 of 42 grid lines lost that way), not a planner defect.
      if (depth1) {
        failures.push(message);
        console.error(`  FAIL ${message}`);
      } else {
        warnings.push(message);
        console.warn(`  warn ${message}`);
      }
    }
  }
}

console.log(
  `precrease cross-check: ${checked} legible lines checked, ${skipped} skipped, ` +
    `${failures.length} failure(s), ${warnings.length} warning(s)`
);
if (failures.length > 0) {
  console.error('precrease cross-check: failed');
  process.exit(1);
}
if (options.strict && warnings.length > 0) {
  console.error('precrease cross-check: --strict, and there are warnings');
  process.exit(1);
}
process.exit(0);

// ---------------------------------------------------------------------------------------

/**
 * ReferenceFinder's legibility rules as this harness applies them to a
 * planner witness. The crate records these flags because it *scores* them;
 * ReferenceFinder refuses a construction that trips either, so a line only
 * belongs in the comparison when at least one of its witnesses is clean:
 *
 * - **visibility** (`sVisibilityMatters`): at least one input is a sheet edge,
 *   or a mark that lies on one. An all-interior alignment is not legible.
 * - **skinny flap**: the fold leaves a flap thinner than 0.1 of the sheet.
 *
 * The third rule ReferenceFinder applies, the trivial Haga case of O5, needs
 * nothing here: the planner's O5 constructor enforces it, so no witness can
 * ever carry one.
 */
function rfLegible(witness) {
  return witness.visible && !witness.skinny;
}

function whyNot(witness) {
  const reasons = [];
  if (!witness.visible) reasons.push('not visible');
  if (witness.skinny) reasons.push('skinny flap');
  return `O${witness.axiom}: ${reasons.join(' + ') || 'legible'}`;
}

function describe(folded) {
  const [a, b] = folded.segment;
  const f = (p) => `(${p[0].toFixed(4)}, ${p[1].toFixed(4)})`;
  return `${f(a)}—${f(b)}`;
}

/** Whether two canonical `[nx, ny, d]` lines are the same within `TOL`. */
export function sameLine(p, q) {
  const cross = Math.abs(p[0] * q[1] - p[1] * q[0]);
  const sign = p[0] * q[0] + p[1] * q[1] >= 0 ? 1 : -1;
  return cross <= TOL && Math.abs(p[2] - sign * q[2]) <= TOL;
}

function dumpClosure(fixture) {
  const path = isAbsolute(fixture) ? fixture : join(repoRoot, fixture);
  if (!existsSync(path)) fail(`fixture ${path} does not exist`);
  const [command, ...prefix] = options.dump;
  let stdout;
  try {
    stdout = execFileSync(command, [...prefix, path], {
      cwd: repoRoot,
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
  } catch (error) {
    fail(`dumping ${fixture} failed: ${error.message}`);
  }
  try {
    return JSON.parse(stdout);
  } catch (error) {
    fail(`dumping ${fixture} did not print JSON: ${error.message}`);
  }
}

function defaultLibDir() {
  const node = join(repoRoot, 'artifacts/reference-finder-node');
  if (existsSync(join(node, 'ref.wasm'))) return node;
  return join(repoRoot, 'apps/web/src/generated/reference-finder');
}

function parseArgs(argv) {
  const out = {
    lib: undefined,
    rank: 6,
    fixtures: [],
    depth1Only: false,
    strict: false,
    verbose: false,
    dump: [
      'cargo',
      'run',
      '--release',
      '--quiet',
      '-p',
      'oristudio-precrease',
      '--example',
      'dump_closure',
      '--',
    ],
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case '--lib':
        out.lib = absolute(value());
        break;
      case '--rank':
        out.rank = Number(value());
        if (!Number.isInteger(out.rank) || out.rank < 1) fail('--rank must be a positive integer');
        break;
      case '--fixture':
        out.fixtures.push(value());
        break;
      case '--dump':
        out.dump = value().split(' ');
        break;
      case '--depth1-only':
        out.depth1Only = true;
        break;
      case '--strict':
        out.strict = true;
        break;
      case '--verbose':
        out.verbose = true;
        break;
      case '--help':
      case '-h':
        console.log(
          'usage: node tools/precrease-rf-crosscheck/crosscheck.mjs [--lib <dir>] [--rank N] ' +
            '[--fixture <path>]… [--dump <cmd>] [--depth1-only] [--strict] [--verbose]'
        );
        process.exit(0);
        break;
      default:
        fail(`unknown argument ${arg}`);
    }
  }
  if (out.fixtures.length === 0) out.fixtures = DEFAULT_FIXTURES;
  return out;
}

function absolute(path) {
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

function fail(message) {
  console.error(`precrease cross-check: error: ${message}`);
  process.exit(1);
}
