import { greedy, exact, closure, forwardCandidates, fmt } from "./probe.mjs";
import { loadCP, lineFromPoints, lineKey, State } from "./geom.mjs";
const R = "/Users/zacharymarion/Documents/code/tree-maker-rust/.claude/worktrees/stoic-nightingale-47aa90/";
const files = { kabuto: R + "tests/fixtures/flat-folder/kabuto.fold", sample1: R + "tests/fixtures/oriedita/solution_sample_1.cp", frog: R + "crates/oristudio-cp/resources/default-molecules/frog_base.fold" };
for (const [name, path] of Object.entries(files)) {
  const { segs, width, height } = loadCP(path);
  const st = new State(width, height);
  const byLine = new Map();
  for (const s of segs) { const l = lineFromPoints(s.a, s.b); if (l && !st.hasLine(l)) byLine.set(lineKey(l), l); }
  const targets = [...byLine.values()];
  let t0 = performance.now();
  const g = await greedy(width, height, targets, { topk: 5 }); const tg = performance.now() - t0; t0 = performance.now();
  const gl = await greedy(width, height, targets, { topk: 5, lookahead: true }); const tl = performance.now() - t0; t0 = performance.now();
  const gb = await greedy(width, height, targets, { topk: 5, lookahead: true, beam: 3 }); const tb = performance.now() - t0; t0 = performance.now();
  const kmax = Math.max(0, g.aux.length - 1);
  const ex = exact(width, height, targets, kmax, { verbose: true }); const te = performance.now() - t0;
  console.log(`${name}: paper ${width.toFixed(3)}x${height.toFixed(3)} |CP|=${targets.length} closure0=${g.closure0}`);
  console.log(`  greedy: ${g.aux.length} aux (+${g.unsolved} unsolved) ${g.queries} queries ${tg.toFixed(0)}ms [${g.aux.map(fmt).join("; ")}]`);
  console.log(`  lookahead: ${gl.aux.length} aux ${gl.queries} q ${tl.toFixed(0)}ms | beam3: ${gb.aux.length} aux ${gb.queries} q ${tb.toFixed(0)}ms`);
  console.log(`  exact(≤${kmax}, no O6): ${ex.aux ? ex.aux.length + " aux [" + ex.aux.map(fmt).join("; ") + "]" : "none"} ${ex.nodes} nodes ${te.toFixed(0)}ms`);
  // forward candidate sizing at the first stuck state
  const s1 = new State(width, height); const rem = closure(s1, targets.filter(t => !s1.hasLine(t)));
  t0 = performance.now(); const cands = forwardCandidates(s1); const tc = performance.now() - t0; t0 = performance.now();
  let unlock = 0, fin = 0; for (const c of cands) { const s2 = new State(width, height); for (const l of s1.L.values()) s2.addLine({n:l.n,d:l.d}, l.tag); s2.addLine(c, "aux"); const r2 = closure(s2, rem); if (r2.length < rem.length) unlock++; if (!r2.length) fin++; }
  console.log(`  first stuck state |L|=${s1.L.size} |P|=${s1.P.size} remaining=${rem.length}: ${cands.length} forward 1-aux candidates (${tc.toFixed(0)}ms gen, ${(performance.now()-t0).toFixed(0)}ms closure-test); ${unlock} unlock ≥1, ${fin} finish all`);
}
process.exit(0);
