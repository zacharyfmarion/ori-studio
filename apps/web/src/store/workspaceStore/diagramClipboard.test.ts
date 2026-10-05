import { beforeEach, describe, expect, it } from 'vitest';
import { handleMenuAction } from '../../commands/menuActions';
import { EDIT_PATH } from '../../diagram/annotate/annotateTools';
import { PASTE_OFFSET } from '../../diagram/annotate/annotationClipboard';
import type { KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { stepsIn } from '../../diagram/document/diagramSteps.fixtures';
import { useWorkspaceStore } from '../workspaceStore';
import { selectWorkspaceCapabilities } from './capabilities';

/**
 * Copy, Cut and Paste of annotations in the Diagram (Zach, 2026-10-05):
 * through the store's clipboard, which the Edit menu and ⌘C, ⌘X and ⌘V reach.
 */
const state = () => useWorkspaceStore.getState();
const marks = (stepId: string) => stepsIn(state().diagram!).find((step) => step.id === stepId)!.annotations as KnownDiagramAnnotation[];
const arrow: KnownDiagramAnnotation = { id: 'arrow', kind: 'valley-arrow', from: [0.2, 0.5], to: [0.6, 0.5], bend: 0.2 };

/** Two steps with pictures, the first open in Annotate with an arrow on it, selected, and a circle tool in hand. */
function twoSteps(): [string, string] {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"/>';
  const picture = (id: string) => ({ id, kind: 'svg' as const, svg, widthPx: 400, heightPx: 300, bytes: svg.length });
  const [first, second] = state().addDiagramPictures([picture('asset-1'), picture('asset-2')])!.stepIds as [string, string];
  useWorkspaceStore.setState({ activePanelId: 'diagram' });
  state().openDiagramStep(first, 'annotate');
  state().editDiagramAnnotations(first, 'Add annotation', () => [arrow]);
  state().selectDiagramAnnotation('arrow');
  state().setDiagramAnnotateTool('circle');
  return [first, second];
}

/** `annotation` moved by `offset` both ways, as a paste moves it: the same mark, in another place. */
const movedBy = (annotation: KnownDiagramAnnotation, offset: number) => ({
  ...annotation,
  id: expect.any(String),
  from: [expect.closeTo(annotation.from[0] + offset, 12), expect.closeTo(annotation.from[1] + offset, 12)],
  to: [expect.closeTo(annotation.to[0] + offset, 12), expect.closeTo(annotation.to[1] + offset, 12)],
});

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('copying and pasting annotations', () => {
  it('pastes a copy on another step in place, with a fresh id, selected with Select in hand, as one undo step', () => {
    const [, second] = twoSteps();
    state().copySelection();
    expect(state().clipboard).toMatchObject({ kind: 'diagram-annotations', annotations: [arrow] });
    state().openDiagramStep(second, 'annotate');
    const past = state().diagramHistory.past.length;
    void state().pasteClipboard();
    const [pasted] = marks(second);
    expect(pasted).toEqual(movedBy(arrow, 0));
    expect(pasted!.id).not.toBe('arrow');
    expect(state().diagramSelectedAnnotationId).toBe(pasted!.id);
    expect(state().diagramAnnotateTool).toBeNull();
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Paste annotation');
    // Again: a step on, so the two never stack; and ⌘Z takes the last away.
    void state().pasteClipboard();
    expect(marks(second)[1]).toEqual(movedBy(arrow, PASTE_OFFSET));
    void state().undo();
    expect(marks(second)).toHaveLength(1);
  });

  it('pastes on the step a copy came from down and right of its original, each further paste a step on', () => {
    const [first] = twoSteps();
    state().copySelection();
    void state().pasteClipboard();
    void state().pasteClipboard();
    expect(marks(first)).toEqual([arrow, movedBy(arrow, PASTE_OFFSET), movedBy(arrow, 2 * PASTE_OFFSET)]);
  });

  it('keeps Edit Path in hand to shape the copy, and pastes the mark as it was copied, whatever became of it', () => {
    const [first, second] = twoSteps();
    state().setDiagramAnnotateTool(EDIT_PATH);
    state().copySelection();
    state().editDiagramAnnotations(first, 'Flip arc', (list) => list.map((each) => ({ ...each, bend: -0.2 })));
    state().openDiagramStep(second, 'annotate');
    void state().pasteClipboard();
    expect(state().diagramAnnotateTool).toBe(EDIT_PATH);
    expect(marks(second)[0]!.bend).toBe(0.2);
  });

  it('cuts as one undo step, and pastes it back where it was on its own step', () => {
    const [first] = twoSteps();
    void state().cutSelection();
    expect(marks(first)).toEqual([]);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Cut annotation');
    void state().pasteClipboard();
    expect(marks(first)).toEqual([movedBy(arrow, 0)]);
  });

  it('copies from a diagram that cannot change, and pastes and cuts on none', () => {
    const [first] = twoSteps();
    useWorkspaceStore.setState({ diagramReadOnly: true });
    state().copySelection();
    expect(state().clipboard?.kind).toBe('diagram-annotations');
    void state().pasteClipboard();
    void state().cutSelection();
    expect(marks(first)).toEqual([arrow]);
  });

  it('acts on the diagram alone in the Diagram: no annotation selected copies nothing, and the tree’s clipboard pastes nothing', () => {
    const [first] = twoSteps();
    const tree = { kind: 'tree' as const, nodes: [{ sourceId: 1, label: 'root', loc: { x: 0.5, y: 0.5 } }], edges: [] };
    useWorkspaceStore.setState({ clipboard: tree });
    state().selectDiagramAnnotation(null);
    state().copySelection();
    expect(state().clipboard).toBe(tree);
    void state().pasteClipboard();
    expect(marks(first)).toEqual([arrow]);
  });

  it('is in the Diagram’s Edit menu, each verb off with its reason where it has nothing to act on, and reached through it', async () => {
    const [, second] = twoSteps();
    const capability = (id: 'edit.copy' | 'edit.cut' | 'edit.paste') => selectWorkspaceCapabilities(state())[id];
    expect(capability('edit.copy')).toMatchObject({ enabled: true, visible: true, reason: 'Copy the selected annotation' });
    expect(capability('edit.cut')).toMatchObject({ enabled: true, visible: true, reason: 'Cut the selected annotation' });
    expect(capability('edit.paste')).toMatchObject({ enabled: false, visible: true, reason: 'Copy an annotation before pasting' });
    await handleMenuAction('edit.copy');
    expect(capability('edit.paste')).toMatchObject({ enabled: true, reason: 'Paste the copied annotation' });
    state().openDiagramStep(second, 'annotate');
    expect(capability('edit.copy')).toMatchObject({ enabled: false, reason: 'Select an annotation first' });
    await handleMenuAction('edit.paste');
    expect(marks(second)).toHaveLength(1);
    // Out of Annotate, the steps: nothing to paste on.
    state().closeDiagramStep();
    expect(capability('edit.paste')).toMatchObject({ enabled: false, reason: 'Open a step in Annotate to paste on it' });
  });
});
