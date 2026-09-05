import { writeFileSync } from "node:fs";
import { createFinder } from "./rf.mjs";
const EPS = 1e-7; const Q = 1e6; const qk = (x) => Math.round(x * Q);
// ---------- line algebra: {n:[a,b] unit normal, d} with n·p = d, canonical sign ----------
function lineFromPoints(p, q) {
  let dx = q[0] - p[0], dy = q[1] - p[1];
  const len = Math.hypot(dx, dy);
  if (len < EPS) return null;
  let a = -dy / len, b = dx / len;
  let d = a * p[0] + b * p[1];
  if (a < -EPS || (Math.abs(a) < EPS && b < 0)) { a = -a; b = -b; d = -d; }
  if (Math.abs(a) < EPS) a = 0;
  if (Math.abs(b) < EPS) b = 0;
  return { n: [a, b], d };
}
const lineKey = (l) => `${qk(l.n[0])},${qk(l.n[1])},${qk(l.d)}`;
const dirKey = (l) => `${qk(l.n[0])},${qk(l.n[1])}`;
const ptKey = (p) => `${qk(p[0])},${qk(p[1])}`;
const onLine = (l, p) => Math.abs(l.n[0] * p[0] + l.n[1] * p[1] - l.d) < EPS;
const reflectPt = (l, p) => { const s = l.n[0] * p[0] + l.n[1] * p[1] - l.d; return [p[0] - 2 * s * l.n[0], p[1] - 2 * s * l.n[1]]; };
function reflectLine(l, m) {
  // two points on m
  const p0 = [m.n[0] * m.d, m.n[1] * m.d];
  const p1 = [p0[0] - m.n[1], p0[1] + m.n[0]];
  return lineFromPoints(reflectPt(l, p0), reflectPt(l, p1));
}
function intersect(l, m) {
  const det = l.n[0] * m.n[1] - l.n[1] * m.n[0];
  if (Math.abs(det) < 1e-12) return null;
  return [(l.d * m.n[1] - m.d * l.n[1]) / det, (l.n[0] * m.d - m.n[0] * l.d) / det];
}

// ---------- state ----------
class State {
  constructor(width, height, edgeLines = null) {
    this.width = width; this.height = height;
    this.L = new Map();          // key → line
    this.dirs = new Map();       // dirKey → Set(qk(d))  — for fast point-on-any-line
    this.P = new Map();          // key → point
    const edges = edgeLines ?? [ { n: [1, 0], d: 0 }, { n: [1, 0], d: width }, { n: [0, 1], d: 0 }, { n: [0, 1], d: height } ];
    for (const l of edges) this.addLine(l, "edge");
    this.edgeCount = edges.length;
  }
  inPaper(p) { return p[0] > -EPS && p[0] < this.width + EPS && p[1] > -EPS && p[1] < this.height + EPS; }
  hasLine(l) { return this.L.has(lineKey(l)); }
  hasPoint(p) { return this.P.has(ptKey(p)); }
  /** folded lines through p (via direction index); [] if none */
  linesThrough(p) {
    const out = [];
    for (const [dk, ds] of this.dirs) {
      const [a, b] = dk.split(",").map(Number).map(v => v / Q);
      const d = a * p[0] + b * p[1];
      if (ds.has(qk(d))) { const k = `${qk(a)},${qk(b)},${qk(d)}`; const m = this.L.get(k); if (m) out.push(m); }
    }
    return out;
  }
  onAnyLine(p) { return this.linesThrough(p).length > 0; }
  addLine(l, tag) {
    const k = lineKey(l);
    if (this.L.has(k)) return false;
    // new intersections
    for (const m of this.L.values()) {
      const p = intersect(l, m);
      if (p && this.inPaper(p)) { const pk = ptKey(p); if (!this.P.has(pk)) this.P.set(pk, p); }
    }
    this.L.set(k, { ...l, tag });
    const dk = dirKey(l);
    if (!this.dirs.has(dk)) this.dirs.set(dk, new Set());
    this.dirs.get(dk).add(qk(l.d));
    return true;
  }
}

// ---------- constructibility ----------
const PRIORITY = [2, 3, 7, 6, 5, 4, 1]; // ReferenceFinder default preference order
function construct(st, l) {
  // gather facts once
  const pts = [...st.P.values()];
  const onL = pts.filter(p => onLine(l, p));
  const perpLines = [...st.L.values()].filter(m => Math.abs(l.n[0] * m.n[0] + l.n[1] * m.n[1]) < EPS);
  // points whose reflection lands on a folded line inside the paper (excluding points on l itself)
  const landers = []; // {p, m1}: fold carries p (not on m1, not on ℓ) onto folded line m1, inside the paper
  for (const p of pts) {
    if (onLine(l, p)) continue;
    const r = reflectPt(l, p);
    if (!st.inPaper(r)) continue;
    const m1 = st.linesThrough(r).find(m => !onLine(m, p));
    if (m1) landers.push({ p, m1 });
  }
  const ok = {};
  ok[1] = onL.length >= 2;
  ok[2] = pts.some(p => !onLine(l, p) && st.hasPoint(reflectPt(l, p)));
  ok[3] = [...st.L.values()].some(m => { const r = reflectLine(l, m); return r && lineKey(r) !== lineKey(m) && st.hasLine(r); });
  ok[4] = perpLines.length > 0 && onL.length >= 1;
  ok[5] = onL.length >= 1 && landers.length >= 1;
  ok[6] = landers.length >= 2 && landers.some(a => landers.some(b => a !== b && (lineKey(a.m1) !== lineKey(b.m1) || ptKey(a.p) !== ptKey(b.p))));
  ok[7] = perpLines.length > 0 && landers.length >= 1;
  for (const ax of PRIORITY) if (ok[ax]) return ax;
  return 0;
}

// ---------- RF step-line extraction (mirrors reference-finder bridge.ts parseSolution + solution.tsx) ----------
// diagrams[] has one entry per LINE step; an axiom-0 (intersection) step shares the preceding line's diagram.
// RF also treats the two diagonals as rank-1 "originals" (labels sw_ne / nw_se) that never appear as steps —
// if a solution references them they must be charged as auxiliary folds unless already folded.
const DIAG = { sw_ne: lineFromPoints([0, 0], [1, 1]), nw_se: lineFromPoints([0, 1], [1, 0]) };
function rfSolutionLines(sol, width = 1, height = 1) {
  const out = [];
  const needDiag = new Set();
  let j = 0;
  for (const step of sol.steps) {
    for (const f of ["p0", "p1", "l0", "l1"]) if (step[f] === "sw_ne" || step[f] === "nw_se") needDiag.add(step[f]);
    if (step.axiom === 0) continue;
    const diag = sol.diagrams[j++];
    const want = step.pinch ? 7 : 3; // LineStyle.pinch : LineStyle.valley
    const el = diag && diag.find(e => e && e.type === 1 && e.style === want);
    if (el) out.push({ line: lineFromPoints(el.from, el.to), axiom: step.axiom, pinch: !!step.pinch });
  }
  const diagonals = [...needDiag].map(k => ({ line: k === "sw_ne" ? lineFromPoints([0, 0], [width, height]) : lineFromPoints([0, height], [width, 0]), axiom: 1, diagonal: true }));
  return { lines: out, diagonals };
}


// ---- search for a cost-proxy divergence ----
const rf = await createFinder({ rank: 5 });
const width = 1, height = 1;
const fr = [0, 1/8, 1/4, 3/8, 1/2, 5/8, 3/4, 7/8, 1, 1/3, 2/3, 1/6, 5/6];
const pts = []; for (const x of fr) for (const y of fr) pts.push([x, y]);
const cand = new Map();
for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { const l = lineFromPoints(pts[i], pts[j]); if (l) cand.set(lineKey(l), l); }
console.log("candidate lines", cand.size);
const bare = new State(width, height);
// keep only lines NOT constructible from the bare sheet
const stuckLines = [...cand.values()].filter(l => !bare.hasLine(l) && construct(bare, l) === 0);
console.log("non-constructible from bare", stuckLines.length);
const sols = new Map(); // key -> [{set:[keys], lines:[{line,axiom,pinch}]}]
let n = 0;
for (const l of stuckLines) {
  const p0 = [l.n[0] * l.d, l.n[1] * l.d], p1 = [p0[0] - l.n[1], p0[1] + l.n[0]];
  const r = await rf.solveLine(p0, p1, { count: 5 });
  const arr = [];
  for (const sol of r.solutions) {
    if (sol.err > 1e-6) continue;
    const { lines: ls, diagonals } = rfSolutionLines(sol, width, height);
    const all = [...diagonals, ...ls].filter(x => x.line);
    const keys = [...new Set(all.map(x => lineKey(x.line)))];
    if (!keys.includes(lineKey(l))) continue;
    arr.push({ keys, all, rank: sol.rank });
  }
  sols.set(lineKey(l), arr); n += arr.length;
}
console.log("solutions", n);
const lineOf = (k) => cand.get(k);
// pattern: A for T with keys {X, C, T} (X not a candidate CP line or we treat X as aux; C != T, C stuck) ;
// B for T' with keys {Y, Z, T'} ; {Y,Z} disjoint from {X,C,T}; T' constructible from bare + {C, T} (closure) ;
// C and T not constructible from bare + {Y, Z, T'}.
let found = 0;
const hist = {}; for (const arr of sols.values()) for (const A of arr) hist[A.keys.length] = (hist[A.keys.length] ?? 0) + 1; console.log("solution sizes", hist);
outer: for (const [tk, arrA] of sols) for (const A of arrA) {
  const cps = A.keys.filter(k => k !== tk && sols.has(k));           // CP-line intermediates
  const auxA = A.keys.filter(k => k !== tk && !sols.has(k));          // genuine aux
  if (cps.length < 1 || auxA.length !== 1) continue;
  const stA = new State(width, height); for (const x of A.all) stA.addLine(x.line, "a");
  for (const [tpk, arrB] of sols) {
    if (A.keys.includes(tpk)) continue;
    if (construct(stA, lineOf(tpk)) === 0) continue;                  // T' free after plan A
    for (const B of arrB) {
      if (B.keys.length > A.keys.length) continue;                    // naive cost prefers/ties B
      const yz = B.keys.filter(k => k !== tpk);
      if (yz.some(k => A.keys.includes(k) || sols.has(k))) continue;   // all genuine aux, disjoint
      if (yz.length <= 1) continue;                                   // auxB >= 2 > auxA = 1
      const stB = new State(width, height); for (const x of B.all) stB.addLine(x.line, "b");
      if (cps.some(k => construct(stB, lineOf(k))) || construct(stB, lineOf(tk))) continue;
      found++;
      console.log("FOUND", { T: lineOf(tk), CPs: cps.map(lineOf), auxA: auxA, Tp: lineOf(tpk), A: A.keys, B: B.keys });
      const clip = (l) => { const ps = []; for (const e of [...bare.L.values()]) { const p = intersect(l, e); if (p && bare.inPaper(p) && !ps.some(q => Math.hypot(q[0]-p[0], q[1]-p[1]) < 1e-9)) ps.push(p); } return ps; };
      const out = ["1 0 0 400 0", "1 400 0 400 400", "1 400 400 0 400", "1 0 400 0 0"];
      for (const k of [tpk, tk, ...cps]) { const ps = clip(lineOf(k)); out.push(`2 ${ps[0][0]*400} ${ps[0][1]*400} ${ps[1][0]*400} ${ps[1][1]*400}`); }
      writeFileSync(`divergence-${found}.cp`, out.join("\n") + "\n");
      if (found >= 3) break outer;
    }
  }
}
console.log("found", found);
process.exit(0);
