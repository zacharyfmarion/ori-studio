#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const vendor = JSON.parse(readFileSync(join(here, "vendor.json"), "utf8"));
const sourceRoot = join(repoRoot, vendor.source_root);

const command = process.argv[2];
const args = process.argv.slice(3);

try {
  switch (command) {
    case "version":
      printJson(versionRecord());
      break;
    case "source-map": {
      const entries = sourceMapEntries();
      if (args.includes("--format") && args[args.indexOf("--format") + 1] === "markdown") {
        process.stdout.write(sourceMapMarkdown(entries));
      } else {
        printJson({ vendor: versionRecord(), entries });
      }
      break;
    }
    case "optimizer-solve":
      printJson(await optimizerSolveCommand(args));
      break;
    default:
      usage();
      process.exit(2);
  }
} catch (error) {
  process.stderr.write(`bp-studio-oracle: ${error?.stack ?? error}\n`);
  process.exit(1);
}

function usage() {
  process.stderr.write(
    [
      "usage: oracle.mjs <version|source-map> [--format markdown]",
      "       oracle.mjs optimizer-solve <request.json|-> [--seed <uint>] [--artifact <dist|debug>]",
      "",
    ].join("\n"),
  );
}

async function optimizerSolveCommand(args) {
  const requestPath = positionalArgs(args)[0];
  if (!requestPath) {
    throw new Error("optimizer-solve requires a request JSON path or '-' for stdin");
  }
  const seed = parseUintOption(args, "--seed", 0);
  const artifact = stringOption(args, "--artifact", "dist");
  if (artifact !== "dist" && artifact !== "debug") {
    throw new Error(`unsupported optimizer artifact '${artifact}'`);
  }
  const requestText = requestPath === "-"
    ? readFileSync(0, "utf8")
    : readFileSync(requestPath, "utf8");
  const request = JSON.parse(requestText);
  const { instance, events, logs } = await loadOptimizerArtifact(artifact);
  const data = makeOptimizerData(request);
  const response = await instance.solve(data, seed);
  const vector = Array.from({ length: response.size() }, (_, index) => response.get(index));
  response.delete();
  const result = optimizerResultFromVector(request, vector);
  return {
    artifact,
    seed,
    data,
    vector,
    result,
    events,
    logs,
  };
}

function positionalArgs(args) {
  const result = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--seed" || arg === "--artifact" || arg === "--format") {
      index++;
    } else if (!arg.startsWith("--")) {
      result.push(arg);
    }
  }
  return result;
}

async function loadOptimizerArtifact(artifact) {
  const dir = join(sourceRoot, "lib/optimizer", artifact);
  const jsPath = join(dir, "optimizer.js");
  const wasmPath = join(dir, "optimizer.wasm");
  const previousWorkerScope = globalThis.WorkerGlobalScope;
  const previousSelf = globalThis.self;
  globalThis.WorkerGlobalScope ??= class WorkerGlobalScope {};
  globalThis.self ??= { location: { href: pathToFileURL(jsPath).href } };
  globalThis.self.location ??= { href: pathToFileURL(jsPath).href };
  globalThis.self.location.href ??= pathToFileURL(jsPath).href;
  const events = [];
  const logs = [];
  try {
    const module = await import(pathToFileURL(jsPath).href);
    const instance = await module.default({
      wasmBinary: readFileSync(wasmPath),
      print: (message) => collectOptimizerMessage(message, events, logs),
      printErr: (message) => {
        throw new Error(String(message));
      },
      checkInterruptAsync: async () => false,
      checkInterrupt: () => 0,
    });
    instance.init();
    return { instance, events, logs };
  } finally {
    if (previousWorkerScope === undefined) {
      delete globalThis.WorkerGlobalScope;
    } else {
      globalThis.WorkerGlobalScope = previousWorkerScope;
    }
    if (previousSelf === undefined) {
      delete globalThis.self;
    } else {
      globalThis.self = previousSelf;
    }
  }
}

function collectOptimizerMessage(message, events, logs) {
  const text = String(message);
  if (text.startsWith("{")) {
    events.push(JSON.parse(text));
  } else {
    logs.push(text);
  }
}

function makeOptimizerData(request) {
  const problem = request.problem;
  const useView = request.layout === "view";
  const data = {
    type: problem.type === "rect" ? 1 : 2,
    hierarchies: problem.hierarchies,
    flaps: problem.flaps,
    useView,
  };
  if (useView) {
    data.vec = request.vec;
    data.useBH = request.useBH;
  } else {
    data.random = request.random;
  }
  return data;
}

function optimizerResultFromVector(request, vector) {
  if (vector.length === 0) return null;
  const grid = vector[vector.length - 1];
  return {
    width: grid,
    height: grid,
    flaps: request.problem.flaps.map((flap, index) => ({
      id: flap.id,
      x: vector[2 * index],
      y: vector[2 * index + 1],
    })),
  };
}

function parseUintOption(args, name, fallback) {
  const raw = stringOption(args, name, undefined);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 4294967295) {
    throw new Error(`${name} must be an unsigned 32-bit integer`);
  }
  return value;
}

function stringOption(args, name, fallback) {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function versionRecord() {
  const pkg = JSON.parse(readFileSync(join(sourceRoot, "package.json"), "utf8"));
  const optimizerArtifacts = [
    "lib/optimizer/debug/optimizer.js",
    "lib/optimizer/debug/optimizer.wasm",
    "lib/optimizer/dist/optimizer.js",
    "lib/optimizer/dist/optimizer.wasm",
    "lib/optimizer/dist_mp/optimizer.js",
    "lib/optimizer/dist_mp/optimizer.wasm",
    "lib/include/libnlopt.slsqp.2.9.1.a",
    "lib/include/libnlopt.slsqp.2.9.1-mp.a",
    "lib/include/libsimpleomp.a",
  ].map((path) => {
    const abs = join(sourceRoot, path);
    return {
      path,
      present: statExists(abs),
      sha256: statExists(abs) ? sha256(abs) : null,
    };
  });

  return {
    repository: vendor.repository,
    commit: vendor.commit,
    version: pkg.version,
    app_version: pkg.app_version,
    commit_date: vendor.commit_date,
    license: pkg.license,
    source_root: vendor.source_root,
    source_files: scanFiles(sourceRoot).length,
    src_files: scanFiles(join(sourceRoot, "src")).length,
    test_files: scanFiles(join(sourceRoot, "test")).length,
    optimizer_artifacts: optimizerArtifacts,
  };
}

function sourceMapEntries() {
  return scanFiles(sourceRoot)
    .filter((path) => shouldMap(path))
    .map((path) => {
      const rel = relative(sourceRoot, path);
      const mapped = classify(rel);
      return {
        upstream: rel,
        area: mapped.area,
        rust_target: mapped.target,
        status: mapped.status,
        notes: mapped.notes,
      };
    });
}

function shouldMap(path) {
  const rel = relative(sourceRoot, path);
  return (
    rel.startsWith("src/") ||
    rel.startsWith("test/") ||
    rel.startsWith("tools/") ||
    rel === "package.json" ||
    rel === "pnpm-lock.yaml" ||
    rel === "makefile" ||
    rel === "LICENSE.md" ||
    rel.startsWith("lib/optimizer/") ||
    rel.startsWith("lib/include/")
  );
}

function classify(path) {
  if (path === "package.json" || path === "pnpm-lock.yaml" || path === "LICENSE.md") {
    return map("upstream metadata", "tools/bp-studio-oracle", "Oracle-tested");
  }
  if (path === "makefile" || path.startsWith("lib/optimizer/") || path.startsWith("lib/include/")) {
    return map("optimizer oracle artifact", "optimizer::oracle", "Unsupported", "Oracle input only; Rust implementation must not depend on opaque artifacts.");
  }
  if (path.startsWith("test/")) {
    return map("upstream test fixture/spec", "tools/bp-studio-oracle, Rust tests", "Unsupported");
  }
  if (path.startsWith("tools/")) {
    return map("upstream development tool", "tools/bp-studio-oracle", "Out-of-scope-ui");
  }
  if (path.startsWith("src/shared/json/")) {
    return map("project JSON DTO", "model, io::bps", "Unit-tested");
  }
  if (
    path === "src/shared/data/bst/avlTree.ts" ||
    path === "src/shared/data/bst/binarySearchTree.ts" ||
    path === "src/shared/data/bst/parentedTree.ts" ||
    path === "src/shared/data/bst/ravlTree.ts" ||
    path === "src/shared/data/bst/redBlackTree.ts"
  ) {
    return map("shared binary-search tree", "data::bst", "Unit-tested");
  }
  if (path.startsWith("src/shared/data/bst/")) {
    return map("shared binary-search tree", "data::bst", "Unsupported");
  }
  if (path.startsWith("src/shared/data/heap/")) {
    return map("shared heap structure", "data::heap", "Unit-tested");
  }
  if (path.startsWith("src/shared/data/doubleMap/")) {
    return map("shared symmetric double-key map", "data::double_map", "Unit-tested");
  }
  if (path.startsWith("src/shared/data/diff/")) {
    return map("shared diff set", "data::diff", "Unit-tested");
  }
  if (path.startsWith("src/shared/data/unionFind/")) {
    return map("shared union-find", "data::union_find", "Unit-tested");
  }
  if (path.startsWith("src/shared/data/base/doubleLink.ts")) {
    return map("shared linked-list helper", "data::double_map internals", "Unit-tested");
  }
  if (path.startsWith("src/shared/data/")) {
    return map("shared data structure", "data", "Unsupported");
  }
  if (path === "src/shared/types/cp.ts") {
    return map("shared CP line type", "sweep::{CreaseType,CpLine}", "Unit-tested");
  }
  if (path === "src/shared/types/constants.ts") {
    return map("shared hard-limit constants", "shared::constants", "Unit-tested");
  }
  if (path === "src/shared/types/direction.ts") {
    return map("shared direction and quadrant encodings", "shared::direction", "Unit-tested");
  }
  if (path === "src/shared/types/geometry.ts") {
    return map("shared geometry type aliases", "math::geometry, sweep::rr_intersection", "Unit-tested", "Rust exposes concrete point/path/arc-path structs instead of TS structural aliases.");
  }
  if (path.startsWith("src/shared/types/")) {
    return map("TypeScript type-only declaration", "Rust static types", "Documented-difference", "Compile-time TS declaration surface is represented by Rust types where behavior needs it.");
  }
  if (path.startsWith("src/shared/utils/")) {
    if (
      path === "src/shared/utils/array.ts" ||
      path === "src/shared/utils/color.ts" ||
      path === "src/shared/utils/map.ts" ||
      path === "src/shared/utils/pattern.ts" ||
      path === "src/shared/utils/set.ts"
    ) {
      return map("shared utility", "shared", "Unit-tested");
    }
    if (path === "src/shared/utils/clone.ts" || path === "src/shared/utils/copy.ts") {
      return map("shared structural clone/copy helper", "Rust Clone/serde ownership", "Documented-difference", "Rust uses typed Clone and serde-owned values instead of JS runtime object graph copying.");
    }
    return map("shared utility", "shared", "Unsupported");
  }
  if (path.startsWith("src/shared/polyfill/") || path.startsWith("src/shared/frontend/")) {
    return map("browser/polyfill support", "oristudio-bp-wasm or app integration", "Out-of-scope-ui");
  }
  if (path === "src/core/math/sweepLine/classes/chainer/chainer.ts") {
    return map("sweep-line path chainer", "sweep::{aa_union,general_union}", "Unit-tested", "Covered through AAUnion exact path reconstruction and GeneralUnion epsilon path reconstruction.");
  }
  if (path === "src/core/math/sweepLine/classes/chainer/unionChainer.ts") {
    return map("sweep-line source-tracking chainer", "sweep::rough_union", "Unit-tested", "Covered through RoughUnion source mapping.");
  }
  if (path === "src/core/math/sweepLine/classes/chainer/arcChainer.ts") {
    return map("sweep-line arc path chainer", "sweep::rr_intersection", "Unit-tested", "Covered through RRIntersection arc-path reconstruction.");
  }
  if (path === "src/core/math/sweepLine/classes/segment/aaLineSegment.ts") {
    return map("axis-aligned sweep segment", "sweep::{aa_union,rr_intersection}", "Unit-tested");
  }
  if (path === "src/core/math/sweepLine/classes/segment/lineSegment.ts") {
    return map("general sweep segment", "sweep::{clip,overlap,general_union}", "Unit-tested", "Covered through clipping, overlap, and GeneralUnion subdivision tests.");
  }
  if (path === "src/core/math/sweepLine/classes/segment/arcSegment.ts") {
    return map("arc sweep segment", "sweep::rr_intersection", "Unit-tested", "Covered through RRIntersection intersection and trisection tests.");
  }
  if (isSweepScaffolding(path)) {
    return map("sweep-line shared scaffolding", "sweep concrete operation modules", "Documented-difference", "Rust ports the shared TS class hierarchy into concrete sweep modules; Stacking, Clip, Overlap, AAUnion, RoughUnion, GeneralUnion, and RRIntersection are unit-tested.");
  }
  if (path === "src/core/math/sweepLine/stacking/stacking.ts") {
    return map("sweep-line stacking", "sweep::stacking", "Unit-tested", "General sweep subset for non-intersecting path stacking is ported; clip/polybool/intersectors remain unsupported.");
  }
  if (path === "src/core/math/sweepLine/clip/clip.ts") {
    return map("CP clipping and subdivision", "sweep::clip", "Unit-tested", "Manual oracle confirmed upstream spec counts and duplicate-line behavior.");
  }
  if (path === "src/core/math/sweepLine/clip/overlap.ts" || path === "src/core/math/sweepLine/clip/overlapIntersector.ts") {
    return map("sweep-line overlap detection", "sweep::overlap", "Unit-tested", "Preserves BP Studio's false result for full containment.");
  }
  if (path === "src/core/math/sweepLine/polyBool/aaUnion/roughUnion.ts") {
    return map("rough contour union", "sweep::rough_union", "Unit-tested", "Upstream RoughUnion spec cases ported.");
  }
  if (path.startsWith("src/core/math/sweepLine/polyBool/aaUnion/") && path !== "src/core/math/sweepLine/polyBool/aaUnion/roughUnion.ts") {
    return map("axis-aligned polygon union", "sweep::aa_union", "Unit-tested", "Full upstream AAUnion spec cases ported.");
  }
  if (path.startsWith("src/core/math/sweepLine/polyBool/generalUnion/")) {
    return map("general polygon union", "sweep::general_union", "Unit-tested", "Upstream GeneralUnion spec cases ported, including floating-error regressions.");
  }
  if (path.startsWith("src/core/math/sweepLine/polyBool/rrIntersection/")) {
    return map("rounded-rectangle intersection", "sweep::rr_intersection", "Unit-tested", "Upstream RRIntersection spec cases ported, including arc trisection and epsilon regressions.");
  }
  if (path.startsWith("src/core/math/sweepLine/")) {
    return map("sweep-line geometry", "sweep", "Unsupported");
  }
  if (
    path === "src/core/math/geometry/float.ts" ||
    path === "src/core/math/geometry/couple.ts" ||
    path === "src/core/math/geometry/point.ts" ||
    path === "src/core/math/geometry/vector.ts" ||
    path === "src/core/math/geometry/matrix.ts" ||
    path === "src/core/math/geometry/line.ts" ||
    path === "src/core/math/geometry/rectangle.ts" ||
    path === "src/core/math/geometry/path.ts" ||
    path === "src/core/math/geometry/rationalPath.ts" ||
    path === "src/core/math/geometry/pointInPolygon.ts" ||
    path === "src/core/math/geometry/winding.ts"
  ) {
    return map("exact geometry primitive", "math::geometry", "Unit-tested");
  }
  if (path === "src/core/math/fraction.ts") {
    return map("number-backed rational arithmetic", "math::rational", "Unit-tested");
  }
  if (path === "src/core/math/utils/gcd.ts") {
    return map("integer gcd/lcm helpers", "math::gcd", "Unit-tested");
  }
  if (path === "src/core/math/gops.ts") {
    return map("integral GOPS generator", "math::gops", "Unit-tested");
  }
  if (path === "src/core/math/kamiya.ts") {
    return map("half-integral Kamiya generator", "math::kamiya", "Unit-tested");
  }
  if (path === "src/core/math/invalidParameterError.ts") {
    return map("fraction invalid-parameter error", "math::rational, BpError::InvalidInput", "Unit-tested", "Rust represents the thrown JS error as a typed Result error.");
  }
  if (path.startsWith("src/core/math/")) {
    return map("math/geometry primitive", "math", "Unsupported");
  }
  if (path.startsWith("src/core/design/context/")) {
    if (
      path === "src/core/design/context/areaTree/areaNode.ts" ||
      path === "src/core/design/context/areaTree/areaTree.ts" ||
      path === "src/core/design/context/areaTree/utils.ts"
    ) {
      return map("optimizer hierarchy area tree", "tree::AreaTree", "Unit-tested", "Translated upstream AreaTree specs cover simplification, area balancing, and hierarchy expansion.");
    }
    if (
      path === "src/core/design/context/aabb/aabb.ts" ||
      path === "src/core/design/context/aabb/aabbSide.ts"
    ) {
      return map("tree AABB propagation", "tree::Aabb", "Unit-tested", "Covered through translated upstream tree AABB specs.");
    }
    if (
      path === "src/core/design/context/tree.ts" ||
      path === "src/core/design/context/treeNode.ts" ||
      path === "src/core/design/context/treeUtils.ts"
    ) {
      return map("tree context model", "tree::BpTree", "Unit-tested", "Covers construction, root balancing, editing, BFS JSON, distance records, and distance maps.");
    }
    if (path === "src/core/design/context/index.d.ts") {
      return map("tree/context TypeScript declarations", "Rust tree/model/static types", "Documented-difference", "Rust exposes concrete structs instead of TS declaration interfaces.");
    }
    return map("tree/context model", "tree, optimizer::hierarchy", "Unsupported");
  }
  if (
    path === "src/core/design/tasks/height.ts" ||
    path === "src/core/design/tasks/balance.ts" ||
    path === "src/core/design/tasks/structure.ts" ||
    path === "src/core/design/tasks/aabb.ts"
  ) {
    return map("tree maintenance task", "tree::BpTree::recompute", "Unit-tested", "Task behavior is embedded in BpTree recompute for the headless kernel; generic processor scheduling is ported separately.");
  }
  if (path === "src/core/design/tasks/invalidJunction.ts") {
    return map("invalid junction update task", "layout::InvalidJunction plus engine task TODO", "Porting", "Invalid junction polygon calculation is ported; State diff/update-result task wiring remains unsupported until layout task integration.");
  }
  if (path === "src/core/design/tasks/stretch.ts") {
    return map("stretch grouping task", "layout::{group_junctions, uncovered_junction_indices, LayoutStretch}", "Porting", "Quadrant union grouping, uncovered-junction filtering, geometric covering checks, and stretch cache/update shell are ported; State diff/update-result integration and pattern task scheduling remain unsupported.");
  }
  if (path.startsWith("src/core/design/tasks/")) {
    return map("engine task", "engine::tasks, layout", "Unsupported");
  }
  if (path.startsWith("src/core/design/layout/")) {
    if (path === "src/core/design/layout/store.ts") {
      return map("lazy search store", "layout::Store", "Unit-tested", "Rust preserves lazy next/rest progression, done state, and cached entries.");
    }
    if (path === "src/core/design/layout/junction/validJunction.ts") {
      return map("valid junction model", "layout::ValidJunction", "Unit-tested", "Covers oriented JSON/signature shape, covering/practical-covering semantics, involvement, closer-than comparison, and base rectangle construction.");
    }
    if (path === "src/core/design/layout/junction/junction.ts" || path === "src/core/design/layout/junction/invalidJunction.ts") {
      return map("junction creation and invalid overlap model", "layout::{create_junction, InvalidJunction}", "Unit-tested", "Covers valid-vs-invalid branch selection, canonical id ordering, invalid rounded-rectangle polygon calculation, and processed-state update.");
    }
    if (path === "src/core/design/layout/nodeSet.ts") {
      return map("layout node set", "layout::NodeSet", "Unit-tested", "Covers leaf collection, quadrant coverage, LCA caching, distance triples, and length-change comparison over BpTree.");
    }
    if (path === "src/core/design/layout/repository.ts") {
      return map("repository search state", "layout::LayoutRepository", "Porting", "Signature/origin/factor capture, oriented junction JSON, quadrant grouping, directional ordering, opposite-map creation, NodeSet validity checks, serialized repo preservation, and unsupported config-search boundary are ported; generated configuration stores and joiner cache remain unsupported.");
    }
    if (path === "src/core/design/layout/stretch.ts") {
      return map("stretch lifecycle shell", "layout::LayoutStretch", "Porting", "Construction, same-signature NodeSet refresh, origin updates, drag-time repository caching/reuse, cleanup, JSON shell, and unsupported completion boundary are ported; pattern completion remains unsupported.");
    }
    if (path === "src/core/design/layout/configuration.ts") {
      return map("configuration data shell", "layout::LayoutConfiguration", "Porting", "Raw-partition cleanup, flat overlap map, signature/session serialization, and unsupported pattern-generation boundary are ported; pattern stores, free corners, and side diagonals remain unsupported.");
    }
    if (path === "src/core/design/layout/partition.ts") {
      return map("partition data shell", "layout::LayoutPartition", "Porting", "Corner maps, constraint/external filters, flap lookup, exposed-overlap trimming, and resolve-division behavior are ported; displacement solving, external target wiring, and pattern devices remain unsupported.");
    }
    if (path === "src/core/design/layout/generators/configGeneratorContext.ts") {
      return map("configuration generator context", "layout::generators::ConfigGeneratorContext", "Unit-tested", "Temporary overlap id allocation, junction-to-overlap conversion, x/y cuts, raw single-mode make, cleanup make, and explicit config-search unsupported boundary are ported with direct Rust tests.");
    }
    if (path === "src/core/design/layout/generators/searchUtils/relay.ts") {
      return map("relay search utility", "layout::generators::search_relay", "Unit-tested", "Oriented/non-oriented x/y relay partition rewrites, split filtering, strategy-order variants, intersection/socket/internal corner rewrites, and relay shifts are ported with direct Rust tests.");
    }
    if (path === "src/core/design/layout/generators/searchUtils/splitJoin.ts") {
      return map("split-join search helpers", "layout::generators::{to_split_items, get_exposed_part}", "Unit-tested", "Cover checks, raw split-item extraction, horizontal split detection, exposed remaining-part shrinkage, intersection replacement, and BP's join-partition mutation side effect are ported with direct Rust tests.");
    }
    if (path === "src/core/design/layout/generators/deviceGenerator.ts") {
      return map("single-overlap device generator", "layout::generators::device_generator", "Porting", "Single-overlap GOPS, Kamiya half-integral plus BP's fallthrough to GOPS, universal GPS scaling/reverse/slack, DTO conversion, and explicit join/general unsupported boundaries are ported with direct Rust tests.");
    }
    if (path === "src/core/design/layout/pattern/quadrant.ts") {
      return map("quadrant geometry", "layout::Quadrant", "Porting", "Factor/weight ordering, start/end points, corner lookup, containment validity checks, and shared helpers are ported; overlap-corner targeting and trace-specific helpers remain for later pattern/trace stages.");
    }
    if (path === "src/core/design/layout/pattern/region.ts") {
      return map("pattern region axis parallels", "layout::pattern::axis_parallels", "Unit-tested", "Axis-parallel crease generation over exact region contours is ported with direct Rust tests; BP's TODO about improving intersection handling remains preserved.");
    }
    if (path === "src/core/design/layout/pattern/piece.ts") {
      return map("pattern piece geometry", "layout::pattern::PatternPiece", "Unit-tested", "SCR dimensions, offset handling, detour substitution including corner-start behavior, anchors, direction, contour, reverse, shrink, and detour mutation are ported with direct Rust tests.");
    }
    if (path === "src/core/design/layout/pattern/addOn.ts") {
      return map("pattern add-on region", "layout::pattern::PatternAddOn", "Unit-tested", "Add-on contour/ridge conversion, reduced direction, and axis-parallel region behavior are ported with direct Rust tests.");
    }
    if (path === "src/core/design/layout/pattern/gadget.ts") {
      return map("pattern gadget geometry", "layout::pattern::PatternGadget", "Porting", "Piece wrapping, sparse anchors, spans, slacks, contour joining, reverse GPS, ray intersection, signature simplification, and connection-slack shell are ported; connection-slack needs joiner/device integration coverage.");
    }
    if (path === "src/core/design/layout/pattern/device.ts") {
      return map("pattern device shell", "layout::pattern::PatternDevice", "Porting", "Device construction, JSON offset/add-on behavior, local region collection, local contours, local axis-parallels, local inner ridges, and signature simplification are ported; positioned anchors, draw/trace ridges, dragging ranges, connection ridges, and neighbor cache remain unsupported.");
    }
    if (path === "src/core/design/layout/pattern/pattern.ts") {
      return map("seeded pattern shell", "layout::pattern::LayoutPattern", "Porting", "Seeded pattern construction, flattened gadget access, JSON serialization, and origin-dirty shell are ported; unseeded positioning, connection targets, moved-device state, and positioner dispatch remain unsupported.");
    }
    return map("layout/pattern algorithm", "layout", "Unsupported", upstreamGapNote(path));
  }
  if (path === "src/core/service/updateModel.d.ts" || path === "src/core/service/updateResult.ts") {
    return map("update payload and accumulator", "engine::update", "Unit-tested", "Rust preserves the empty UpdateModel JSON shape, ordered record assignment semantics, tree export payloads, and flush reset behavior.");
  }
  if (path === "src/core/service/processor.ts") {
    return map("priority task scheduler", "engine::processor", "Unit-tested", "Rust preserves BP Studio's dependant-task priority calculation, heap-set de-duplication by task identity, and state reset after successful runs.");
  }
  if (path === "src/core/service/state.ts") {
    return map("engine state containers", "engine::state", "Unit-tested", "Persistent/semi-persistent/temporary container reset semantics are ported; layout-specific payload algorithms remain in later stages.");
  }
  if (path === "src/core/controller/treeController.ts") {
    return map("tree controller API", "engine::BpSession tree commands", "Unit-tested", "Tree edit, leaf add/remove, join/split/merge, child-id lookup, and hierarchy request surfaces are ported with Rust command-trace tests.");
  }
  if (path === "src/core/controller/designController.ts") {
    return map("design controller API", "engine::BpSession design init/update", "Porting", "Tree-bearing init/update surface is ported; downstream junction/stretch/pattern/graphics tasks remain unsupported until layout stages.");
  }
  if (path.startsWith("src/core/controller/") || path.startsWith("src/core/service/") || path.startsWith("src/core/routes/") || path === "src/core/main.ts") {
    return map("headless core worker API", "engine", "Unsupported");
  }
  if (path.startsWith("src/client/patches/")) {
    return map("project migration/check", "io::migrations", "Unit-tested");
  }
  if (path.startsWith("src/client/plugins/cp/")) {
    return map("CP/FOLD export plugin", "io::cp, io::fold_export", "Unsupported");
  }
  if (path.startsWith("src/client/plugins/treeMaker/")) {
    return map("TreeMaker v5 import plugin", "io::treemaker_import", "Unsupported");
  }
  if (path.startsWith("src/client/plugins/optimizer/")) {
    return map("optimizer plugin/source", "optimizer", "Unsupported");
  }
  if (path.startsWith("src/client/project/changes/commands/") || path === "src/client/project/changes/step.ts") {
    return map("history command/step semantics", "engine::history", "Unit-tested", "Command JSON, signatures, coalescing, memento cancellation, step serialization, and partial-result truncation are covered in Rust tests.");
  }
  if (path === "src/client/project/changes/history.ts") {
    return map("history manager", "engine::history::HistoryManager", "Porting", "Queue/flush/max-depth/save-index/navigation truncation semantics are ported; project-object mutation and UI selection restoration still need session/frontend wiring.");
  }
  if (path.startsWith("src/client/project/changes/")) {
    return map("history/command model", "model::history, engine::commands", "Unsupported");
  }
  if (path.startsWith("src/client/project/components/grid/")) {
    return map("grid/sheet constraints", "grid", "Unit-tested", "Pure rectangular/diagonal constraints, dimensions, transforms, border/grid payloads, and resize shift decisions are covered in Rust tests; Vue/Pixi drawing is out of scope.");
  }
  if (path === "src/client/project/components/sheet.ts") {
    return map("sheet grid transform helpers", "grid", "Porting", "Subdivide/rotate/flip matrices, relative-point scaling, and image dimension math are ported; viewport, Pixi layers, selection, and draw lifecycle are out of scope for this headless stage.");
  }
  if (path.startsWith("src/client/project/components/tree/")) {
    return map("tree component data contract", "tree, engine::commands", "Unsupported");
  }
  if (path.startsWith("src/client/project/components/layout/")) {
    return map("layout component data contract", "layout, engine::commands", "Unsupported");
  }
  if (path.startsWith("src/client/project/")) {
    return map("project/session data contract", "engine, model", "Unsupported");
  }
  if (path.startsWith("src/app/services/importService.ts") || path.startsWith("src/app/services/exportService.ts")) {
    return map("file import/export service", "io", "Unit-tested");
  }
  if (path.startsWith("src/app/") || path.startsWith("src/client/screen/") || path.startsWith("src/client/controllers/") || path.startsWith("src/locale/") || path.startsWith("src/public/") || path.startsWith("src/other/") || path.startsWith("src/log/")) {
    return map("presentation/UI/PWA asset", "app integration later", "Out-of-scope-ui");
  }
  if (path.startsWith("src/client/svg/") || path.startsWith("src/client/utils/") || path.startsWith("src/client/shared/") || path.startsWith("src/client/base/") || path.startsWith("src/client/services/") || path === "src/client/main.ts" || path === "src/client/options.ts") {
    return map("frontend support/data contract", "app integration later", "Out-of-scope-ui");
  }
  return map("unclassified upstream file", "source-map review", "Unsupported");
}

function upstreamGapNote(path) {
  if (
    path.endsWith("generalConfigGeneratorContext.ts") ||
    path.endsWith("deviceGenerator.ts") ||
    path.endsWith("singleJunctionPositioner.ts") ||
    path.endsWith("twoJunctionPositioner.ts")
  ) {
    return "Contains upstream TODO paths that must remain Upstream-gap until directly supported upstream or explicitly scoped.";
  }
  return "";
}

function isSweepScaffolding(path) {
  return (
    path === "src/core/math/sweepLine/classes/endProcessor.ts" ||
    path.startsWith("src/core/math/sweepLine/classes/event/") ||
    path === "src/core/math/sweepLine/classes/eventProvider.ts" ||
    path === "src/core/math/sweepLine/classes/intersector.ts" ||
    path === "src/core/math/sweepLine/classes/orientation.ts" ||
    path === "src/core/math/sweepLine/classes/segment/segment.ts" ||
    path === "src/core/math/sweepLine/divideAndCollect.ts" ||
    path === "src/core/math/sweepLine/sweepLine.ts" ||
    path === "src/core/math/sweepLine/polyBool/index.ts" ||
    path === "src/core/math/sweepLine/polyBool/initializer.ts" ||
    path === "src/core/math/sweepLine/polyBool/polyBool.ts" ||
    path === "src/core/math/sweepLine/polyBool/unionBase.ts"
  );
}

function map(area, target, status, notes = "") {
  return { area, target, status, notes };
}

function sourceMapMarkdown(entries) {
  const lines = [
    "# Box Pleating Studio Source Map",
    "",
    "Generated from the vendored Box Pleating Studio snapshot.",
    "",
    `- Repository: \`${vendor.repository}\``,
    `- Commit: \`${vendor.commit}\``,
    `- Version: \`${vendor.version}\`, app version \`${vendor.app_version}\``,
    `- Source root: \`${vendor.source_root}\``,
    "",
    "| Upstream path | Area | Rust target | Status | Notes |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const entry of entries) {
    lines.push(
      `| \`${escapeCell(entry.upstream)}\` | ${escapeCell(entry.area)} | \`${escapeCell(entry.rust_target)}\` | ${escapeCell(entry.status)} | ${escapeCell(entry.notes)} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}`;
}

function escapeCell(value) {
  return String(value ?? "").replaceAll("|", "\\|");
}

function scanFiles(root) {
  if (!statExists(root)) {
    return [];
  }
  const result = [];
  scan(root, result);
  result.sort((a, b) => relative(sourceRoot, a).localeCompare(relative(sourceRoot, b)));
  return result;
}

function scan(root, result) {
  const stat = statSync(root);
  if (stat.isDirectory()) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "build") {
        continue;
      }
      scan(join(root, entry.name), result);
    }
    return;
  }
  if (stat.isFile()) {
    result.push(root);
  }
}

function statExists(path) {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}
