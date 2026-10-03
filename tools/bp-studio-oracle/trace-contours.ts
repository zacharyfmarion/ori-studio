/**
 * BP Studio trace-contour oracle.
 *
 * Prints the trace contours BP Studio's headless Core builds for every node of
 * a design — the hinge paths pattern contours are traced along. They are an
 * intermediate the layout graphics do not expose: a raw-mode trace contour can
 * differ from upstream's while the drawn graphics still agree, until a pattern
 * contour lands on the differing hinge. This is the ground truth for
 * `layout::contours::build_trace_contours`.
 *
 * Usage (Bun, so the vendored TypeScript Core resolves via ./tsconfig.json):
 *
 *   bun tools/bp-studio-oracle/trace-contours.ts <design.json>
 *
 * <design.json> is a JDesign, as for layout-graphics.ts.
 *
 * Prints canonical JSON: { <nodeId>: [{ raw, leaves, outer: [{ leaves, path }] }] }
 * where `outer[].leaves` is present only on raw-mode components.
 */
// Silence BP Studio's DEBUG timing logs so stdout is clean JSON.
console.time = () => {};
console.timeEnd = () => {};

import { DesignController } from "core/controller/designController";
import { State } from "core/service/state";
import { UpdateResult } from "core/service/updateResult";
import { readFileSync } from "node:fs";

function main(): void {
  const [designPath] = process.argv.slice(2);
  if (!designPath) {
    console.error("usage: bun trace-contours.ts <design.json>");
    process.exit(2);
  }
  DesignController.init(JSON.parse(readFileSync(designPath, "utf8")));
  UpdateResult.$flush();

  const out: Record<string, unknown> = {};
  for (const node of State.m.$tree.$nodes) {
    if (!node) continue;
    out[node.id] = node.$graphics.$traceContours.map(contour => ({
      raw: contour.$raw,
      leaves: [...contour.$leaves].sort((a, b) => a - b),
      outer: contour.$outer.map(path => ({
        ...(path.leaves ? { leaves: [...path.leaves].sort((a, b) => a - b) } : {}),
        path: path.map(p => ({ x: p.x, y: p.y })),
      })),
    }));
  }
  console.log(JSON.stringify(out, null, 2));
}

main();
