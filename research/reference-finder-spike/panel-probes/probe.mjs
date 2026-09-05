// Optimality probe for the "closure + stuck" precrease planner.
//  - greedy(): the spike's stuck-handler, parameterised (target order, top-k, lookahead, beam)
//  - exact(): iterative-deepening search over forward-enumerated axiom folds (O1-O5, O7; O6 omitted)
//             → an UPPER bound on the true minimum aux count. If exact < greedy, greedy is proven suboptimal.
//  - rfDump(): show RF's top-k for a line from the bare square, with the fresh-line cost the planner sees.
import { EPS, lineFromPoints, lineKey, ptKey, onLine, reflectPt, intersect, State, construct, rfSolutionLines } from "./geom.mjs";
import { createFinder } from "../rf.mjs";

export const V = (x) => ({ n: [1, 0], d: x });
export const H = (y) => ({ n: [0, 1], d: y });
export const T = (p, q) => lineFromPoints(p, q);
const canon = (l) => { // canonical sign like lineFromPoints
  let [a, b] = l.n, d = l.d;
  if (a < -EPS || (Math.abs(a) < EPS && b < 0)) { a = -a; b = -b; d = -d; }
  if (Math.abs(a) < EPS) a = 0; if (Math.abs(b) < EPS) b = 0;
  return { n: [a, b], d };
};
const perpBisector = (p, q) => {
  const dx = q[0] - p[0], dy = q[1] - p[1], len = Math.hypot(dx, dy);
  if (len < EPS) return null;
  const n = [dx / len, dy / len], m = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  return canon({ n, d: n[0] * m[0] + n[1] * m[1] });
};
const crossesPaper = (l, w, h) => {
  const s = [[0, 0], [w, 0], [0, h], [w, h]].map(c => l.n[0] * c[0] + l.n[1] * c[1] - l.d);
  return s.some(v => v < -EPS) && s.some(v => v > EPS) || s.some(v => Math.abs(v) < EPS);
};
const isEdge = (l, w, h) => (l.n[1] === 0 && (Math.abs(l.d) < EPS || Math.abs(l.d - w) < EPS)) || (l.n[0] === 0 && (Math.abs(l.d) < EPS || Math.abs(l.d - h) < EPS));

export function cloneState(st) {
  const c = new State(st.width, st.height);
  for (const l of st.L.values()) c.addLine({ n: l.n, d: l.d }, l.tag);
  return c;
}

/** fold every constructible target; returns [foldedLines, remaining] */
export function closure(st, remaining, seq = []) {
  let rem = remaining;
  for (;;) {
    const next = []; let any = false;
    for (const l of rem) {
      const ax = construct(st, l);
      if (ax) { st.addLine(l, "cp"); seq.push({ line: l, axiom: ax, kind: "cp" }); any = true; }
      else next.push(l);
    }
    rem = next;
    if (!any) break;
  }
  return rem;
}

/** all one-step constructible lines from (L,P) via O1-O5,O7 (forward). O6 omitted. */
export function forwardCandidates(st) {
  const pts = [...st.P.values()], lines = [...st.L.values()];
  const out = new Map();
  const add = (l) => { if (!l) return; l = canon(l); if (!crossesPaper(l, st.width, st.height)) return; const k = lineKey(l); if (!st.L.has(k) && !out.has(k)) out.set(k, l); };
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    add(lineFromPoints(pts[i], pts[j]));           // O1
    add(perpBisector(pts[i], pts[j]));             // O2
  }
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {  // O3
    const a = lines[i], b = lines[j];
    const x = intersect(a, b);
    if (!x) { add({ n: a.n, d: (a.d + (a.n[0] * b.n[0] + a.n[1] * b.n[1] > 0 ? b.d : -b.d)) / 2 }); continue; }
    const ua = [-a.n[1], a.n[0]], ub = [-b.n[1], b.n[0]];
    for (const s of [1, -1]) {
      const u = [ua[0] + s * ub[0], ua[1] + s * ub[1]];
      if (Math.hypot(u[0], u[1]) < EPS) continue;
      add(lineFromPoints(x, [x[0] + u[0], x[1] + u[1]]));
    }
  }
  for (const m of lines) for (const p of pts) add(lineFromPoints(p, [p[0] + m.n[0], p[1] + m.n[1]]));  // O4
  for (const p of pts) for (const q of pts) {  // O5: fold p onto m, crease through q
    if (p === q) continue;
    const r2 = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
    for (const m of lines) {
      if (onLine(m, p)) continue;
      // foot of q on m, then chord
      const s = m.n[0] * q[0] + m.n[1] * q[1] - m.d;
      const foot = [q[0] - s * m.n[0], q[1] - s * m.n[1]];
      const h2 = r2 - s * s; if (h2 < -EPS) continue;
      const hh = Math.sqrt(Math.max(0, h2)), u = [-m.n[1], m.n[0]];
      for (const t of hh < EPS ? [0] : [hh, -hh]) {
        const r = [foot[0] + t * u[0], foot[1] + t * u[1]];
        if (!st.inPaper(r)) continue;
        add(perpBisector(p, r));
      }
    }
  }
  for (const p of pts) for (const m1 of lines) {  // O7: fold ⟂ m2 carrying p onto m1
    if (onLine(m1, p)) continue;
    for (const m2 of lines) {
      const dir = [-m2.n[1], m2.n[0]];
      const thru = lineFromPoints(p, [p[0] + dir[0], p[1] + dir[1]]);
      const r = thru && intersect(thru, m1);
      if (!r || !st.inPaper(r)) continue;
      add(perpBisector(p, r));
    }
  }
  return [...out.values()];
}

/** exact (modulo O6) minimum-aux search, IDDFS over aux budget */
export function exact(width, height, targets, kmax = 3, { verbose = false } = {}) {
  const cpKeys = new Set(targets.map(lineKey));
  let nodes = 0;
  for (let k = 0; k <= kmax; k++) {
    const seen = new Set();
    const st0 = new State(width, height);
    const seq0 = [];
    const rem0 = closure(st0, targets.filter(t => !st0.hasLine(t)), seq0);
    const dfs = (st, rem, budget, aux) => {
      nodes++;
      if (!rem.length) return aux;
      if (budget === 0) return null;
      const key = aux.map(lineKey).sort().join("|");
      if (seen.has(key)) return null; seen.add(key);
      const cands = forwardCandidates(st).filter(l => !cpKeys.has(lineKey(l)) && !isEdge(l, width, height));
      for (const c of cands) {
        const s2 = cloneState(st); s2.addLine(c, "aux");
        const r2 = closure(s2, rem);
        const res = dfs(s2, r2, budget - 1, [...aux, c]);
        if (res) return res;
      }
      return null;
    };
    const res = dfs(st0, rem0, k, []);
    if (verbose) console.log(`  exact: budget ${k} → ${res ? "FOUND" : "none"} (${nodes} nodes)`);
    if (res) return { aux: res, nodes };
  }
  return { aux: null, nodes };
}

let rfCache = null;
export async function rf(rank = 5, width = 1, height = 1) {
  if (!rfCache) rfCache = await createFinder({ rank, width, height });
  return rfCache;
}
const linePts = (l) => { const p0 = [l.n[0] * l.d, l.n[1] * l.d]; return [p0, [p0[0] - l.n[1], p0[1] + l.n[0]]]; };

export async function rfSolutions(l, count = 5, width = 1, height = 1) {
  const f = await rf(5, width, height);
  const [p0, p1] = linePts(l);
  const r = await f.solveLine(p0, p1, { count });
  return r.solutions.filter(s => s.err <= 1e-6).map(sol => ({ sol, ...rfSolutionLines(sol, width, height) }));
}

export const fmt = (l) => {
  if (l.n[1] === 0) return `x=${(l.d).toFixed(4)}`;
  if (l.n[0] === 0) return `y=${(l.d).toFixed(4)}`;
  return `[${l.n[0].toFixed(3)},${l.n[1].toFixed(3)}]·p=${l.d.toFixed(4)}`;
};

/**
 * greedy — mirrors the spike: at each stuck event query RF for every remaining line, score each exact solution by
 * fresh-line count, pick min (first wins ties), fold, re-close.
 *  opts.topk: RF count; opts.lookahead: rescore by (fresh - closureUnlocked) i.e. net new aux after one closure;
 *  opts.beam: keep the best `beam` candidates per stuck event and expand recursively (best final total wins).
 */
export async function greedy(width, height, targets, { topk = 5, lookahead = false, beam = 1, log = false } = {}) {
  const cpKeys = new Set(targets.map(lineKey));
  const st0 = new State(width, height);
  const seq0 = [];
  const rem0 = closure(st0, targets.filter(t => !st0.hasLine(t)), seq0);
  let queries = 0;
  const expand = async (st, rem) => {
    const cands = [];
    for (const l of rem) {
      const sols = await rfSolutions(l, topk, width, height); queries++;
      for (const { sol, lines, diagonals } of sols) {
        const fresh = [...diagonals, ...lines].filter(x => x.line && !st.hasLine(x.line));
        const auxLines = fresh.filter(x => !cpKeys.has(lineKey(x.line)));
        cands.push({ target: l, sol, fresh, auxLines, cost: fresh.length });
      }
    }
    // apply each candidate to a clone to measure the post-closure state
    for (const c of cands) {
      const s2 = cloneState(st);
      for (const x of c.fresh) s2.addLine(x.line, cpKeys.has(lineKey(x.line)) ? "cp" : "aux");
      if (!s2.hasLine(c.target)) s2.addLine(c.target, "cp");
      const r2 = closure(s2, rem.filter(l => !s2.hasLine(l)));
      c.state = s2; c.rem = r2; c.aux = c.auxLines.length; c.unlocked = rem.length - r2.length;
    }
    const score = lookahead ? (c) => [c.aux, -c.unlocked, c.cost] : (c) => [c.cost];
    cands.sort((a, b) => { const sa = score(a), sb = score(b); for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] - sb[i]; return 0; });
    return cands;
  };
  const run = async (st, rem, auxSoFar, depth) => {
    if (!rem.length) return { aux: auxSoFar, unsolved: 0 };
    const cands = await expand(st, rem);
    if (!cands.length) return { aux: auxSoFar, unsolved: rem.length };
    let best = null;
    for (const c of cands.slice(0, beam)) {
      if (log && depth === 0) console.log(`   cand target=${fmt(c.target)} cost=${c.cost} aux=${c.aux} unlocked=${c.unlocked} aux:[${c.auxLines.map(x => fmt(x.line)).join("; ")}]`);
      const r = await run(c.state, c.rem, [...auxSoFar, ...c.auxLines.map(x => x.line)], depth + 1);
      if (!best || r.unsolved < best.unsolved || (r.unsolved === best.unsolved && r.aux.length < best.aux.length)) best = r;
    }
    return best;
  };
  const res = await run(st0, rem0, [], 0);
  return { ...res, closure0: targets.length - rem0.length, queries };
}
