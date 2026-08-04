import { cpActionByOperation, cpActionByUpstreamMouseMode } from './oristudioCpActions';
import type { OristudioCpCommandActionDefinition } from './oristudioCpActions';
import type { OristudioCpOperationId } from './oristudioCpCommands';
import type { OristudioCpToolOptions } from './oristudioCpToolSettings';

/**
 * Tools that are one rail button over several kernel operations.
 *
 * Oriedita ships Extend Line and Lengthen by Same Color as two mouse handlers,
 * and likewise the two divided-line tools, differing only in what happens on
 * commit — the gesture is identical (both lengthen tools share the `lengthen`
 * input model, both divide tools share `drag-line`; see
 * `cp-workspace/tools/inputModelRegistry`). Ori Studio presents each pair as a
 * single tool and picks the operation from a tool option.
 *
 * # Why the kernel operations stay separate
 *
 * The `OperationId` enum is 1:1 with Oriedita's `MouseHandler*` classes, which is
 * the contract the oracle tests and `PORTING.md` are written against. Native
 * `.osf` files also carry the active mouse mode, and all four modes must keep
 * resolving when a document is reopened. So the merge is a UI identity only: the
 * *action* merges, and the action-to-operation step becomes a function of the
 * tool options.
 *
 * # One resolution point
 *
 * {@link resolveCpVariantOperation} is that function, and it is deliberately the
 * only place the mode is consulted. Everything downstream already branches on
 * operation id and already has the right answer registered for both variants —
 * the command payload fields, which context-panel groups render, whether the
 * live preview strokes in the active crease colour, the tool-hint text, the rail
 * glyph. Resolving once and letting those tables do their existing job is why
 * this costs almost no new branching.
 */

interface CpToolVariantGroup {
  /** The tool option that chooses the operation. */
  readonly optionKey: keyof OristudioCpToolOptions;
  /** The operation whose action owns the rail button for the whole group. */
  readonly hostOperationId: OristudioCpOperationId;
  /** Option value to operation. Keys are the values of `optionKey`. */
  readonly byValue: Readonly<Record<string, OristudioCpOperationId>>;
}

export type CpToolVariantGroupId = 'lengthen-color' | 'divide-mode';

const CP_TOOL_VARIANT_GROUPS: Readonly<Record<CpToolVariantGroupId, CpToolVariantGroup>> = {
  'lengthen-color': {
    optionKey: 'lengthenColorMode',
    hostOperationId: 'LengthenCrease',
    byValue: {
      active: 'LengthenCrease',
      same: 'LengthenCreaseSameColor',
    },
  },
  'divide-mode': {
    optionKey: 'divideMode',
    hostOperationId: 'LineSegmentDivision',
    byValue: {
      count: 'LineSegmentDivision',
      ratio: 'LineSegmentRatioSet',
    },
  },
};

/** Every operation that belongs to a variant group, mapped to its group. */
const GROUP_BY_OPERATION = new Map<OristudioCpOperationId, CpToolVariantGroupId>(
  Object.entries(CP_TOOL_VARIANT_GROUPS).flatMap(([groupId, group]) =>
    Object.values(group.byValue).map(
      (operationId) => [operationId, groupId as CpToolVariantGroupId] as const
    )
  )
);

/** The option value that selects a given operation, for the reverse lookup. */
const VALUE_BY_OPERATION = new Map<OristudioCpOperationId, string>(
  Object.values(CP_TOOL_VARIANT_GROUPS).flatMap((group) =>
    Object.entries(group.byValue).map(([value, operationId]) => [operationId, value] as const)
  )
);

/** Which variant group an operation belongs to, or `null` for an ordinary tool. */
export function cpVariantGroupForOperation(
  operationId: OristudioCpOperationId | null | undefined
): CpToolVariantGroupId | null {
  return operationId ? (GROUP_BY_OPERATION.get(operationId) ?? null) : null;
}

/**
 * The operation a tool actually runs, given the current tool options.
 *
 * Total and identity-preserving: an operation in no variant group comes back
 * untouched, so this can sit on the path of every tool without a guard.
 */
export function resolveCpVariantOperation(
  operationId: OristudioCpOperationId,
  options: OristudioCpToolOptions
): OristudioCpOperationId {
  const groupId = GROUP_BY_OPERATION.get(operationId);
  if (!groupId) return operationId;
  const group = CP_TOOL_VARIANT_GROUPS[groupId];
  return group.byValue[String(options[group.optionKey])] ?? group.hostOperationId;
}

/**
 * The operation whose action holds the rail button for this one.
 *
 * A variant that is not the host has no rail button of its own — its action is
 * `hidden-ui-only`, kept only so upstream mouse-mode lookups keep working.
 */
export function cpVariantHostOperation(
  operationId: OristudioCpOperationId
): OristudioCpOperationId {
  const groupId = GROUP_BY_OPERATION.get(operationId);
  return groupId ? CP_TOOL_VARIANT_GROUPS[groupId].hostOperationId : operationId;
}

/**
 * The tool options that make this operation the resolved one, for restoring a
 * document saved with a non-host variant active. Empty for an ordinary tool.
 */
export function cpVariantOptionPatch(
  operationId: OristudioCpOperationId
): Partial<OristudioCpToolOptions> {
  const groupId = GROUP_BY_OPERATION.get(operationId);
  const value = VALUE_BY_OPERATION.get(operationId);
  if (!groupId || value === undefined) return {};
  return { [CP_TOOL_VARIANT_GROUPS[groupId].optionKey]: value } as Partial<OristudioCpToolOptions>;
}

/**
 * The mode a caller asked for by naming this exact action — a keyboard shortcut
 * bound to "Divided Line (ratio)", or a command request naming an operation.
 * `undefined` for an ordinary tool.
 *
 * The rail deliberately does *not* use this. Its button is the tool, not one of
 * the variants, so clicking it keeps whatever mode the user last chose; a
 * shortcut bound to a variant by name is the opposite — it says which variant.
 */
export function cpVariantModeForNamedAction(
  action: OristudioCpCommandActionDefinition
): Partial<OristudioCpToolOptions> | undefined {
  const patch = cpVariantOptionPatch(action.operationId);
  return Object.keys(patch).length > 0 ? patch : undefined;
}

/**
 * The action to actually arm for `action` — itself, unless it is a merged tool's
 * non-host variant, in which case the tool with the rail button.
 *
 * Arming a variant directly would set `activeActionId` to an action the rail has
 * no button for, so nothing would light up and the tool would look unselected
 * while being armed.
 */
export function cpVariantHostAction(
  action: OristudioCpCommandActionDefinition
): OristudioCpCommandActionDefinition {
  const hostOperationId = cpVariantHostOperation(action.operationId);
  if (hostOperationId === action.operationId) return action;
  return cpActionByOperation(hostOperationId) ?? action;
}

/**
 * The tool to arm for a document saved with `mouseMode` active — the action that
 * owns its rail button, plus the options that make that mouse mode's operation
 * the one the tool runs.
 *
 * Oriedita writes one of four mouse modes for the merged pairs, and two of them
 * now belong to actions with no button. Restoring those directly would leave the
 * rail with nothing lit and the mode reading whatever it happened to be, so the
 * indirection through the host is the whole point of this function.
 */
export function cpToolSelectionForMouseMode(mouseMode: string): {
  action: OristudioCpCommandActionDefinition;
  /** Absent when the mode is already the tool's own — most of the time. */
  options?: Partial<OristudioCpToolOptions>;
} | null {
  const action = cpActionByUpstreamMouseMode(mouseMode);
  if (!action) return null;
  // Every member of a pair carries its mode, the host included -- the host is one
  // of the variants, not a neutral default. Returning no options for it would
  // restore a file saved in Active colour into whatever mode was last used.
  if (!cpVariantGroupForOperation(action.operationId)) return { action };
  return {
    action: cpActionByOperation(cpVariantHostOperation(action.operationId)) ?? action,
    options: cpVariantOptionPatch(action.operationId),
  };
}
