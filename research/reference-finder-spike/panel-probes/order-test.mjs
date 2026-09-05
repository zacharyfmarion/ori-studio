// Order-independence test of the closure in spike-closure.mjs: shuffle target order, and also vary
// the strategy (fold-all-per-pass vs fold-one-per-pass), compare the reached fixpoint SET, the per-line
// axiom labels, and |P|.
import { readFileSync } from "node:fs";
const src = readFileSync("./spike-closure.mjs", "utf8");
// carve out everything before "// ---------- main ----------" as a module body
const lib = "import { readFileSync } from \"node:fs\";\n" + src.slice(0, src.indexOf("// ---------- main ----------"))
  .replace(/^import .*$/mg, "")
  .replace(/^const args = .*$/m, "const args = {};")
  + "\nexport { loadCP, lineFromPoints, lineKey, ptKey, State, construct, EPS };\n";
import { writeFileSync } from "node:fs";
writeFileSync("./spike-lib.mjs", lib);
const { loadCP, lineFromPoints, lineKey, State, construct } = await import("./spike-lib.mjs");

const file = process.argv[2];
const SEEDS = Number(process.argv[3] ?? 40);
function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
function shuffle(a, r) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

const { segs, width, height } = loadCP(file);
const byLine = new Map();
for (const s of segs) { const l = lineFromPoints(s.a, s.b); if (!l) continue; const k = lineKey(l); if (!byLine.has(k)) byLine.set(k, { line: l, asg: new Set() }); byLine.get(k).asg.add(s.asg); }
const borderLines = [...byLine.values()].filter(v => [...v.asg].every(a => a === "B"));
const mk = () => new State(width, height, borderLines.length ? borderLines.map(v => v.line) : null);
const base = mk();
const targets = [...byLine.values()].map(v => v.line).filter(l => !base.hasLine(l));

function run(order, onePerPass) {
  const st = mk();
  let remaining = order.slice();
  const seq = [];
  for (;;) {
    const next = []; let any = false;
    for (const l of remaining) {
      if (onePerPass && any) { next.push(l); continue; }
      const ax = construct(st, l);
      if (ax) { st.addLine(l, "cp"); seq.push([lineKey(l), ax]); any = true; } else next.push(l);
    }
    remaining = next; if (!any) break;
  }
  return { set: seq.map(s => s[0]).sort().join("|"), ax: Object.fromEntries(seq), P: st.P.size, n: seq.length, seq };
}
const ref = run(targets, false);
console.log(`${file.split("/").pop()}: targets=${targets.length} ref folded=${ref.n} |P|=${ref.P}`);
let setDiff = 0, axDiff = 0, pDiff = 0; const axChanges = new Map();
for (let s = 1; s <= SEEDS; s++) {
  for (const one of [false, true]) {
    const r = run(shuffle(targets, rng(s * 7919 + (one ? 1 : 0))), one);
    if (r.set !== ref.set) { setDiff++; console.log(`  SET DIFF seed=${s} one=${one}: folded ${r.n} vs ${ref.n}`); }
    if (r.P !== ref.P) pDiff++;
    for (const [k, ax] of Object.entries(r.ax)) if (ref.ax[k] !== undefined && ref.ax[k] !== ax) { axDiff++; const kk = `${k}: O${ref.ax[k]}->O${ax}`; axChanges.set(kk, (axChanges.get(kk) ?? 0) + 1); }
  }
}
console.log(`  runs=${SEEDS * 2}  fixpoint-set differs: ${setDiff}   |P| differs: ${pDiff}   per-line axiom label differs: ${axDiff} occurrences`);
for (const [k, c] of [...axChanges].slice(0, 12)) console.log(`    ${k}  x${c}`);
