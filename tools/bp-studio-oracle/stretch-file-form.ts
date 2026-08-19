/**
 * BP Studio file-form oracle.
 *
 * Applies an edit sequence and then emits the design the way upstream writes it
 * to a `.bps` — the ground truth for what our `project_for_file` must produce.
 *
 * Upstream's file serialization is `Project.toJSON()` with no `session` flag,
 * which drops `history`, `state`, and every stretch's `repo`
 * (`client/project/components/layout/stretch.ts`: `if(!session) delete
 * result.repo`). What a stretch keeps is `{id, configuration, pattern}`: the
 * selected configuration's partitions and the selected pattern. Reloaded, that
 * is a prototype the generator yields first and then searches past, so the
 * pattern list stays live — unlike a stored `repo`, which freezes it.
 *
 * Usage (Bun, so the vendored TypeScript Core resolves via ./tsconfig.json):
 *
 *   bun tools/bp-studio-oracle/stretch-file-form.ts <design.json> [edits.json]
 *
 * <design.json>  A JDesign: { tree, layout }.
 * [edits.json]   The same edit vocabulary as `layout-graphics.ts`.
 *
 * Prints a JDesign whose `layout.stretches` are in file form. Feed it back to
 * `layout-graphics.ts` to see what reopening that file looks like — and do it
 * as a SEPARATE process. `DesignController.init` does not clear
 * `State.$stretches`, so a second `init` in one process reuses the previous
 * `Stretch` object and its repository, and you measure the state you were
 * trying to leave behind rather than the state the file restores.
 */
console.time = () => {};
console.timeEnd = () => {};

import { DesignController } from 'core/controller/designController';
import { LayoutController } from 'core/controller/layoutController';
import { State } from 'core/service/state';
import { readFileSync } from 'node:fs';

interface JFlap {
  id: number;
  x: number;
  y: number;
  width: number;
  height: number;
}
interface MoveFlapEdit {
  op: 'moveFlap';
  id: number;
  x: number;
  y: number;
}
interface CompleteStretchEdit {
  op: 'completeStretch';
  id: string;
}
interface SwitchConfigEdit {
  op: 'switchConfig';
  id: string;
  to: number;
}
interface SwitchPatternEdit {
  op: 'switchPattern';
  id: string;
  to: number;
}
type Edit = MoveFlapEdit | CompleteStretchEdit | SwitchConfigEdit | SwitchPatternEdit;

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
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
    console.error('usage: bun stretch-file-form.ts <design.json> [edits.json]');
    process.exit(2);
  }
  const design = JSON.parse(readFileSync(designPath, 'utf8'));
  const flaps: JFlap[] = (design.layout.flaps ?? []).map((f: JFlap) => ({ ...f }));

  DesignController.init(design);
  const edits: Edit[] = editsPath ? JSON.parse(readFileSync(editsPath, 'utf8')) : [];
  for (const edit of edits) {
    switch (edit.op) {
      case 'moveFlap': {
        let flap = flaps.find((f) => f.id === edit.id);
        if (!flap) {
          flap = { id: edit.id, x: 0, y: 0, width: 0, height: 0 };
          flaps.push(flap);
        }
        flap.x = edit.x;
        flap.y = edit.y;
        // Empty, as the client sends after `$resetPrototype()` — see
        // layout-graphics.ts for why this matters.
        DesignController.update({ flaps, edges: [], stretches: [], dragging: false });
        break;
      }
      case 'completeStretch':
        LayoutController.completeStretch(edit.id);
        break;
      case 'switchConfig':
        LayoutController.switchConfig(edit.id, edit.to);
        break;
      case 'switchPattern':
        LayoutController.switchPattern(edit.id, edit.to);
        break;
      default:
        throw new Error(`unknown edit op: ${(edit as Edit).op}`);
    }
  }

  const stretches = [...State.$stretches.values()].map((stretch) => {
    const json = stretch.toJSON() as Record<string, unknown>;
    delete json.repo;
    return json;
  });
  const out = { ...design, layout: { ...design.layout, flaps, stretches } };
  console.log(JSON.stringify(sortKeys(out), null, 2));
}

main();
