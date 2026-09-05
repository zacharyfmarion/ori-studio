import { readFileSync } from "node:fs";
import { lineFromPoints as LP, lineKey, ptKey, onLine, reflectPt, reflectLine, intersect, State, construct, qk } from "./verify-geom.mjs";
import { loadCP } from "./spike-lib.mjs";
const EPS = 1e-7;
const W = "/Users/zacharymarion/Documents/code/tree-maker-rust/.claude/worktrees/stoic-nightingale-47aa90";

console.log("=== A2: O4 false positive, isolated (only perpendicular line meets the fold off-paper) ===");
{
  const st = new State(1, 1);
  const m = LP([0, 0.9], [0.1, 1]); st.addLine(m, "cp");           // slope +1, top-left corner
  const k = LP([0.1, 0], [0.1 + 0.9/Math.sqrt(3), 1]); st.addLine(k, "cp"); // 60° line through (0.1,0)
  const l = LP([0, 0.1], [0.1, 0]);                                  // target, slope -1, bottom-left corner
  const perp = [...st.L.values()].filter(x => Math.abs(l.n[0]*x.n[0]+l.n[1]*x.n[1]) < EPS);
  console.log("construct ->", construct(st, l));
  console.log("perpendicular lines and where the fold meets them:", perp.map(x => ({ line: lineKey(x), X: intersect(l, x), inPaper: st.inPaper(intersect(l, x)) })));
  console.log("points on l:", [...st.P.values()].filter(p => onLine(l, p)));
}

console.log("\n=== B2: O7 false positive, isolated (not constructible by any other axiom either) ===");
{
  const st = new State(1, 1);
  const m = LP([0, 0.9], [0.1, 1]); st.addLine(m, "cp");
  const k = LP([0.3, 0.3], [0.3 + 0.7/Math.sqrt(3), 1]); st.addLine(k, "cp"); // 60° line through (0.3,0.3)
  const l = LP([0, 0.3], [0.3, 0]);
  console.log("construct ->", construct(st, l), "| fold∩m =", intersect(l, m), "inPaper:", st.inPaper(intersect(l, m)));
  console.log("lander: (0,0) ->", reflectPt(l, [0,0]), "on k:", onLine(k, reflectPt(l,[0,0])), "| (0.3,0.3) in P:", st.hasPoint([0.3,0.3]));
  console.log("points on l:", [...st.P.values()].filter(p => onLine(l, p)), "(none => no O1/O4/O5)");
}

// ---- patched construct: RF-style feasibility + tolerance-based linesThrough ----
function linesThroughExact(st, p) { return [...st.L.values()].filter(m => onLine(m, p)); }
function clipSeg(st, l) { const out = []; for (const e of [...st.L.values()].filter(x => x.tag === "edge")) { const p = intersect(l, e); if (p && st.inPaper(p) && !out.some(q => Math.hypot(q[0]-p[0], q[1]-p[1]) < 1e-9)) out.push(p); } return out; }
function segsOverlap(a, b, dir) { // both segments collinear; project on dir
  const pa = a.map(p => p[0]*dir[0]+p[1]*dir[1]).sort((x,y)=>x-y), pb = b.map(p => p[0]*dir[0]+p[1]*dir[1]).sort((x,y)=>x-y);
  return Math.min(pa[1], pb[1]) - Math.max(pa[0], pb[0]) > 1e-9;
}
function constructPatched(st, l, opts) {
  const pts = [...st.P.values()];
  const onL = pts.filter(p => onLine(l, p));
  const perpAll = [...st.L.values()].filter(m => Math.abs(l.n[0]*m.n[0] + l.n[1]*m.n[1]) < EPS);
  const perpLines = opts.rfFeasibility ? perpAll.filter(m => st.inPaper(intersect(l, m))) : perpAll;
  const landers = [];
  for (const p of pts) {
    if (onLine(l, p)) continue;
    const r = reflectPt(l, p); if (!st.inPaper(r)) continue;
    const through = opts.exactThrough ? linesThroughExact(st, r) : st.linesThrough(r);
    const m1 = through.find(m => !onLine(m, p)); if (m1) landers.push({ p, m1 });
  }
  const ok = {};
  ok[1] = onL.length >= 2;
  ok[2] = pts.some(p => !onLine(l, p) && st.hasPoint(reflectPt(l, p)));
  ok[3] = [...st.L.values()].some(m => {
    const r = reflectLine(l, m); if (!r || lineKey(r) === lineKey(m) || !st.hasLine(r)) return false;
    if (!opts.rfFeasibility) return true;
    const rr = st.L.get(lineKey(r));
    const sm = clipSeg(st, m), sr = clipSeg(st, rr); if (sm.length < 2 || sr.length < 2) return false;
    const dir = [-r.n[1], r.n[0]];
    return segsOverlap(sm.map(p => reflectPt(l, p)), sr, dir);
  });
  ok[4] = perpLines.length > 0 && onL.length >= 1;
  ok[5] = onL.length >= 1 && landers.length >= 1;
  ok[6] = landers.length >= 2;
  ok[7] = perpLines.length > 0 && landers.length >= 1;
  for (const ax of [2,3,7,6,5,4,1]) if (ok[ax]) return ax;
  return 0;
}
function runClosure(file, mode) {
  const { segs, width, height } = loadCP(file);
  const byLine = new Map();
  for (const s of segs) { const l = LP(s.a, s.b); if (!l) continue; const k = lineKey(l); if (!byLine.has(k)) byLine.set(k, { line: l, asg: new Set() }); byLine.get(k).asg.add(s.asg); }
  const st = new State(width, height);
  let remaining = [...byLine.values()].filter(v => !st.hasLine(v.line)).map(v => v.line);
  const total = remaining.length;
  const hist = {}; let disagreements = 0; const fps = [];
  for (;;) {
    const next = []; let any = false;
    for (const l of remaining) {
      const axOrig = construct(st, l);
      const axPatched = constructPatched(st, l, { rfFeasibility: true, exactThrough: true });
      const ax = mode === "orig" ? axOrig : axPatched;
      if (axOrig !== axPatched) { disagreements++; if (fps.length < 6) fps.push({ line: lineKey(l), orig: axOrig, patched: axPatched }); }
      if (ax) { st.addLine(l, "cp"); hist[`O${ax}`] = (hist[`O${ax}`] ?? 0) + 1; any = true; } else next.push(l);
    }
    remaining = next; if (!any) break;
  }
  // linesThrough visibility audit over the final L
  let invisible = 0, lines = 0;
  for (const m of st.L.values()) { lines++; const p0 = [m.n[0]*m.d, m.n[1]*m.d]; const p = st.inPaper(p0) ? p0 : (clipSeg(st, m)[0] ?? p0); if (!st.linesThrough(p).some(x => lineKey(x) === lineKey(m))) invisible++; }
  return { total, folded: total - remaining.length, hist, disagreements, fps, invisible, lines };
}
console.log("\n=== F: real fixtures, closure from the bare sheet: original construct vs RF-feasibility + exact linesThrough ===");
for (const f of [`${W}/tests/fixtures/flat-folder/kabuto.fold`, `${W}/tests/fixtures/oriedita/solution_sample_1.cp`, `./grid6.fold`]) {
  for (const mode of ["orig", "patched"]) {
    const r = runClosure(f, mode);
    console.log(`${f.split("/").pop()} [${mode}] folded ${r.folded}/${r.total} hist=${JSON.stringify(r.hist)} construct-disagreements=${r.disagreements} linesThrough-invisible=${r.invisible}/${r.lines}`);
    if (r.fps.length) console.log("   sample disagreements:", JSON.stringify(r.fps));
  }
}
