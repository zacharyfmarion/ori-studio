import type { FoldKindControl } from '../sequence/foldCommands';
import { isFoldKind } from '../tools/foldToolCatalog';
import type { FoldTools } from '../tools/foldToolState';
import type { FoldCanvasVerbs } from './useFoldCanvasVerbs';

/**
 * The fold kind the menus and the step cards arm (`registerFoldKindControl`),
 * as the tools hold it: the plain fold in hand, or none while another tool
 * is — a compound or vertex fold, a sink, the Divide line — so no kind reads
 * as chosen. Arming a kind takes that fold in hand, as V, M and P do.
 */
export function foldToolKindControl(tools: FoldTools): FoldKindControl {
  return {
    kind: () => {
      const tool = tools.store.getState().tool;
      return isFoldKind(tool) ? tool : null;
    },
    arm: (kind) => tools.selectTool(kind),
  };
}

/**
 * The Fold canvas's verbs, for what is not inside it: the keyboard's
 * executor (`useFoldCanvasShortcuts`) and the phone's header pills, which
 * sit in the panel's header beside the canvas. The canvas registers its
 * verbs while it is mounted; with none mounted there is nothing to press,
 * and every caller declines.
 *
 * One live set at a time, as `registerConditionalScopeExecutor` holds one
 * executor per surface: a newer registration replaces an older one, whose
 * release then leaves it be.
 */
let current: FoldCanvasVerbs | null = null;
const listeners = new Set<() => void>();

export function registerFoldCanvasVerbs(verbs: FoldCanvasVerbs): () => void {
  current = verbs;
  for (const listener of listeners) listener();
  return () => {
    if (current !== verbs) return;
    current = null;
    for (const listener of listeners) listener();
  };
}

/** The canvas's verbs, while one is mounted. */
export function foldCanvasVerbs(): FoldCanvasVerbs | null {
  return current;
}

/**
 * Run `act` on the canvas's verbs while a canvas is mounted — always, beside
 * the rail, which mounts with it. With none there is nothing to press, and a
 * press never waits for a canvas opened later.
 */
export function withFoldCanvasVerbs(act: (verbs: FoldCanvasVerbs) => void): void {
  if (current) act(current);
}

/** Hear when a canvas comes or goes: shaped for `useSyncExternalStore`, with {@link foldCanvasVerbs}. */
export function subscribeFoldCanvasVerbs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
