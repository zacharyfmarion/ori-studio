// Spike: whole-CP precrease planning by "inverse constructibility" closure + ReferenceFinder fallback.
//
// Model: flat sheet, one Huzita–Justin fold per step, each fold produces one full line.
// State = (L: folded lines incl. 4 edges, P: known points = in-paper intersections of L).
// A CP line is one-step constructible if some axiom O1..O7 with inputs from (L,P) yields it.
// Closure = fixpoint of folding constructible CP lines (monotone → order-independent).
// Stuck  = remaining CP lines, none constructible → ask ReferenceFinder (unseeded), dedupe its
//          steps against L, pick the cheapest, fold its new lines, repeat.
//
// usage: node spike-closure.mjs <file> [--rank=5] [--cp-scale=200] [--verbose] [--no-rf] [--seed-marks=20]
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { createFinder } from "./rf.mjs";

const args = Object.fromEntries(process.argv.slice(3).map(a => { const [k, v] = a.replace(/^--/, "").split("="); return [k, v ?? "1"]; }));
const RANK = Number(args.rank ?? 5);
const VERBOSE = !!args.verbose;
const USE_RF = !args["no-rf"];
const SEED_MARKS = Number(args["seed-marks"] ?? 0);
const BUDGET_MS = Number(args["budget-ms"] ?? 0);
const JSON_OUT = !!args.json;
const say = JSON_OUT ? () => {} : console.log.bind(console);
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

// ---------- main ----------
const file = process.argv[2];
const t0 = performance.now();
const { segs, width, height } = loadCP(file);
const byLine = new Map();
let border = 0;
for (const s of segs) {
  const l = lineFromPoints(s.a, s.b);
  if (!l) continue;
  const k = lineKey(l);
  if (!byLine.has(k)) byLine.set(k, { line: l, segs: 0, asg: new Set() });
  byLine.get(k).segs++; byLine.get(k).asg.add(s.asg);
}
// Sheet model: if the CP carries border ('B') segments, THOSE lines are the free sheet edges (BP Studio sheets
// are notched polygons, not rectangles); otherwise fall back to the bounding-box rectangle. inPaper stays a
// bbox test here (over-approximation for notched sheets — the product needs point-in-polygon).
const borderLines = [...byLine.values()].filter(v => [...v.asg].every(a => a === "B"));
const st = new State(width, height, borderLines.length ? borderLines.map(v => v.line) : null);
const targets = [];
for (const v of byLine.values()) {
  if (st.hasLine(v.line)) { border++; continue; } // a sheet edge (free)
  targets.push(v);
}
say(`\n=== ${file.split("/").pop()} ===`);
say(`segments=${segs.length}  distinct lines=${byLine.size}  sheet-edge lines (free): ${st.edgeCount}  target lines=${targets.length}  bbox=${width.toFixed(3)}×${height.toFixed(3)}`);
const asgCount = {}; for (const s of segs) asgCount[s.asg] = (asgCount[s.asg] ?? 0) + 1;
say(`assignments: ${JSON.stringify(asgCount)}`);

let remaining = targets.map(t => t.line);
const sequence = []; // {line, axiom, kind: 'cp'|'aux', via}
let stuckEvents = 0, auxCount = 0, rfQueries = 0, rfMs = 0, approxCount = 0;

function closure() {
  let folded = 0, pass = 0;
  for (;;) {
    pass++;
    const next = [];
    let any = false;
    for (const l of remaining) {
      const ax = construct(st, l);
      if (ax) { st.addLine(l, "cp"); sequence.push({ line: l, axiom: ax, kind: "cp" }); folded++; any = true; }
      else next.push(l);
    }
    remaining = next;
    if (!any) break;
  }
  return folded;
}

let rf = null;
const c0 = closure();
say(`closure₀ from bare square: folded ${c0}/${targets.length} CP lines with 0 auxiliary creases   |P|=${st.P.size} |L|=${st.L.size}`);

const rfCache = new Map(); // lineKey → solutions from the bare sheet (state-independent)
let status = "ok";
async function rfSolve(l) {
  const k = lineKey(l);
  if (rfCache.has(k)) return rfCache.get(k);
  const p0 = [l.n[0] * l.d, l.n[1] * l.d], p1 = [p0[0] - l.n[1], p0[1] + l.n[0]];
  const r = await rf.solveLine(p0, p1, { count: 5 });
  rfQueries++; rfMs += r.ms;
  rfCache.set(k, r.solutions);
  return r.solutions;
}
while (remaining.length && USE_RF) {
  if (BUDGET_MS && performance.now() - t0 > BUDGET_MS) { status = "timeout"; break; }
  stuckEvents++;
  if (!rf) {
    const seedMarks = SEED_MARKS ? [...st.P.values()].slice(0, SEED_MARKS) : [];
    rf = await createFinder({ rank: RANK, width, height, seedMarks });
    say(`[rf] database rank ${RANK} built in ${rf.buildMs.toFixed(0)}ms ${SEED_MARKS ? `(seeded ${seedMarks.length} marks)` : ""}`);
  }
  // query every remaining line; score each solution by NEW lines it needs (dedupe against L)
  let best = null;
  for (const l of remaining) {
    const sols = await rfSolve(l);
    for (const sol of sols) {
      if (sol.err > 1e-6) continue; // want exact constructions for exact CP lines
      const { lines: ls, diagonals } = rfSolutionLines(sol, width, height);
      const fresh = [...diagonals, ...ls].filter(x => x.line && !st.hasLine(x.line));
      const cost = fresh.length;
      if (!best || cost < best.cost) best = { target: l, sol, fresh, cost };
    }
  }
  if (!best) {
    // no exact solution for any remaining line at this rank: accept best approximate
    let bestApprox = null;
    for (const l of remaining) {
      const sol = (await rfSolve(l))[0]; if (!sol) continue;
      if (!bestApprox || sol.err < bestApprox.sol.err) { const { lines: ls, diagonals } = rfSolutionLines(sol, width, height); bestApprox = { target: l, sol, fresh: [...diagonals, ...ls].filter(x => x.line && !st.hasLine(x.line)) }; }
    }
    if (!bestApprox) { say(`[stuck ${stuckEvents}] RF returned nothing for ${remaining.length} lines — giving up`); break; }
    best = { ...bestApprox, cost: bestApprox.fresh.length }; approxCount++;
    say(`[stuck ${stuckEvents}] no EXACT construction at rank ${RANK}; best approx err=${best.sol.err.toExponential(2)} rank=${best.sol.rank}`);
  }
  // fold the fresh lines from the chosen solution (aux lines then the target), then re-close
  for (const x of best.fresh) {
    const isTarget = lineKey(x.line) === lineKey(best.target) || remaining.some(l => lineKey(l) === lineKey(x.line));
    x.kindAux = !isTarget;
    st.addLine(x.line, isTarget ? "cp" : "aux");
    sequence.push({ line: x.line, axiom: x.axiom, kind: isTarget ? "cp" : "aux", pinch: x.pinch, diagonal: x.diagonal });
    if (!isTarget) auxCount++;
  }
  // make sure the target itself is now folded (RF's last step IS the target line)
  if (!st.hasLine(best.target)) { st.addLine(best.target, "cp"); sequence.push({ line: best.target, axiom: best.sol.steps.at(-1)?.axiom ?? 0, kind: "cp" }); }
  remaining = remaining.filter(l => !st.hasLine(l));
  const c = closure();
  say(`[stuck ${stuckEvents}] RF: target rank ${best.sol.rank}, ${best.sol.steps.length} steps, ${best.fresh.length} new lines (${best.fresh.filter(x => x.kindAux).length} aux) → closure unlocked ${c} more; remaining ${remaining.length}`);
}

const cpFolded = sequence.filter(s => s.kind === "cp").length;
say(`\nRESULT: sequence length ${sequence.length} = ${cpFolded} CP lines + ${auxCount} auxiliary   (lower bound ${targets.length})   unsolved ${remaining.length}   stuck events ${stuckEvents}   approx ${approxCount}`);
const axHist = {}; for (const s of sequence) axHist[`O${s.axiom}`] = (axHist[`O${s.axiom}`] ?? 0) + 1;
say(`axiom histogram: ${JSON.stringify(axHist)}`);
say(`time: total ${(performance.now() - t0).toFixed(0)}ms   rf queries ${rfQueries} (${rfMs.toFixed(0)}ms)   |P|=${st.P.size} |L|=${st.L.size}`);
if (VERBOSE) {
  say("\nsequence:");
  sequence.slice(0, 60).forEach((s, i) => say(`  ${String(i + 1).padStart(3)}. O${s.axiom} ${s.kind}${s.pinch ? " (pinch)" : ""}  n=(${s.line.n[0].toFixed(4)},${s.line.n[1].toFixed(4)}) d=${s.line.d.toFixed(4)}`));
  if (sequence.length > 60) say(`  … ${sequence.length - 60} more`);
}
if (JSON_OUT) {
  process.stdout.write(JSON.stringify({
    file: file.split("/").pop().replace(/^cpoogle-[^-]+-cpoogle-[^-]+-/, "").slice(0, 60),
    segments: segs.length, lines: byLine.size, edges: st.edgeCount, targets: targets.length,
    closure0: c0, stuck: stuckEvents, aux: auxCount, cp_folded: cpFolded, unsolved: remaining.length,
    approx: approxCount, status, ms: Math.round(performance.now() - t0), rf_queries: rfQueries,
    P: st.P.size, bbox: [Number(width.toFixed(3)), Number(height.toFixed(3))], asg: asgCount,
  }) + "\n");
}
process.exit(0);
