#!/usr/bin/env node
import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, extname, join } from 'node:path';
import { IO } from '../../third_party/flat-folder/src/io.js';
import { M } from '../../third_party/flat-folder/src/math.js';
import { X } from '../../third_party/flat-folder/src/conversion.js';
import { CON } from '../../third_party/flat-folder/src/constraints.js';
import { SOLVER } from '../../third_party/flat-folder/src/solver.js';
import { NOTE } from '../../third_party/flat-folder/src/note.js';

NOTE.show = false;
CON.build();

const command = process.argv[2];
const file = process.argv[3];
const args = process.argv.slice(4);

if (!command || !file) {
  usage();
  process.exit(2);
}

try {
  if (command === 'run-corpus') {
    const limit = parseLimit(args);
    const result = runCorpus(file, limit);
    process.stdout.write(`${stableStringify(result)}\n`);
    process.exit(0);
  }
  const doc = readFileSync(file, 'utf8');
  const limit = parseLimit(args);
  const result = run(command, file, doc, limit);
  process.stdout.write(`${stableStringify(result)}\n`);
} catch (error) {
  process.stderr.write(`flat-folder-oracle: ${error?.stack ?? error}\n`);
  process.exit(1);
}

function usage() {
  process.stderr.write(
    'usage: oracle.mjs <normalize|project|overlap|constraints|solve|run-corpus> <file-or-dir> [--limit <n|all>]\n',
  );
}

function parseLimit(args) {
  let limit = 10;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--limit' && i + 1 < args.length) {
      const raw = args[i + 1];
      limit = raw === 'all' ? Infinity : Number(raw);
      i += 1;
    }
  }
  if (!(limit === Infinity || (Number.isInteger(limit) && limit > 0))) {
    throw new Error('limit must be a positive integer or all');
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
    const hash = createHash('sha256').update(bytes).digest('hex');
    if (byHash.has(hash)) {
      duplicates += 1;
      continue;
    }
    byHash.set(hash, { file, doc: bytes.toString('utf8') });
  }
  const statuses = {};
  const cases = [];
  for (const { file, doc } of byHash.values()) {
    const result = run('solve', file, doc, limit);
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
    command: 'run-corpus',
    file: root,
    limit: limit === Infinity ? 'all' : limit,
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
  } else if (stat.isFile() && extname(root).toLowerCase() === '.fold') {
    entries.push(root);
  }
}

function run(command, file, doc, limit) {
  const type = extname(file).slice(1).toLowerCase();
  if (type !== 'fold' && type !== 'cp' && type !== 'svg' && type !== 'opx') {
    throw new Error(`unsupported extension .${type}`);
  }
  const pipeline = buildPipeline(doc, type, true, limit, command);
  const common = {
    file: basename(file),
    command,
    limit: limit === Infinity ? 'all' : limit,
    status: pipeline.status,
  };
  if (pipeline.status !== 'ok') {
    return { ...common, error: pipeline.error };
  }
  switch (command) {
    case 'normalize':
      return { ...common, normalize: normalizeRecord(pipeline) };
    case 'project':
      return {
        ...common,
        normalize: normalizeRecord(pipeline),
        project: projectRecord(pipeline, true),
      };
    case 'overlap':
      return {
        ...common,
        normalize: normalizeRecord(pipeline),
        project: projectRecord(pipeline, true),
        overlap: overlapRecord(pipeline, true),
      };
    case 'constraints':
      return {
        ...common,
        normalize: normalizeRecord(pipeline),
        project: projectRecord(pipeline),
        overlap: overlapRecord(pipeline),
        constraints: constraintsRecord(pipeline),
      };
    case 'solve':
      return {
        ...common,
        normalize: normalizeRecord(pipeline),
        project: projectRecord(pipeline),
        overlap: overlapRecord(pipeline),
        constraints: constraintsRecord(pipeline),
        solve: solveRecord(pipeline),
      };
    default:
      throw new Error(`unknown command ${command}`);
  }
}

function buildPipeline(doc, type, side, limit, command) {
  try {
    const [V, VV, EV, EA, EF, FV, FE] = IO.doc_type_side_2_V_VV_EV_EA_EF_FV_FE(doc, type, side);
    if (V === undefined) {
      return { status: 'invalid-input', error: 'Flat-Folder import returned no vertices' };
    }
    const VK = X.V_VV_EV_EA_2_VK(V, VV, EV, EA);
    if (command === 'normalize') {
      return { status: 'ok', V, VV, EV, EA, EF, FV, FE, VK };
    }
    const [Vf, Ff] = X.V_FV_EV_EA_2_Vf_Ff(V, FV, EV, EA);
    if (command === 'project') {
      return { status: 'ok', V, VV, EV, EA, EF, FV, FE, VK, Vf, Ff };
    }
    const L = EV.map((edge) => M.expand(edge, Vf));
    const [P, SP, SE, eps_i] = X.L_2_V_EV_EL(L);
    if (P.length === 0) {
      return { status: 'precision-failure', error: 'could not find stable folded edge graph' };
    }
    const [, CP] = X.V_EV_2_VV_FV(P, SP);
    const [SC, CS] = X.EV_FV_2_EF_FE(SP, CP);
    const [CF, FC] = X.EF_FV_P_SP_SE_CP_SC_2_CF_FC(EF, FV, P, SP, SE, CP, SC);
    if (command === 'overlap') {
      return {
        status: 'ok',
        V,
        VV,
        EV,
        EA,
        EF,
        FV,
        FE,
        VK,
        Vf,
        Ff,
        P,
        SP,
        SE,
        eps_i,
        CP,
        SC,
        CS,
        CF,
        FC,
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
    for (const [i, d] of [
      [0, 6],
      [1, 2],
      [2, 2],
    ]) {
      BTn[i] /= d;
    }
    const CC = X.FC_BF_BI_BT_2_CC(FC, BF, BI, BT);
    const BA0 = SOLVER.EF_EA_Ff_BF_BI_2_BA0(EF, EA, Ff, BF, BI);
    const trans_count = { all: 0, reduced: 0 };
    const assigned = SOLVER.initial_assignment(BA0, BF, BT, BI, FC, CF, CC, trans_count);
    if (assigned.length === 3 && assigned[0].length === undefined) {
      const [constraintType, faces, conflictFaces] = assigned;
      return {
        status: 'assignment-conflict',
        error: {
          constraint_type: CON.names[constraintType],
          faces,
          conflict_faces: conflictFaces,
        },
      };
    }
    const BA = assigned;
    const GB = SOLVER.get_components(BI, BF, BT, BA, FC, CF, CC, trans_count);
    if (command === 'constraints') {
      return {
        status: 'ok',
        V,
        VV,
        EV,
        EA,
        EF,
        FV,
        FE,
        VK,
        Vf,
        Ff,
        P,
        SP,
        SE,
        eps_i,
        CP,
        SC,
        CS,
        CF,
        FC,
        BF,
        BT,
        BTn,
        CC,
        BA,
        GB,
        trans_count,
      };
    }
    const GA = SOLVER.solve(BI, BF, BT, BA, GB, FC, CF, CC, limit);
    if (GA.length === undefined) {
      return { status: 'unsatisfied-component', error: { component: GA } };
    }
    const edges = X.BF_GB_GA_GI_2_edges(
      BF,
      GB,
      GA,
      GA.map(() => 0),
    );
    const FO = X.edges_Ff_2_FO(edges, Ff);
    return {
      status: 'ok',
      V,
      VV,
      EV,
      EA,
      EF,
      FV,
      FE,
      VK,
      Vf,
      Ff,
      P,
      SP,
      SE,
      eps_i,
      CP,
      SC,
      CS,
      CF,
      FC,
      BF,
      BT,
      BTn,
      CC,
      BA,
      GB,
      GA,
      trans_count,
      FO,
    };
  } catch (error) {
    return { status: 'oracle-error', error: String(error?.message ?? error) };
  }
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
    states: solutionCounts
      .map(BigInt)
      .reduce((a, b) => a * b, 1n)
      .toString(),
    face_orders: p.FO.length,
    face_orders_hash: hashJson(p.FO),
  };
  if (process.env.FLATFOLDER_ORACLE_INCLUDE_DATA === '1') {
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
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function stableStringify(value) {
  return JSON.stringify(stabilize(value));
}

function stabilize(value) {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map(stabilize);
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = stabilize(value[key]);
    }
    return out;
  }
  return value;
}
