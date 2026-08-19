#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const DENSE_HEADS = [
  ['line_logits', 'line_logits_f32_path'],
  ['junction_logits', 'junction_logits_f32_path'],
  ['assignment_logits', 'assignment_logits_f32_path'],
  ['non_crease_logits', 'non_crease_logits_f32_path'],
  ['line_style_logits', 'line_style_logits_f32_path'],
  ['boundary_contact_logits', 'boundary_contact_logits_f32_path'],
];

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifestPath = resolve(root, options.manifest);
  const manifestRoot = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const url = options.url ?? 'http://127.0.0.1:5175/';
  const outPath = resolve(root, options.out);
  const threshold = Number(options.threshold ?? manifest.config?.threshold ?? 0.65);
  const imageSize = Number(options.imageSize ?? manifest.config?.image_size ?? 1024);
  const vertexTolerance = Number(options.vertexTolerance ?? 0.000_001);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  const results = [];
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(async () => {
      const wasm =
        await import('/src/generated/oristudio-cp-detect-wasm/oristudio_cp_detect_wasm.js');
      await wasm.default();
      window.__cpDetectDecodeDenseOutputs = wasm.cp_detect_decode_dense_outputs;
    });

    for (const fixture of manifest.fixtures) {
      const oracleFold = JSON.parse(
        await readFile(resolve(manifestRoot, fixture.fold_path), 'utf8'),
      );
      const oracleReport = JSON.parse(
        await readFile(resolve(manifestRoot, fixture.report_path), 'utf8'),
      );
      const dense = {};
      for (const [head, pathKey] of DENSE_HEADS) {
        dense[head] = viteFsUrl(resolve(manifestRoot, fixture[pathKey]));
      }
      const decoded = await page.evaluate(
        async ({ dense, imageSize, threshold }) => {
          const arrays = {};
          for (const [head, url] of Object.entries(dense)) {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`failed to fetch ${head}: ${response.status}`);
            arrays[head] = new Float32Array(await response.arrayBuffer());
          }
          return window.__cpDetectDecodeDenseOutputs(
            arrays.line_logits,
            arrays.junction_logits,
            arrays.assignment_logits,
            arrays.non_crease_logits,
            arrays.line_style_logits,
            arrays.boundary_contact_logits,
            imageSize,
            threshold,
          );
        },
        { dense, imageSize, threshold },
      );
      const browserFold = JSON.parse(decoded.fold_json);
      results.push({
        id: fixture.id,
        profile: fixture.profile,
        python: summarize(oracleFold, oracleReport.quality_report ?? oracleReport),
        browser_wasm: summarize(browserFold, decoded.report),
        metrics: compareFolds(browserFold, oracleFold, vertexTolerance),
        report_match: reportMatches(decoded.report, oracleReport.quality_report ?? oracleReport),
      });
    }
  } finally {
    await browser.close();
  }

  const report = {
    schema: 'oristudio/cp-detect-browser-decode-oracle/v1',
    generated_at: new Date().toISOString(),
    browser_url: url,
    oracle_manifest: manifestPath,
    image_size: imageSize,
    threshold,
    vertex_tolerance: vertexTolerance,
    results,
    aggregate: aggregateResults(results),
    browser_errors: errors,
  };
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(report.aggregate, null, 2)}\n`);
  process.stdout.write(`wrote ${outPath}\n`);
  if (errors.length > 0) {
    process.stderr.write(`browser errors:\n${errors.join('\n')}\n`);
    process.exitCode = 1;
  }
}

function viteFsUrl(path) {
  return `/@fs${path}`;
}

function summarize(fold, report) {
  return {
    status: report.status,
    vertices: fold.vertices_coords?.length ?? 0,
    edges: fold.edges_vertices?.length ?? 0,
    assignment_counts: assignmentCounts(fold.edges_assignment),
    warning_codes: warningCodes(report.warnings ?? report.quality?.warnings ?? []),
    repair_action_codes: repairActionCodes(report.repair_actions ?? report.repairs ?? []),
  };
}

function reportMatches(left, right) {
  return (
    left.status === right.status &&
    sameStrings(warningCodes(left.warnings ?? []), warningCodes(right.warnings ?? [])) &&
    sameStrings(
      repairActionCodes(left.repair_actions ?? []),
      repairActionCodes(right.repair_actions ?? []),
    )
  );
}

function compareFolds(predicted, oracle, tolerance) {
  const predictedVertices = predicted.vertices_coords ?? [];
  const oracleVertices = oracle.vertices_coords ?? [];
  const vertexMatches = greedyPointMatches(predictedVertices, oracleVertices, tolerance);
  const edgeMetrics = edgeMatchMetrics(predicted, oracle, tolerance, null);
  const borderMetrics = edgeMatchMetrics(predicted, oracle, tolerance, 'B');
  return {
    vertex_precision: precision(vertexMatches.matches, predictedVertices.length),
    vertex_recall: precision(vertexMatches.matches, oracleVertices.length),
    vertex_f1: f1(vertexMatches.matches, predictedVertices.length, oracleVertices.length),
    edge_precision: edgeMetrics.precision,
    edge_recall: edgeMetrics.recall,
    edge_f1: edgeMetrics.f1,
    border_precision: borderMetrics.precision,
    border_recall: borderMetrics.recall,
    border_f1: borderMetrics.f1,
    matched_vertices: vertexMatches.matches,
    matched_edges: edgeMetrics.matches,
    matched_border_edges: borderMetrics.matches,
  };
}

function edgeMatchMetrics(predicted, oracle, tolerance, assignment) {
  const predictedEdges = edgesAsSegments(predicted, assignment);
  const oracleEdges = edgesAsSegments(oracle, assignment);
  const used = new Set();
  let matches = 0;
  for (const edge of predictedEdges) {
    let bestIndex = -1;
    let bestCost = Number.POSITIVE_INFINITY;
    oracleEdges.forEach((candidate, index) => {
      if (used.has(index)) return;
      const cost = segmentCost(edge, candidate);
      if (cost < bestCost) {
        bestCost = cost;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0 && bestCost <= tolerance * 2.0) {
      used.add(bestIndex);
      matches += 1;
    }
  }
  return {
    precision: precision(matches, predictedEdges.length),
    recall: precision(matches, oracleEdges.length),
    f1: f1(matches, predictedEdges.length, oracleEdges.length),
    matches,
  };
}

function edgesAsSegments(fold, assignment) {
  const vertices = fold.vertices_coords ?? [];
  const assignments = fold.edges_assignment ?? [];
  return (fold.edges_vertices ?? [])
    .map(([a, b], index) => ({
      a: vertices[a],
      b: vertices[b],
      assignment: assignments[index] ?? 'U',
    }))
    .filter((edge) => edge.a && edge.b && (!assignment || edge.assignment === assignment));
}

function greedyPointMatches(left, right, tolerance) {
  const used = new Set();
  let matches = 0;
  for (const point of left) {
    let bestIndex = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    right.forEach((candidate, index) => {
      if (used.has(index)) return;
      const value = pointDistance(point, candidate);
      if (value < bestDistance) {
        bestDistance = value;
        bestIndex = index;
      }
    });
    if (bestIndex >= 0 && bestDistance <= tolerance) {
      used.add(bestIndex);
      matches += 1;
    }
  }
  return { matches };
}

function segmentCost(left, right) {
  return Math.min(
    pointDistance(left.a, right.a) + pointDistance(left.b, right.b),
    pointDistance(left.a, right.b) + pointDistance(left.b, right.a),
  );
}

function pointDistance(left, right) {
  const dx = left[0] - right[0];
  const dy = left[1] - right[1];
  return Math.sqrt(dx * dx + dy * dy);
}

function assignmentCounts(assignments = []) {
  return assignments.reduce((acc, assignment) => {
    acc[assignment] = (acc[assignment] ?? 0) + 1;
    return acc;
  }, {});
}

function warningCodes(warnings = []) {
  return warnings.map((warning) => warning.code).sort();
}

function repairActionCodes(actions = []) {
  return actions.map((action) => action.code).sort();
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function aggregateResults(results) {
  const metrics = [
    'vertex_precision',
    'vertex_recall',
    'vertex_f1',
    'edge_precision',
    'edge_recall',
    'edge_f1',
    'border_precision',
    'border_recall',
    'border_f1',
  ];
  const aggregate = {
    fixture_count: results.length,
    report_matches: results.filter((result) => result.report_match).length,
  };
  for (const metric of metrics) {
    aggregate[metric] = mean(results.map((result) => result.metrics[metric]));
  }
  return aggregate;
}

function mean(values) {
  const finite = values.filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : 0;
}

function precision(matches, total) {
  return total > 0 ? matches / total : 1;
}

function f1(matches, predictedTotal, oracleTotal) {
  const p = precision(matches, predictedTotal);
  const r = precision(matches, oracleTotal);
  return p + r > 0 ? (2 * p * r) / (p + r) : 0;
}

function parseArgs(args) {
  const parsed = {
    url: 'http://127.0.0.1:5175/',
    manifest: 'artifacts/cp-detect-parity/python-oracle-replay-20260526/manifest.json',
    out: 'artifacts/cp-detect-parity/browser-decode-oracle.json',
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) throw new Error(`unexpected positional argument: ${arg}`);
    const key = arg.slice(2);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = value;
      index += 1;
    }
  }
  return parsed;
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exit(1);
});
