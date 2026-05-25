#!/usr/bin/env node
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const defaults = {
  url: 'http://127.0.0.1:5175/',
  manifest: 'crates/oristudio-cp-detect/tests/fixtures/cp-detect-oracle/manifest.json',
  out: 'artifacts/cp-detect-parity/browser-vs-python-baseline.json',
  vertexTolerance: 0.012,
};

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const manifestPath = resolve(root, options.manifest ?? defaults.manifest);
  const manifestRoot = dirname(manifestPath);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const outPath = resolve(root, options.out ?? defaults.out);
  const url = options.url ?? defaults.url;
  const vertexTolerance = Number(options.vertexTolerance ?? defaults.vertexTolerance);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });

  const results = [];
  try {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.evaluate(() => {
      window.__oriCpDetectBenchmarkResults = [];
      window.addEventListener('ori-studio:cp-detect-result', (event) => {
        window.__oriCpDetectBenchmarkResults.push(event.detail);
      });
    });

    for (const fixture of manifest.fixtures) {
      const imagePath = resolve(manifestRoot, fixture.source_image_path);
      const oracleFold = JSON.parse(await readFile(resolve(manifestRoot, fixture.fold_path), 'utf8'));
      const oracleReport = JSON.parse(await readFile(resolve(manifestRoot, fixture.report_path), 'utf8'));
      const detection = await runBrowserDetection(page, imagePath);
      const predictedFold = JSON.parse(detection.foldJson);
      results.push({
        id: fixture.id,
        profile: fixture.profile,
        image_path: imagePath,
        python: summarizeOracle(oracleFold, oracleReport),
        rust_browser: summarizePrediction(predictedFold, detection.detectorReport),
        metrics: compareFolds(predictedFold, oracleFold, vertexTolerance),
      });
    }
  } finally {
    await browser.close();
  }

  const report = {
    schema: 'oristudio/cp-detect-browser-parity-report/v1',
    generated_at: new Date().toISOString(),
    browser_url: url,
    oracle_manifest: manifestPath,
    vertex_tolerance: vertexTolerance,
    detector_checkpoint_id: manifest.detector_checkpoint_id,
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

async function runBrowserDetection(page, imagePath) {
  const startIndex = await page.evaluate(() => window.__oriCpDetectBenchmarkResults.length);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('ori-studio:detect-cp-image')));
  await page.getByRole('button', { name: /Choose Image/i }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((item) =>
      /Choose Image/.test(item.textContent || '')
    );
    return Boolean(button && !button.disabled);
  });
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Choose Image/i }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles(imagePath);

  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')].find((item) =>
      /^\s*Detect\s*$/.test(item.textContent || '')
    );
    return Boolean(button && !button.disabled);
  }, null, { timeout: 60_000 });
  await page.getByRole('button', { name: /^Detect$/i }).click();
  await page.waitForFunction(
    (index) => window.__oriCpDetectBenchmarkResults.length > index,
    startIndex,
    { timeout: 180_000 }
  );
  const detail = await page.evaluate((index) => window.__oriCpDetectBenchmarkResults[index], startIndex);
  await page.getByTitle('Close').click().catch(() => {});
  return detail.detection;
}

function summarizeOracle(fold, report) {
  return {
    status: report.status,
    vertices: fold.vertices_coords?.length ?? 0,
    edges: fold.edges_vertices?.length ?? 0,
    assignment_counts: assignmentCounts(fold.edges_assignment),
    warning_codes: warningCodes(report.quality_report?.warnings ?? report.warnings?.quality ?? []),
  };
}

function summarizePrediction(fold, report) {
  return {
    status: report.status,
    vertices: fold.vertices_coords?.length ?? 0,
    edges: fold.edges_vertices?.length ?? 0,
    assignment_counts: assignmentCounts(fold.edges_assignment),
    warning_codes: warningCodes(report.warnings ?? []),
  };
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
  const same =
    pointDistance(left.a, right.a) +
    pointDistance(left.b, right.b);
  const swapped =
    pointDistance(left.a, right.b) +
    pointDistance(left.b, right.a);
  return Math.min(same, swapped);
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
  const aggregate = { fixture_count: results.length };
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
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith('--')) {
      throw new Error(`unexpected positional argument: ${arg}`);
    }
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
