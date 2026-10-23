#!/usr/bin/env node
import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { basename, extname, join } from "node:path";
import { IO } from "../../third_party/flat-folder/src/io.js";
import { M } from "../../third_party/flat-folder/src/math.js";
import { X } from "../../third_party/flat-folder/src/conversion.js";
import { CON } from "../../third_party/flat-folder/src/constraints.js";
import { SOLVER } from "../../third_party/flat-folder/src/solver.js";
import { NOTE } from "../../third_party/flat-folder/src/note.js";

NOTE.show = false;
CON.build();

// verify's arrangement checks (see verify below).
// The finest ε a rejected arrangement is retried at.
const VERIFY_MIN_EPS = 1e-13;
// A vertex image may move by this times the folded extent.
const VERIFY_SNAP = 1e-8;
// Lengths and areas agree to this times the folded extent or the paper area;
// a boundary turn this flat counts as straight.
const VERIFY_MEASURE = 1e-9;

const command = process.argv[2];
const file = process.argv[3];
const args = process.argv.slice(4);

if (!command || !file) {
  usage();
  process.exit(2);
}

try {
  if (command === "run-corpus") {
    const limit = parseLimit(args);
    const result = runCorpus(file, limit);
    process.stdout.write(`${stableStringify(result)}\n`);
    process.exit(0);
  }
  if (command === "verify") {
    if (!args[0]) {
      usage();
      process.exit(2);
    }
    const result = verify(file, args[0]);
    process.stdout.write(`${stableStringify(result)}\n`);
    process.exit(0);
  }
  const doc = readFileSync(file, "utf8");
  const limit = parseLimit(args);
  const result = run(command, file, doc, limit);
  process.stdout.write(`${stableStringify(result)}\n`);
} catch (error) {
  process.stderr.write(`flat-folder-oracle: ${error?.stack ?? error}\n`);
  process.exit(1);
}

function usage() {
  process.stderr.write(
    "usage: oracle.mjs <normalize|project|overlap|constraints|solve|run-corpus> <file-or-dir> [--limit <n|all>]\n" +
      "       oracle.mjs verify <fold> <order.json>\n",
  );
}

function parseLimit(args) {
  let limit = 10;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--limit" && i + 1 < args.length) {
      const raw = args[i + 1];
      limit = raw === "all" ? Infinity : Number(raw);
      i += 1;
    }
  }
  if (!(limit === Infinity || (Number.isInteger(limit) && limit > 0))) {
    throw new Error("limit must be a positive integer or all");
  }
  return limit;
}

function runCorpus(root, limit) {
  const entries = [];
  const seenDirs = new Set();
  scanFoldFiles(root, entries, seenDirs);
  const byHash = new Map();
  let duplicates = 0;
  for (const file of entries) {
    const bytes = readFileSync(file);
    const hash = createHash("sha256").update(bytes).digest("hex");
    if (byHash.has(hash)) {
      duplicates += 1;
      continue;
    }
    byHash.set(hash, { file, doc: bytes.toString("utf8") });
  }
  const statuses = {};
  const cases = [];
  for (const { file, doc } of byHash.values()) {
    const result = run("solve", file, doc, limit);
    statuses[result.status] = (statuses[result.status] ?? 0) + 1;
    cases.push({
      file,
      status: result.status,
      solve: result.solve,
      constraints: result.constraints,
      error: result.error,
    });
  }
  return {
    command: "run-corpus",
    file: root,
    limit: limit === Infinity ? "all" : limit,
    total: entries.length,
    unique: byHash.size,
    duplicates,
    statuses,
    cases,
  };
}

function scanFoldFiles(root, entries, seenDirs) {
  const stat = statSync(root);
  if (stat.isDirectory()) {
    const real = realpathSync(root);
    if (seenDirs.has(real)) {
      return;
    }
    seenDirs.add(real);
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      scanFoldFiles(join(root, entry.name), entries, seenDirs);
    }
  } else if (stat.isFile() && extname(root).toLowerCase() === ".fold") {
    entries.push(root);
  }
}

function run(command, file, doc, limit) {
  const type = extname(file).slice(1).toLowerCase();
  if (type !== "fold" && type !== "cp" && type !== "svg" && type !== "opx") {
    throw new Error(`unsupported extension .${type}`);
  }
  const pipeline = buildPipeline(doc, type, true, limit, command);
  const common = {
    file: basename(file),
    command,
    limit: limit === Infinity ? "all" : limit,
    status: pipeline.status,
  };
  if (pipeline.status !== "ok") {
    return { ...common, error: pipeline.error };
  }
  switch (command) {
    case "normalize":
      return { ...common, normalize: normalizeRecord(pipeline) };
    case "project":
      return { ...common, normalize: normalizeRecord(pipeline), project: projectRecord(pipeline, true) };
    case "overlap":
      return { ...common, normalize: normalizeRecord(pipeline), project: projectRecord(pipeline, true), overlap: overlapRecord(pipeline, true) };
    case "constraints":
      return { ...common, normalize: normalizeRecord(pipeline), project: projectRecord(pipeline), overlap: overlapRecord(pipeline), constraints: constraintsRecord(pipeline) };
    case "solve":
      return { ...common, normalize: normalizeRecord(pipeline), project: projectRecord(pipeline), overlap: overlapRecord(pipeline), constraints: constraintsRecord(pipeline), solve: solveRecord(pipeline) };
    default:
      throw new Error(`unknown command ${command}`);
  }
}

function buildPipeline(doc, type, side, limit, command) {
  try {
    const [V, VV, EV, EA, EF, FV, FE] =
      IO.doc_type_side_2_V_VV_EV_EA_EF_FV_FE(doc, type, side);
    if (V === undefined) {
      return { status: "invalid-input", error: "Flat-Folder import returned no vertices" };
    }
    const VK = X.V_VV_EV_EA_2_VK(V, VV, EV, EA);
    if (command === "normalize") {
      return { status: "ok", V, VV, EV, EA, EF, FV, FE, VK };
    }
    const [Vf, Ff] = X.V_FV_EV_EA_2_Vf_Ff(V, FV, EV, EA);
    if (command === "project") {
      return { status: "ok", V, VV, EV, EA, EF, FV, FE, VK, Vf, Ff };
    }
    const L = EV.map((edge) => M.expand(edge, Vf));
    const [P, SP, SE, eps_i] = X.L_2_V_EV_EL(L);
    if (P.length === 0) {
      return { status: "precision-failure", error: "could not find stable folded edge graph" };
    }
    const [, CP] = X.V_EV_2_VV_FV(P, SP);
    const [SC, CS] = X.EV_FV_2_EF_FE(SP, CP);
    const [CF, FC] = X.EF_FV_P_SP_SE_CP_SC_2_CF_FC(EF, FV, P, SP, SE, CP, SC);
    if (command === "overlap") {
      return {
        status: "ok",
        V, VV, EV, EA, EF, FV, FE, VK, Vf, Ff,
        P, SP, SE, eps_i, CP, SC, CS, CF, FC,
      };
    }
    const BF = X.EF_SP_SE_CP_CF_2_BF(EF, SP, SE, CP, CF);
    const BI = new Map();
    for (const [i, F] of BF.entries()) {
      BI.set(F, i);
    }
    const BT = X.BF_BI_EF_SE_CF_SC_2_BT(BF, BI, EF, SE, CF, SC);
    const BTn = [0, 0, 0];
    for (const bT of BT) {
      for (let i = 0; i < 3; i += 1) {
        BTn[i] += bT[i].length;
      }
    }
    for (const [i, d] of [[0, 6], [1, 2], [2, 2]]) {
      BTn[i] /= d;
    }
    const CC = X.FC_BF_BI_BT_2_CC(FC, BF, BI, BT);
    const BA0 = SOLVER.EF_EA_Ff_BF_BI_2_BA0(EF, EA, Ff, BF, BI);
    const trans_count = { all: 0, reduced: 0 };
    const assigned = SOLVER.initial_assignment(
      BA0,
      BF,
      BT,
      BI,
      FC,
      CF,
      CC,
      trans_count,
    );
    if ((assigned.length === 3) && (assigned[0].length === undefined)) {
      const [constraintType, faces, conflictFaces] = assigned;
      return {
        status: "assignment-conflict",
        error: {
          constraint_type: CON.names[constraintType],
          faces,
          conflict_faces: conflictFaces,
        },
      };
    }
    const BA = assigned;
    const GB = SOLVER.get_components(BI, BF, BT, BA, FC, CF, CC, trans_count);
    if (command === "constraints") {
      return {
        status: "ok",
        V, VV, EV, EA, EF, FV, FE, VK, Vf, Ff,
        P, SP, SE, eps_i, CP, SC, CS, CF, FC,
        BF, BT, BTn, CC, BA, GB, trans_count,
      };
    }
    const GA = SOLVER.solve(BI, BF, BT, BA, GB, FC, CF, CC, limit);
    if (GA.length === undefined) {
      return { status: "unsatisfied-component", error: { component: GA } };
    }
    const edges = X.BF_GB_GA_GI_2_edges(BF, GB, GA, GA.map(() => 0));
    const FO = X.edges_Ff_2_FO(edges, Ff);
    return {
      status: "ok",
      V, VV, EV, EA, EF, FV, FE, VK, Vf, Ff,
      P, SP, SE, eps_i, CP, SC, CS, CF, FC,
      BF, BT, BTn, CC, BA, GB, GA, trans_count, FO,
    };
  } catch (error) {
    return { status: "oracle-error", error: String(error?.message ?? error) };
  }
}

// verify: check a complete layer order against Flat-Folder's own constraints,
// on an arrangement that has been validated first.
//
// The FOLD's face numbering is kept, since the order's face indices refer to
// it: the file importer (io.js) would re-sort faces by area. Flat-Folder folds
// from face 0 (V_FV_EV_EA_2_Vf_Ff) and builds its arrangement at the ε its
// heuristic picks (L_2_V_EV_EL). On thin features that ε can give a wrong
// arrangement, so a candidate is checked and, when rejected, rebuilt at
// halved ε until ε would drop below VERIFY_MIN_EPS.
function verify(file, orderFile) {
  const common = { command: "verify", file: basename(file), order: basename(orderFile) };
  const input = verifyInput(JSON.parse(readFileSync(file, "utf8")));
  if (input.error) {
    return { ...common, status: "invalid-input", error: input.error };
  }
  const order = readOrder(JSON.parse(readFileSync(orderFile, "utf8")), input.FV.length);
  if (order.error) {
    return { ...common, status: "invalid-input", error: order.error };
  }
  const built = validatedArrangement(input);
  const arrangement = {
    eps_i: built.ok ? built.eps_i : null,
    retries: built.retries,
    rejected: built.rejected,
  };
  if (!built.ok) {
    return { ...common, status: "precision-error", arrangement };
  }
  const seeded = seedOrder(input, built, order.triples);
  if (seeded.error) {
    return { ...common, status: "invalid-input", arrangement, error: seeded.error };
  }
  return { ...common, status: "ok", arrangement, verify: seeded };
}

function verifyInput(doc) {
  for (const key of ["vertices_coords", "edges_vertices", "faces_vertices"]) {
    if (!Array.isArray(doc[key]) || doc[key].length === 0) {
      return { error: `verify needs ${key}` };
    }
  }
  const V = doc.vertices_coords.map(([x, y]) => [x, y]);
  const EV = doc.edges_vertices.map(([a, b]) => (a < b ? [a, b] : [b, a]));
  const EA = Array.isArray(doc.edges_assignment)
    ? doc.edges_assignment.slice()
    : EV.map(() => "U");
  const FV = doc.faces_vertices.map((F) => F.slice());
  for (const [f, F] of FV.entries()) {
    // FOLD face orders are relative to each face's normal, which its winding
    // sets; io.js would reverse every face, so refuse rather than guess.
    if (!(M.polygon_area2(M.expand(F, V)) > 0)) {
      return { error: `face ${f} is not counter-clockwise` };
    }
  }
  let EF;
  try {
    [EF] = X.EV_FV_2_EF_FE(EV, FV);
  } catch {
    return { error: "faces_vertices uses an edge that edges_vertices does not list" };
  }
  for (const [e, F] of EF.entries()) {
    if (F.length === 1) {
      EA[e] = "B"; // io.js's boundary rule
    }
  }
  return { V, EV, EA, FV, EF };
}

function readOrder(json, faceCount) {
  const triples = Array.isArray(json) ? json : json?.faceOrders;
  if (!Array.isArray(triples)) {
    return { error: "the order must be an array of [f, g, s] face orders, or an object with faceOrders" };
  }
  for (const triple of triples) {
    const valid =
      Array.isArray(triple) &&
      triple.length === 3 &&
      triple.slice(0, 2).every((f) => Number.isInteger(f) && f >= 0 && f < faceCount) &&
      triple[0] !== triple[1] &&
      (triple[2] === 1 || triple[2] === -1);
    if (!valid) {
      return { error: `bad face order ${JSON.stringify(triple)}` };
    }
  }
  return { triples };
}

function validatedArrangement(input) {
  const [Vf, Ff] = X.V_FV_EV_EA_2_Vf_Ff(input.V, input.FV, input.EV, input.EA);
  const L = input.EV.map((e) => M.expand(e, Vf));
  const measures = arrangementMeasures(input, Vf);
  const d = M.min_line_length(L);
  const attempt = (build) => {
    try {
      const [P, SP, SE] = build();
      return P.length === 0
        ? { bad: "no folded edge graph" }
        : checkArrangement(input, Vf, L, P, SP, SE, measures);
    } catch (error) {
      return { bad: `exception: ${error?.message ?? error}` };
    }
  };
  let eps_i;
  let result = attempt(() => {
    const [P, SP, SE, i] = X.L_2_V_EV_EL(L);
    eps_i = i;
    return [P, SP, SE];
  });
  const rejected = [];
  let retries = 0;
  while (result.bad) {
    rejected.push(`${eps_i ?? "heuristic"}: ${result.bad}`);
    if (eps_i === undefined || d / 2 ** (eps_i + 1) < VERIFY_MIN_EPS) {
      return { ok: false, retries, rejected };
    }
    eps_i += 1;
    retries += 1;
    const eps = d / 2 ** eps_i;
    result = attempt(() => X.L_eps_2_V_EV_EL(L, eps));
  }
  return { ok: true, eps_i, retries, rejected, Ff, ...result };
}

function arrangementMeasures(input, Vf) {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of Vf) {
    [minX, minY, maxX, maxY] = [Math.min(minX, x), Math.min(minY, y), Math.max(maxX, x), Math.max(maxY, y)];
  }
  const faceAreas = input.FV.map((F) => Math.abs(M.polygon_area2(M.expand(F, input.V))) / 2);
  return {
    extent: Math.max(maxX - minX, maxY - minY),
    faceAreas,
    paperArea: faceAreas.reduce((sum, area) => sum + area, 0),
  };
}

// Returns the arrangement and Flat-Folder's constraints on it, or { bad } with
// the first reason it is wrong.
function checkArrangement({ FV, EF }, Vf, L, P, SP, SE, { extent, faceAreas, paperArea }) {
  // No vertex image moved: merging points within a coarse ε can drag one.
  const snap = VERIFY_SNAP * extent;
  const byX = P.slice().sort((a, b) => a[0] - b[0]);
  for (const [v, p] of Vf.entries()) {
    if (!hasPointNear(byX, p, snap)) {
      return { bad: `vertex ${v}'s image moved` };
    }
  }
  // Every edge is covered by its segments: a coarse ε can hand the overlap of
  // two creases to one of them, and ExE_fill_BT, which pairs edges sharing a
  // segment, then never sees the pair.
  const covered = L.map(() => 0);
  for (const [s, [a, b]] of SP.entries()) {
    const length = M.mag(M.sub(P[b], P[a]));
    for (const e of SE[s]) {
      covered[e] += length;
    }
  }
  for (const [e, [p, q]] of L.entries()) {
    const length = M.mag(M.sub(q, p));
    if (Math.abs(covered[e] - length) > VERIFY_MEASURE * extent) {
      return { bad: `edge ${e} is not covered by its segments (${covered[e]} of ${length})` };
    }
  }
  const [, CP] = X.V_EV_2_VV_FV(P, SP);
  const [SC] = X.EV_FV_2_EF_FE(SP, CP);
  const [CF, FC] = X.EF_FV_P_SP_SE_CP_SC_2_CF_FC(EF, FV, P, SP, SE, CP, SC);
  // No cell boundary doubles back, which overlapping collinear segments leave
  // and no area test can see.
  for (const [c, C] of CP.entries()) {
    for (let i = 0; i < C.length; i += 1) {
      const a = P[C[(i + C.length - 1) % C.length]];
      const b = P[C[i]];
      const n = P[C[(i + 1) % C.length]];
      const u = M.sub(b, a);
      const w = M.sub(n, b);
      const cross = u[0] * w[1] - u[1] * w[0];
      if (Math.abs(cross) <= VERIFY_MEASURE * M.mag(u) * M.mag(w) && M.dot(u, w) < 0) {
        return { bad: `cell ${c}'s boundary doubles back` };
      }
    }
  }
  // The cells cover each face once.
  const cellAreas = CP.map((C) => Math.abs(M.polygon_area2(M.expand(C, P))) / 2);
  for (const [f, C] of FC.entries()) {
    const area = C.reduce((sum, c) => sum + cellAreas[c], 0);
    if (C.length === 0 || Math.abs(area - faceAreas[f]) > VERIFY_MEASURE * paperArea) {
      return { bad: `the cells of face ${f} cover ${area}, not its area ${faceAreas[f]}` };
    }
  }
  const BF = X.EF_SP_SE_CP_CF_2_BF(EF, SP, SE, CP, CF);
  const BI = new Map(BF.map((k, i) => [k, i]));
  const BT = X.BF_BI_EF_SE_CF_SC_2_BT(BF, BI, EF, SE, CF, SC);
  const CC = X.FC_BF_BI_BT_2_CC(FC, BF, BI, BT);
  return { CF, FC, BF, BI, BT, CC };
}

function hasPointNear(byX, [x, y], tolerance) {
  let lo = 0;
  let hi = byX.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (byX[mid][0] < x - tolerance) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  for (let i = lo; i < byX.length && byX[i][0] <= x + tolerance; i += 1) {
    if (Math.abs(byX[i][1] - y) <= tolerance) {
      return true;
    }
  }
  return false;
}

// Seeds every variable the order covers, then propagates through Flat-Folder's
// constraints: a complete, valid order assigns everything without a conflict.
function seedOrder({ EA, EF }, { Ff, CF, FC, BF, BI, BT, CC }, triples) {
  const BA = BF.map(() => 0);
  let extra = 0;
  for (const [f, g, s] of triples) {
    const i = BI.get(M.encode_order_pair([f, g]));
    if (i === undefined) {
      extra += 1;
      continue;
    }
    // The inverse of edges_Ff_2_FO: [f, g, Ff[g] ? 1 : -1] puts f over g.
    const fOverG = s === (Ff[g] ? 1 : -1);
    const a = (f < g) === fOverG ? 1 : 2;
    if (BA[i] !== 0 && BA[i] !== a) {
      return { error: `the order puts faces ${f} and ${g} both ways` };
    }
    BA[i] = a;
  }
  let letterDisagreements = 0;
  let lettersWithoutVariable = 0;
  for (const [e, assignment] of EA.entries()) {
    if ((assignment !== "M" && assignment !== "V") || EF[e].length !== 2) {
      continue;
    }
    const k = M.encode_order_pair(EF[e]);
    const i = BI.get(k);
    if (i === undefined) {
      lettersWithoutVariable += 1;
      continue;
    }
    // SOLVER.EF_EA_Ff_BF_BI_2_BA0's rule.
    const [f1] = M.decode(k);
    const o = (!Ff[f1] && assignment === "M") || (Ff[f1] && assignment === "V") ? 2 : 1;
    if (BA[i] !== 0 && BA[i] !== o) {
      letterDisagreements += 1;
    }
  }
  const record = {
    variables: BF.length,
    order_pairs: triples.length,
    missing_pairs: BA.filter((a) => a === 0).length,
    extra_pairs: extra,
    letter_disagreements: letterDisagreements,
    letters_without_variable: lettersWithoutVariable,
  };
  const out = SOLVER.initial_assignment(BA.slice(), BF, BT, BI, FC, CF, CC, { all: 0, reduced: 0 });
  if (out.length === 3 && Array.isArray(out[1])) {
    const [type, faces, conflictFaces] = out;
    return {
      ...record,
      verdict: "conflict",
      conflict: { constraint_type: CON.names[type], faces, conflict_faces: conflictFaces },
    };
  }
  const unassigned = out.filter((a) => a === 0).length;
  return {
    ...record,
    unassigned,
    verdict: letterDisagreements > 0 ? "letter-conflict" : unassigned > 0 ? "incomplete" : "valid",
  };
}

function normalizeRecord(p) {
  return {
    vertices: p.V.length,
    edges: p.EV.length,
    faces: p.FV.length,
    assignments: countValues(p.EA),
    vertex_vertices_hash: hashJson(p.VV),
    edges_vertices_hash: hashJson(p.EV),
    faces_vertices_hash: hashJson(p.FV),
    edges_faces_hash: hashJson(p.EF),
    faces_edges_hash: hashJson(p.FE),
    kawasaki_hash: hashJson(p.VK),
  };
}

function projectRecord(p, includeData = false) {
  const record = {
    folded_vertices_hash: hashJson(p.Vf),
    faces_flip_hash: hashJson(p.Ff),
    faces_up: p.Ff.filter((flip) => !flip).length,
    faces_down: p.Ff.filter((flip) => flip).length,
  };
  if (includeData) {
    record.folded_vertices = p.Vf;
    record.faces_flip = p.Ff;
  }
  return record;
}

function overlapRecord(p, includeData = false) {
  const record = {
    points: p.P.length,
    segments: p.SP.length,
    cells: p.CP.length,
    eps: p.eps_i,
    segments_points_hash: hashJson(p.SP),
    segments_edges_hash: hashJson(p.SE),
    cells_points_hash: hashJson(p.CP),
    segments_cells_hash: hashJson(p.SC),
    cells_faces_hash: hashJson(p.CF),
    faces_cells_hash: hashJson(p.FC),
  };
  if (includeData) {
    record.segments_cells = p.SC;
    record.cells_points = p.CP;
    record.cells_faces = p.CF;
  }
  return record;
}

function constraintsRecord(p) {
  return {
    variables: p.BF.length,
    taco_taco: p.BTn[0],
    taco_tortilla: p.BTn[1],
    tortilla_tortilla: p.BTn[2],
    transitivity: p.trans_count.all / 3,
    reduced_transitivity: p.trans_count.reduced / 3,
    variables_hash: hashJson(p.BF),
    constraints_hash: hashJson(p.BT),
    assignments_hash: hashJson(p.BA),
  };
}

function solveRecord(p) {
  const solutionCounts = p.GA.map((A) => A.length);
  const record = {
    components: p.GB.length,
    component_sizes: p.GB.map((B) => B.length),
    solution_counts: solutionCounts,
    states: solutionCounts.map(BigInt).reduce((a, b) => a * b, 1n).toString(),
    face_orders: p.FO.length,
    face_orders_hash: hashJson(p.FO),
  };
  if (process.env.FLATFOLDER_ORACLE_INCLUDE_DATA === "1") {
    record.face_orders_data = p.FO;
  }
  return record;
}

function countValues(values) {
  const out = {};
  for (const value of values) {
    out[value] = (out[value] ?? 0) + 1;
  }
  return out;
}

function hashJson(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function stableStringify(value) {
  return JSON.stringify(stabilize(value));
}

function stabilize(value) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(stabilize);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = stabilize(value[key]);
    }
    return out;
  }
  return value;
}
