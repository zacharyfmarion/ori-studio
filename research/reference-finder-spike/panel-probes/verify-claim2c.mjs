import { lineFromPoints as LP, lineKey, onLine, reflectPt, intersect, State, construct, qk } from "./verify-geom.mjs";
import { loadCP } from "./spike-lib.mjs";
const W = "/Users/zacharymarion/Documents/code/tree-maker-rust/.claude/worktrees/stoic-nightingale-47aa90";
function distinctLines(file) {
  const { segs, width, height } = loadCP(file); const by = new Map();
  for (const s of segs) { const l = LP(s.a, s.b); if (l) by.set(lineKey(l), l); }
  return { lines: [...by.values()], width, height };
}
// hash-visibility audit without a State: does the dirs-index lookup reproduce qk(l.d) from a point on the line?
function invisible(l, width, height) {
  const a = qk(l.n[0]) / 1e6, b = qk(l.n[1]) / 1e6;
  // a point on l inside the sheet: try clipping against the 4 edges
  const edges = [{ n: [1,0], d: 0 }, { n: [1,0], d: width }, { n: [0,1], d: 0 }, { n: [0,1], d: height }];
  const pts = edges.map(e => intersect(l, e)).filter(p => p && p[0] > -1e-7 && p[0] < width + 1e-7 && p[1] > -1e-7 && p[1] < height + 1e-7);
  if (!pts.length) return null;
  const mid = [(pts[0][0] + pts.at(-1)[0]) / 2, (pts[0][1] + pts.at(-1)[1]) / 2];
  return [pts[0], mid].some(p => qk(a * p[0] + b * p[1]) !== qk(l.d));
}
for (const f of ["./iguana-c0.fold", `${W}/tests/fixtures/flat-folder/kabuto.fold`, "./grid6.fold", `${W}/tests/fixtures/oriedita/solution_sample_1.cp`]) {
  const { lines, width, height } = distinctLines(f);
  const byAngle = {};
  let inv = 0; for (const l of lines) { const r = invisible(l, width, height); if (r === null) continue; const ang = Math.round(Math.atan2(l.n[1], l.n[0]) * 180 / Math.PI); byAngle[ang] ??= [0, 0]; byAngle[ang][1]++; if (r) { inv++; byAngle[ang][0]++; } }
  console.log(`${f.split("/").pop()}: ${inv}/${lines.length} distinct lines invisible to linesThrough; by normal angle {ang: [invisible,total]} = ${JSON.stringify(byAngle)}`);
}

console.log("\n=== RF sVisibilityMatters audit: O2 folds whose every witness pair is interior/interior ===");
for (const f of [`${W}/tests/fixtures/flat-folder/kabuto.fold`, "./grid6.fold", `${W}/tests/fixtures/oriedita/solution_sample_1.cp`]) {
  const { lines, width, height } = distinctLines(f);
  const st = new State(width, height);
  let remaining = lines.filter(l => !st.hasLine(l));
  const onEdge = (p) => Math.abs(p[0]) < 1e-7 || Math.abs(p[0] - width) < 1e-7 || Math.abs(p[1]) < 1e-7 || Math.abs(p[1] - height) < 1e-7;
  let interiorOnly = 0, o2 = 0;
  for (;;) {
    const next = []; let any = false;
    for (const l of remaining) {
      const ax = construct(st, l);
      if (ax === 2) { o2++; const pairs = [...st.P.values()].filter(p => !onLine(l, p) && st.hasPoint(reflectPt(l, p))); if (!pairs.some(p => onEdge(p) || onEdge(reflectPt(l, p)))) interiorOnly++; }
      if (ax) { st.addLine(l, "cp"); any = true; } else next.push(l);
    }
    remaining = next; if (!any) break;
  }
  console.log(`${f.split("/").pop()}: ${o2} O2 folds, ${interiorOnly} have no edge-point witness (RefLine_P2P would reject under the default sVisibilityMatters=true)`);
}
