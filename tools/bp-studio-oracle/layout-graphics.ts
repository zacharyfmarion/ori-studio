/**
 * BP Studio layout-graphics oracle.
 *
 * Runs Box Pleating Studio's headless Core (no DOM/Pixi) to produce the
 * ground-truth layout graphics — per-flap contours + ridges — for a design and
 * an optional sequence of manual edits. This is the oracle our Rust engine's
 * `project_graphics_snapshot` / `move_flap` output must match; see the
 * oracle-parity tests in crates/oristudio-bp/tests/{manual_flap_move,starter_seed}.rs.
 *
 * Usage (Bun, so the vendored TypeScript Core resolves via ./tsconfig.json):
 *
 *   bun tools/bp-studio-oracle/layout-graphics.ts <design.json> [edits.json]
 *
 * <design.json>  A JDesign: { tree: {sheet, nodes, edges}, layout: {sheet, flaps, stretches} }.
 *                (sheet.type is 0 = rectangular, 1 = diagonal.)
 * [edits.json]   Optional array of edits applied in order, each:
 *                  { "op": "moveFlap", "id": <NodeId>, "x": <int>, "y": <int> }
 *
 * Prints canonical JSON: { flaps: [...], graphics: { <tag>: {contours, ridges} } }
 * with object keys sorted, so it diffs cleanly against the Rust snapshot.
 */
// Silence BP Studio's DEBUG timing logs (console.time/timeEnd) so stdout is
// clean JSON. Bun does not strip the vendored `/// #if DEBUG` guards.
console.time = () => {};
console.timeEnd = () => {};

import { DesignController } from "core/controller/designController";
import { UpdateResult } from "core/service/updateResult";
import { readFileSync } from "node:fs";

interface JFlap { id: number; x: number; y: number; width: number; height: number }
interface MoveFlapEdit { op: "moveFlap"; id: number; x: number; y: number }
type Edit = MoveFlapEdit;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

function main(): void {
  const [designPath, editsPath] = process.argv.slice(2);
  if (!designPath) {
    console.error("usage: bun layout-graphics.ts <design.json> [edits.json]");
    process.exit(2);
  }
  const design = JSON.parse(readFileSync(designPath, "utf8"));
  const stretches = design.layout.stretches ?? [];
  // Track the current flap set so each edit sends the full array (as the app does).
  const flaps: JFlap[] = (design.layout.flaps ?? []).map((f: JFlap) => ({ ...f }));

  DesignController.init(design);
  const edits: Edit[] = editsPath ? JSON.parse(readFileSync(editsPath, "utf8")) : [];
  for (const edit of edits) {
    if (edit.op !== "moveFlap") throw new Error(`unknown edit op: ${(edit as Edit).op}`);
    let flap = flaps.find(f => f.id === edit.id);
    if (!flap) {
      // A leaf with no explicit flap: BP Studio seeds it a default at the origin.
      flap = { id: edit.id, x: 0, y: 0, width: 0, height: 0 };
      flaps.push(flap);
    }
    flap.x = edit.x;
    flap.y = edit.y;
    DesignController.update({ flaps, edges: [], stretches, dragging: false });
  }

  // Re-derive the full graphics snapshot from a clean init at the final flaps so
  // the output is the complete state (not just the last edit's delta).
  DesignController.init({ ...design, layout: { ...design.layout, flaps } });
  const model = UpdateResult.$flush();
  const out = {
    flaps: [...flaps].sort((a, b) => a.id - b.id),
    graphics: model.graphics ?? {},
    // Invalid-junction outlines (ArcPolygon per "a,b" tag) — the ground truth for
    // the conflict regions the packing canvas draws.
    junctions: model.add?.junctions ?? {},
  };
  console.log(JSON.stringify(sortKeys(out), null, 2));
}

main();
