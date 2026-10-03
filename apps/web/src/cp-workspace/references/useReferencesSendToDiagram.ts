import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  awaitingReferencesStep,
  stepIndex,
  type ReferencesPlanSettings,
} from '../../diagram/document/diagramDocument';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { ReferencesActionState } from './referencesActions';
import {
  referencesDiagramCard,
  referencesDiagramCards,
  type ReferencesDiagramCards,
} from './referencesDiagramCards';
import type { ReferencesFilmstripStep } from './referencesFilmstrip';
import type { ReferencesPlanVariant } from './referencesResults';
import type { ReferencesViewStep } from './referencesSequenceView';
import type { SheetAnalysis } from './sheetFrames';

/** What the strip is showing, as the panel has it. */
export interface ReferencesSendToDiagramInput {
  /** The strip's cards, whichever mode drew them. */
  strip: readonly ReferencesFilmstripStep[];
  /** The plan's view steps, row for row with the strip; empty in Find. */
  viewSteps: readonly ReferencesViewStep[];
  variants: readonly ReferencesPlanVariant[];
  /** The card on show. */
  activeStep: number;
  mode: 'sequence' | 'find';
  /** The pattern's sheets. */
  frames: SheetAnalysis | null;
  /**
   * The sheet the strip is for: the plan's, or in Find the picked target's —
   * a pick finds its own sheet, whichever is selected in the rail.
   */
  sheetId: number | null;
  /** The settings the sequence was planned under; null in Find. */
  settings: ReferencesPlanSettings | null;
  /** The strip answers an earlier shape of the pattern. */
  stale: boolean;
}

export interface ReferencesSendToDiagram {
  actions: { sendToDiagram: () => void; sendAllToDiagram: () => void };
  /** What the catalog gates the two verbs on. */
  state: ReferencesActionState['diagram'];
}

/**
 * Send to diagram and Send all to diagram, bound to the strip (D6): the card
 * on show, or every card but the ending, each a diagram step of its own —
 * through `sendReferencesToDiagram`, which finds the sheet in the pattern and
 * says where the steps went. References stays where it is.
 */
export function useReferencesSendToDiagram(input: ReferencesSendToDiagramInput): ReferencesSendToDiagram {
  const { t } = useTranslation();
  const readOnly = useWorkspaceStore((state) => state.diagramReadOnly);
  const waitingStep = useWorkspaceStore((state) => {
    const step = awaitingReferencesStep(state.diagram, state.diagramReferencesTarget);
    return step && state.diagram ? stepIndex(state.diagram, step.id) + 1 : null;
  });
  const { strip, viewSteps, variants, activeStep, mode, frames, sheetId, settings, stale } = input;
  const sheet = useMemo(
    () => frames?.components.find((component) => component.id === sheetId) ?? null,
    [frames, sheetId]
  );

  const send = useCallback(
    (cards: ReferencesDiagramCards, via: 'one' | 'all') => {
      if (!sheet) return;
      if (cards.status === 'unreadable') {
        // ReferenceFinder drew it in a shape this build cannot read: never a blank step.
        toast.error(
          t(
            'toasts:diagram.references.unreadable',
            'This step’s picture couldn’t be read, so nothing was sent.'
          )
        );
        return;
      }
      if (cards.status !== 'ok') return;
      const { outline } = sheet;
      // Loaded on the first send: the Diagram's capture code is no weight on References until then.
      void import('../../diagram/capture/sendReferencesSteps').then(({ sendReferencesToDiagram }) =>
        sendReferencesToDiagram({ cards: cards.cards, outline, mode, settings, via })
      );
    },
    [sheet, mode, settings, t]
  );

  const actions = useMemo(
    () => ({
      sendToDiagram: () => send(referencesDiagramCard({ strip, viewSteps, variants }, activeStep), 'one'),
      sendAllToDiagram: () => send(referencesDiagramCards({ strip, viewSteps, variants }), 'all'),
    }),
    [send, strip, viewSteps, variants, activeStep]
  );

  const hint = readOnly
    ? t('panels:diagram.actions.readOnlyHint', 'This diagram was made with a newer Ori Studio and opens read-only')
    : stale
      ? t('panels:references.actions.staleHint', 'This answer is for an earlier pattern: recompute it first')
      : undefined;
  const usable = !readOnly && !stale && sheet !== null;
  const card = strip[activeStep];
  return {
    actions,
    state: {
      canSend: usable && card !== undefined && (card.primitives !== null || card.diagram !== null),
      canSendAll: usable && strip.some((row) => row.kind !== 'done'),
      ...(hint ? { hint } : {}),
      waitingStep,
    },
  };
}
