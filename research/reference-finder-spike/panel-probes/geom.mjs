import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
const EPS = 1e-7;
const Q = 1e6; // hash quantum
const qk = (x) => Math.round(x * Q);

// ---------- load CP → segments in unit square ----------
function loadCP(path) {
  let segs = []; // {a:[x,y], b:[x,y], asg}
  let raw;
  if (path.endsWith(".osf")) {
    const d = JSON.parse(readFileSync(path, "utf8"));
    const doc = d.workspace.documents.find(x => x.kind === "crease-pattern");
    raw = doc.creasePattern.foldProjection;
  } else if (path.endsWith(".fold")) {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } else if (path.endsWith(".cp")) {
    const codes = { 1: "B", 2: "M", 3: "V", 4: "U" };
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const t = line.trim().split(/\s+/).map(Number);
      if (t.length < 5 || t.some(Number.isNaN)) continue;
      segs.push({ a: [t[1], t[2]], b: [t[3], t[4]], asg: codes[t[0]] ?? "U" });
    }
  } else throw new Error("unsupported file");
  if (raw) {
    const V = raw.vertices_coords, E = raw.edges_vertices, A = raw.edges_assignment ?? [];
    for (let i = 0; i < E.length; i++) segs.push({ a: V[E[i][0]].slice(0, 2), b: V[E[i][1]].slice(0, 2), asg: A[i] ?? "U" });
  }
  // paper = bounding box (assumed rectangular sheet); normalize to [0,1]
  const xs = segs.flatMap(s => [s.a[0], s.b[0]]), ys = segs.flatMap(s => [s.a[1], s.b[1]]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const W = x1 - x0, H = y1 - y0;
  const scale = Math.max(W, H);
  const nrm = (p) => [(p[0] - x0) / scale, (p[1] - y0) / scale];
  return { segs: segs.map(s => ({ a: nrm(s.a), b: nrm(s.b), asg: s.asg })), width: W / scale, height: H / scale };
}

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


export { EPS, Q, qk, lineFromPoints, lineKey, dirKey, ptKey, onLine, reflectPt, reflectLine, intersect, State, PRIORITY, construct, rfSolutionLines, DIAG, loadCP };
