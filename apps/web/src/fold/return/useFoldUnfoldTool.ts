import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ANALYTICS_EVENTS, track, trackFoldStepAdded } from '../../analytics';
import { reportError } from '../../monitoring';
import { foldSession } from '../../store/workspaceStore/foldSession';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { canonicalJson } from '../document/foldDigest';
import { resolveFoldReturn } from '../document/foldReturn';
import type { FoldToolStep } from '../canvas/useFoldToolPreview';
import { foldStepInputKey } from '../session/foldSessionEngine';
import type { FoldSessionSurface } from '../session/useFoldSession';
import { useFoldSessionState } from '../session/useFoldSession';
import { useFoldPath } from '../sequence/useFoldPath';
import { foldTools, type FoldToolState } from '../tools/foldToolState';
import { unfoldOp, unfoldTargetOf, unfoldTargets } from './unfoldTool';
import type { FoldUnfoldWindowVerbs, FoldUnfoldWindowView } from './unfoldToolWindow';

/** Unfold to step while it is in hand: what it previews, what its window shows, and its commit. */
export interface FoldUnfoldTool {
  /** The step it previews and adds, keyed as the session keys it; null while there is none to make. */
  step: FoldToolStep | null;
  view: FoldUnfoldWindowView;
  verbs: FoldUnfoldWindowVerbs;
  /**
   * Add the step previewed — or replace the saved unfold being rebuilt — and
   * put the tool down. Whether there was one to add.
   */
  commit: () => boolean;
  /** Put the tool down: back to the saved step a rebuild began from. */
  putDown: () => void;
}

/**
 * Unfold to step, the tool (plan `fold-sequence-tools`): the step it returns
 * the step on screen to — the folder's choice, else the step before it
 * (`unfoldTargetOf`) — built as the stored `unfold-to` op (`unfoldOp`), which
 * the canvas previews as any tool's step (`useFoldToolPreview`). Its commit
 * is its own: it is told apart from a preview of the pose already on screen
 * (the landed state's fingerprint), checked against the history once more,
 * and a rebuild replaces its saved step in place rather than adding one.
 * Null while another tool is in hand.
 */
export function useFoldUnfoldTool(session: FoldSessionSurface, tools: FoldToolState): FoldUnfoldTool | null {
  const active = tools.tool === 'unfold-to';
  const { entries, cursor, cursorId } = useFoldPath(active);
  const loadId = useFoldSessionState((snapshot) => (active ? snapshot.loadId : 0));
  const targets = useMemo(() => (active ? unfoldTargets(entries, cursor) : []), [active, entries, cursor]);
  const target = active ? unfoldTargetOf(targets, tools.unfoldTarget, entries[cursor - 1]) : null;
  const source = active ? (entries[cursor]?.session ?? null) : null;
  const op = source && target ? unfoldOp(source, target) : null;
  const opKey = op ? canonicalJson(op) : null;
  const step = useMemo<FoldToolStep | null>(
    () => (op ? { op, key: foldStepInputKey({ op }) } : null),
    // The op is read through its key: an equal op is the same step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [opKey]
  );
  // A rebuild runs from the saved step's parent: elsewhere it is let go, and the tool adds a step.
  const rebuild = tools.rebuild?.tool === 'unfold-to' ? tools.rebuild : null;
  const rebuilding = rebuild !== null && rebuild.parent === cursorId;
  useEffect(() => {
    if (active && rebuild && rebuild.parent !== cursorId) foldTools().dropRebuild();
  }, [active, rebuild, cursorId]);

  // --- The landed pose's identity: a preview of the pose on screen adds nothing.
  const pending = session.pending;
  const landed = step && pending.status === 'landed' && foldStepInputKey(pending.request) === step.key ? pending.state : null;
  const [fingerprint, setFingerprint] = useState<{ key: string; value: string | null } | null>(null);
  const landedKey = landed ? `${landed.generation}:${landed.id}` : null;
  const { withState } = session;
  useEffect(() => {
    if (!landed || landedKey === null) return undefined;
    let current = true;
    void withState(landed, (engine, state) => engine.fingerprint(state)).then(
      (answer) => {
        if (current) setFingerprint({ key: landedKey, value: answer.status === 'answered' ? answer.value : null });
      },
      (error: unknown) => {
        reportError(error, { surface: 'fold:unfold-fingerprint' });
        if (current) setFingerprint({ key: landedKey, value: null });
      }
    );
    return () => {
      current = false;
    };
    // The state is read through its key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [withState, landedKey]);
  const asked = fingerprint && fingerprint.key === landedKey ? fingerprint : null;
  const landedFingerprint = asked?.value ?? null;
  const noop = landedFingerprint !== null && landedFingerprint === source?.fingerprint;

  // --- Why the last commit was turned down, while it is the step on screen's.
  const [failure, setFailure] = useState<{ key: string; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const committing = useRef(false);

  const putDown = useCallback(() => {
    const now = foldTools().store.getState().rebuild;
    session.cancel();
    foldTools().putDown();
    // A rebuild began from the saved step: the reader goes back to it.
    if (now?.tool === 'unfold-to' && foldSession().store.getState().cursor === now.parent) {
      useWorkspaceStore.getState().moveFoldCursor(now.id);
    }
  }, [session]);

  const commit = (): boolean => {
    if (!active || !step || !op || !landed || landedFingerprint === null || noop || committing.current) return false;
    const now = foldSession().store.getState();
    const stale = (code: string) => {
      setFailure({ key: step.key, code });
      return true;
    };
    if (now.loadId !== loadId || now.cursor !== cursorId || now.readOnly || !now.sequence) return false;
    if ('code' in resolveFoldReturn(now.sequence, cursorId, op, now.sheet, now.nodes)) return stale('return_source_changed');
    if (rebuilding && rebuild) {
      const stored = now.sequence.steps.find((node) => node.id === rebuild.id);
      const unchanged = stored?.op && stored.expect === landedFingerprint && canonicalJson(stored.op) === canonicalJson(op);
      const changed =
        unchanged ||
        useWorkspaceStore.getState().updateFoldReturn(rebuild.id, rebuild.expected, op, landedFingerprint, loadId);
      if (!changed) return stale('return_source_changed');
      // An update in place is no step added.
      if (!unchanged) track(ANALYTICS_EVENTS.foldUnfoldRebuilt);
      putDown();
      return true;
    }
    committing.current = true;
    setBusy(true);
    void session.commitStep(op).then(
      (answer) => {
        committing.current = false;
        setBusy(false);
        if (answer.status === 'committed') {
          trackFoldStepAdded('unfold_to');
          foldTools().putDown();
        } else {
          setFailure({ key: step.key, code: answer.status === 'refused' ? answer.refused.refusal.code : 'return_source_changed' });
        }
      },
      (error: unknown) => {
        committing.current = false;
        setBusy(false);
        reportError(error, { surface: 'fold:unfold-commit' });
      }
    );
    return true;
  };

  if (!active) return null;
  return {
    step,
    view: {
      entries,
      targets,
      target,
      noop,
      failure:
        failure && step && failure.key === step.key
          ? failure.code
          : asked && asked.value === null
            ? 'return_state_unavailable'
            : null,
      rebuilding,
      // Landed, its identity still being asked: nothing to commit until it is known.
      busy: busy || (landed !== null && asked === null),
    },
    verbs: {
      setTarget: (id) => foldTools().setUnfoldTarget(id),
    },
    commit,
    putDown,
  };
}
