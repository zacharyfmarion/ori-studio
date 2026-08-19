/**
 * Keeps the armed tool's kernel operation in step with its variant mode.
 *
 * Extend Line and Divided Line are each one rail button over two kernel
 * operations, chosen by a tool option (see `lib/cpToolVariants.ts`). That makes
 * "which operation is armed" depend on state the tool state machine does not
 * hold, which is the whole of what this owns:
 *
 * - `armTool` selects a tool with the options as they are *now*, without the
 *   caller subscribing to them. Both callers -- the document-restore effect and
 *   the rail's select handler -- must not re-run when an unrelated option
 *   changes, so neither may close over the options directly.
 * - The effect re-resolves a mode changed while the tool is already armed, so
 *   the context panel takes effect without a tool reselect.
 * - `activeCommand` is the command for the *resolved* operation. For every
 *   ordinary tool that is the action's own command; for a merged tool it is
 *   whichever variant the mode names.
 */
import { useEffect, useMemo } from 'react';
import { useEventCallback } from '../../hooks/useEventCallback';
import type { OristudioCpActionDefinition } from '../../lib/oristudioCpActions';
import {
  cpCommandByOperation,
  type OristudioCpCommandDefinition,
} from '../../lib/oristudioCpCommands';
import {
  transitionOristudioCpToolState,
  type OristudioCpToolState,
} from '../../lib/oristudioCpToolState';
import type { OristudioCpToolOptions } from '../../lib/oristudioCpToolSettings';

export interface CpToolVariantSurface {
  /**
   * Select `action`, resolving its variant against the current tool options.
   *
   * `modeOverrides` is for the caller that is *also* setting the mode in the
   * same tick — restoring a document saved with a non-host variant active. The
   * options state has not caught up at that point, so the override is what makes
   * the restore land on the right operation in one step rather than arming the
   * wrong one and correcting on the next commit.
   */
  armTool: (
    state: OristudioCpToolState,
    action: OristudioCpActionDefinition,
    editable: boolean,
    modeOverrides?: Partial<OristudioCpToolOptions>,
  ) => OristudioCpToolState;
  /** The command the armed tool would actually run. */
  activeCommand: OristudioCpCommandDefinition | undefined;
}

export function useCpToolVariant({
  toolState,
  setToolState,
  toolOptions,
  activeAction,
}: {
  toolState: OristudioCpToolState;
  setToolState: React.Dispatch<React.SetStateAction<OristudioCpToolState>>;
  toolOptions: OristudioCpToolOptions;
  activeAction: OristudioCpActionDefinition | undefined;
}): CpToolVariantSurface {
  const armTool = useEventCallback(
    (
      state: OristudioCpToolState,
      action: OristudioCpActionDefinition,
      editable: boolean,
      modeOverrides?: Partial<OristudioCpToolOptions>,
    ) =>
      transitionOristudioCpToolState(state, {
        type: 'selectAction',
        action,
        editable,
        toolOptions: modeOverrides ? { ...toolOptions, ...modeOverrides } : toolOptions,
      }),
  );

  useEffect(() => {
    setToolState((state) =>
      transitionOristudioCpToolState(state, { type: 'resolveVariant', toolOptions }),
    );
  }, [setToolState, toolOptions]);

  const activeOperationId = toolState.activeOperationId;
  const activeCommand = useMemo(() => {
    // The tool state holds the resolved operation, so it wins. Falling back to
    // the action's own command matters only for an action whose operation has no
    // command of its own, which the registry does not currently produce.
    const resolved = activeOperationId ? cpCommandByOperation(activeOperationId) : undefined;
    if (resolved) return resolved;
    return activeAction?.kind === 'command' ? activeAction.command : undefined;
  }, [activeAction, activeOperationId]);

  return { armTool, activeCommand };
}
