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
export { lineFromPoints, lineKey, ptKey, onLine, reflectPt, reflectLine, intersect, State, construct, qk };
