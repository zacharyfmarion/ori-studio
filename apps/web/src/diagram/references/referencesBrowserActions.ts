/**
 * The ways into the References browser (D20), each fixing where what it adds
 * goes: From References… on the header or an empty diagram (into the
 * selected step when it is empty, else after it, or at the end), on an empty
 * step (fills it), and Replace from References… on a References step (its
 * card, the one it shows now marked).
 */
import { trackDiagramReferencesBrowserOpened } from '../../analytics';
import type { PaperExportMark } from '../../lib/paperExportSettings';
import { useSettingsStore } from '../../store/settingsStore';
import { stepSheetNow } from '../capture/stepSheetNow';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramReferencesBrowserState } from '../../store/workspaceStore/types';
import { anchorTakesCard, stepIndex, type DiagramPullAnchor, stepById } from '../document/diagramDocument';

/**
 * From References… for the diagram, by the insertion rule (D2): an empty
 * selected step takes the first card, the rest after it; any other selected
 * step has the cards after it; with none selected they go at the end.
 */
export function openReferencesBrowser(): void {
  const store = useWorkspaceStore.getState();
  const selected = store.diagramSelectedStepId;
  if (selected === null || !store.diagram || stepIndex(store.diagram, selected) < 0) {
    open({ kind: 'end' });
    return;
  }
  const fill: DiagramPullAnchor = { kind: 'fill', stepId: selected };
  open(anchorTakesCard(store.diagram, fill) ? fill : { kind: 'after', stepId: selected });
}

/** From References… on an empty step: the first card fills it, the rest follow it. */
export function fillStepFromReferences(stepId: string): void {
  open({ kind: 'fill', stepId });
}

/**
 * Replace from References… on a step pulled or sent from References: the
 * first card takes its place, opened on the pattern it came from with its
 * card marked "Shown now".
 */
export function replaceStepFromReferences(stepId: string): void {
  const store = useWorkspaceStore.getState();
  const step = store.diagram ? stepById(store.diagram, stepId) : null;
  if (!step || step.unknown || step.source?.kind !== 'references-step') return;
  const { plan, card, line, mode } = step.source;
  open(
    { kind: 'replace', stepId },
    {
      mode,
      pattern: plan ?? null,
      shown: { plan: plan ?? null, card, line: line ? { n: [line.n[0], line.n[1]], d: line.d } : null },
      // Its plan may have been made again since: then it opens on its sheet's.
      sheet: stepSheetNow(step.source)?.boundary ?? step.source.region.boundary,
      // The marks it pulled, as the Show menu opens (17d).
      ...(step.source.marks ? { marks: { ...step.source.marks } } : {}),
    }
  );
}

/**
 * The Show menu's switch for one mark (17d, RM4): shown or hidden for the
 * pull the open browser makes, and remembered for later pulls — that mark
 * alone, over the choice remembered. A Replace opens on its step's own
 * choice, which is the step's, not the author's choice for later pulls: a
 * step pulled without letters, replaced with only its reference lines
 * switched, leaves later pulls their letters.
 */
export function toggleReferencesMark(mark: PaperExportMark): void {
  const browser = useWorkspaceStore.getState().diagramReferencesBrowser;
  if (!browser) return;
  const settings = useSettingsStore.getState();
  const remembered = settings.diagramReferencesMarks;
  const shown = browser.marks ?? remembered;
  const next = { letters: shown.letters, highlights: shown.highlights, [mark]: !shown[mark] };
  settings.setDiagramReferencesMarks({ ...remembered, [mark]: next[mark] });
  useWorkspaceStore.getState().setDiagramReferencesBrowser({ marks: next });
}

function open(
  anchor: DiagramPullAnchor,
  options?: Partial<Omit<DiagramReferencesBrowserState, 'anchor' | 'opening'>>
): void {
  if (useWorkspaceStore.getState().openDiagramReferencesBrowser(anchor, options)) {
    trackDiagramReferencesBrowserOpened(anchor.kind);
  }
}
