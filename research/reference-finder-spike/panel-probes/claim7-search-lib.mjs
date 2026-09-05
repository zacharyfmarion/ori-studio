// Claim 7 search: find a 2-line CP (A,B) on the unit square where the greedy stuck-handler
// (pick cheapest exact solution by #new lines) is strictly worse than picking B first.
// Model = the spike's State/construct (inverse constructibility). Forward generation O1-O5,O7 (no O6).
import { lineFromPoints, lineKey, ptKey, State, construct, EPS } from "./spike-lib.mjs";

const W = 1, H = 1;
const inPaper = (p) => p[0] > -EPS && p[0] < W + EPS && p[1] > -EPS && p[1] < H + EPS;
const reflectPt = (l, p) => { const s = l.n[0] * p[0] + l.n[1] * p[1] - l.d; return [p[0] - 2 * s * l.n[0], p[1] - 2 * s * l.n[1]]; };
function intersect(l, m) {
  const det = l.n[0] * m.n[1] - l.n[1] * m.n[0];
  if (Math.abs(det) < 1e-12) return null;
  return [(l.d * m.n[1] - m.d * l.n[1]) / det, (l.n[0] * m.d - m.n[0] * l.d) / det];
}
// does line cross the paper interior (not just touch a corner)?
function crossesPaper(l) {
  const corners = [[0, 0], [W, 0], [W, H], [0, H]];
  const s = corners.map(c => l.n[0] * c[0] + l.n[1] * c[1] - l.d);
  const pos = s.filter(v => v > 1e-9).length, neg = s.filter(v => v < -1e-9).length;
  return pos > 0 && neg > 0;
}
function lineThrough(p, dir) { return lineFromPoints(p, [p[0] + dir[0], p[1] + dir[1]]); }
function perpBisector(p, q) {
  const m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const d = [q[0] - p[0], q[1] - p[1]];
  if (Math.hypot(d[0], d[1]) < EPS) return null;
  return lineThrough(m, [-d[1], d[0]]);
}
// forward: all lines constructible in ONE step from state st (O1-O5, O7)
function forward(st) {
  const pts = [...st.P.values()], ls = [...st.L.values()];
  const out = new Map();
  const add = (l) => { if (l && crossesPaper(l) && !st.hasLine(l)) out.set(lineKey(l), l); };
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) { add(lineFromPoints(pts[i], pts[j])); add(perpBisector(pts[i], pts[j])); }
  for (let i = 0; i < ls.length; i++) for (let j = i + 1; j < ls.length; j++) {
    const l = ls[i], m = ls[j];
    const x = intersect(l, m);
    if (!x) { add({ n: l.n, d: (l.d + (l.n[0] * m.n[0] + l.n[1] * m.n[1] > 0 ? m.d : -m.d)) / 2 }); continue; }
    const dl = [-l.n[1], l.n[0]], dm = [-m.n[1], m.n[0]];
    add(lineThrough(x, [dl[0] + dm[0], dl[1] + dm[1]])); add(lineThrough(x, [dl[0] - dm[0], dl[1] - dm[1]]));
  }
  for (const l of ls) for (const p of pts) add(lineThrough(p, l.n)); // O4
  // O5: fold through p1 carrying p2 onto m
  for (const p1 of pts) for (const p2 of pts) { if (p1 === p2) continue; const r = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    for (const m of ls) { // circle(p1,r) ∩ m
      const foot = [m.n[0] * m.d, m.n[1] * m.d]; const dir = [-m.n[1], m.n[0]];
      // param t along m from foot: |foot + t dir - p1|^2 = r^2
      const fx = foot[0] - p1[0], fy = foot[1] - p1[1];
      const b = 2 * (fx * dir[0] + fy * dir[1]), c = fx * fx + fy * fy - r * r;
      const disc = b * b - 4 * c; if (disc < -1e-12) continue;
      for (const t of disc < 1e-12 ? [-b / 2] : [(-b + Math.sqrt(disc)) / 2, (-b - Math.sqrt(disc)) / 2]) {
        const q = [foot[0] + t * dir[0], foot[1] + t * dir[1]];
        if (!inPaper(q)) continue;
        const f = perpBisector(p2, q); if (f && Math.abs(f.n[0] * p1[0] + f.n[1] * p1[1] - f.d) < 1e-9) add(f);
      }
    }
  }
  // O7: fold ⟂ m2 carrying p onto m1
  for (const p of pts) for (const m1 of ls) for (const m2 of ls) {
    const dir = [-m2.n[1], m2.n[0]]; // p moves along m2's direction
    const denom = m1.n[0] * dir[0] + m1.n[1] * dir[1]; if (Math.abs(denom) < 1e-12) continue;
    const t = (m1.d - (m1.n[0] * p[0] + m1.n[1] * p[1])) / denom;
    const q = [p[0] + t * dir[0], p[1] + t * dir[1]];
    if (!inPaper(q) || Math.abs(t) < EPS) continue;
    add(perpBisector(p, q));
  }
  return out;
}
const mk = (lines = []) => { const st = new State(W, H); for (const l of lines) st.addLine(l, "aux"); return st; };
const desc = (l) => { // human readable: intersections with the square boundary
  const pts = []; const edges = [{ n: [1, 0], d: 0 }, { n: [1, 0], d: 1 }, { n: [0, 1], d: 0 }, { n: [0, 1], d: 1 }];
  for (const e of edges) { const p = intersect(l, e); if (p && inPaper(p) && !pts.some(q => ptKey(q) === ptKey(p))) pts.push(p); }
  return pts.map(p => `(${p[0].toFixed(4)},${p[1].toFixed(4)})`).join("—");
};

const base = mk();
const U1 = forward(base); // expect v,h,d,d'
console.log("U1:", [...U1.values()].map(desc));

export { forward, mk, desc, U1, intersect, inPaper };
