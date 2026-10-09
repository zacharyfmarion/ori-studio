import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleMenuAction } from '../../commands/menuActions';
import { EDIT_PATH } from '../../diagram/annotate/annotateTools';
import { PASTE_OFFSET } from '../../diagram/annotate/annotationClipboard';
import { createDiagram, insertSteps, type KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { craneStep } from '../../diagram/zoom/zoom.fixtures';
import { stepsIn } from '../../diagram/document/diagramSteps.fixtures';
import { watchFrames } from '../../diagram/zoom/zoomInvariant.fixtures';
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

// Enlarged steps' frames where their imprints land, after every verb (Revision 2).
let frames: ReturnType<typeof watchFrames> | null = null;
beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  frames = watchFrames(useWorkspaceStore.subscribe);
});
afterEach(() => {
  frames!.stop();
  expect(frames!.problems).toEqual([]);
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

  it('tells the step’s canvas what each paste put there, with a nonce of its own, for it to bring into view (18d review)', () => {
    const [, second] = twoSteps();
    state().copySelection();
    expect(state().diagramPasted).toBeNull();
    state().openDiagramStep(second, 'annotate');
    void state().pasteClipboard();
    const first = state().diagramPasted!;
    expect(first).toEqual({ stepId: second, ids: [marks(second)[0]!.id], nonce: expect.any(Number) });
    void state().pasteClipboard();
    expect(state().diagramPasted).toEqual({ stepId: second, ids: [marks(second)[1]!.id], nonce: expect.any(Number) });
    expect(state().diagramPasted!.nonce).not.toBe(first.nonce);
    // Undo leaves it as it is: nothing new to show.
    const last = state().diagramPasted;
    void state().undo();
    expect(state().diagramPasted).toBe(last);
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

  it('leaves an enlarge area out of a paste, or a cut’s paste, on an enlarged step: it is enlarged or holds areas (Revision 2)', () => {
    const [first, second] = twoSteps();
    const area: KnownDiagramAnnotation = { id: 'area', kind: 'zoom', from: [0.5, 0.4], to: [0.5, 0.4], radius: 0.2 };
    state().editDiagramAnnotations(first, 'Enlarge area', () => [arrow, area]);
    state().selectDiagramAnnotation('area');
    const enlarge = { from: 'area', shape: 'circle' as const, frame: { centre: [0.5, 0.375] as [number, number], radius: 0.2 } };
    useWorkspaceStore.setState({
      diagram: {
        ...state().diagram!,
        steps: state().diagram!.steps.map((entry) => (entry.id === second ? { ...entry, zoom: enlarge } : entry)),
      },
    });
    state().copySelection();
    state().openDiagramStep(second, 'annotate');
    const past = state().diagramHistory.past.length;
    void state().pasteClipboard();
    expect(marks(second)).toEqual([]);
    expect(state().diagramHistory.past).toHaveLength(past);
    // Cut from its step, it cannot land on the enlarged one either; its own step takes it back.
    state().openDiagramStep(first, 'annotate');
    state().selectDiagramAnnotation('area');
    void state().cutSelection();
    state().openDiagramStep(second, 'annotate');
    void state().pasteClipboard();
    expect(marks(second)).toEqual([]);
    state().openDiagramStep(first, 'annotate');
    void state().pasteClipboard();
    expect(marks(first).map((mark) => mark.kind)).toEqual(['valley-arrow', 'zoom']);
  });

  it('fetches the faces of a flat step captured before they were kept when an x-ray is pasted on it, as laying one does (review of 18e)', async () => {
    const faced = craneStep('S.none');
    const older = { ...craneStep('S.none', { faces: false }), id: 'older' };
    const xray: KnownDiagramAnnotation = { id: 'xray', kind: 'x-ray', from: [0.45, 0.6], to: [0.45, 0.6], radius: 0.08, depth: 2 };
    useWorkspaceStore.setState({
      diagram: insertSteps(createDiagram({ title: 'Crane' }), [{ ...faced, annotations: [xray, arrow] }, older], 0),
      activePanelId: 'diagram',
    });
    state().openDiagramStep(faced.id, 'annotate');
    // An arrow pasted there fetches nothing: it needs no faces.
    state().selectDiagramAnnotation('arrow');
    state().copySelection();
    state().openDiagramStep('older', 'annotate');
    void state().pasteClipboard();
    expect(state().diagramPaperFacesFetching).toEqual({});
    // An x-ray does, in the paste's own undo step, saying nothing of a Refresh while they come.
    state().openDiagramStep(faced.id, 'annotate');
    state().selectDiagramAnnotation('xray');
    state().copySelection();
    state().openDiagramStep('older', 'annotate');
    void state().pasteClipboard();
    expect(marks('older').map((mark) => mark.kind)).toEqual(['valley-arrow', 'x-ray']);
    expect(state().diagramPaperFacesFetching).toEqual({ older: true });
    // No pattern open here to fold them from: it ends without them, and is told as over.
    await vi.waitFor(() => expect(state().diagramPaperFacesFetching).toEqual({}));
  });

  it('pastes marks copied on an enlarged step onto the same picture whole on the same paper (Revision 2)', () => {
    const [first] = twoSteps();
    const copy = state().duplicateDiagramStep(first)!;
    // Enlarged by hand below, its arrow read in the window's units: the test's own setup, not a verb.
    frames!.allowMarksMoved(copy);
    const enlarge = { from: 'area', shape: 'circle' as const, frame: { centre: [0.5, 0.375] as [number, number], radius: 0.2 } };
    useWorkspaceStore.setState({
      diagram: {
        ...state().diagram!,
        steps: state().diagram!.steps.map((entry) => (entry.id === copy ? { ...entry, zoom: enlarge } : entry)),
      },
    });
    state().openDiagramStep(copy, 'annotate');
    state().selectDiagramAnnotation(marks(copy)[0]!.id);
    state().copySelection();
    state().openDiagramStep(first, 'annotate');
    void state().pasteClipboard();
    // In the copy's window, 0.4 of the picture across from (0.3, 0.175): the arrow on the same paper, whole.
    const pasted = marks(first)[1]!;
    expect(pasted.from).toEqual([expect.closeTo(0.3 + arrow.from[0] * 0.4, 12), expect.closeTo(0.175 + arrow.from[1] * 0.4, 12)]);
    expect(pasted.to).toEqual([expect.closeTo(0.3 + arrow.to[0] * 0.4, 12), expect.closeTo(0.175 + arrow.to[1] * 0.4, 12)]);
  });

  describe('a mark across the model and a small frame (review of 16g)', () => {
    // Some ten windows long beside a frame a twelfth of the picture wide: past the four windows a whole picture's reach holds.
    const line: KnownDiagramAnnotation = { id: 'line', kind: 'valley-line', from: [0.1, 0.4], to: [0.95, 0.45] };
    const frame = { centre: [0.4, 0.35] as [number, number], radius: 0.04 };
    /** Back on the picture from the frame's window: x 0.36 to 0.44, y 0.31 to 0.39, its unit 0.08. */
    const onPicture = ([u, v]: readonly number[]) => [0.36 + u! * 0.08, 0.31 + v! * 0.08];
    const enlarge = (stepId: string) =>
      useWorkspaceStore.setState({
        diagram: {
          ...state().diagram!,
          steps: state().diagram!.steps.map((entry) =>
            entry.id === stepId ? { ...entry, zoom: { from: 'area', shape: 'circle' as const, frame }, annotations: [] } : entry
          ),
        },
      });
    const lineOn = (stepId: string) => {
      state().openDiagramStep(stepId, 'annotate');
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [line]);
      state().selectDiagramAnnotation('line');
    };
    const exactly = (a: readonly number[], b: readonly number[]) => a.forEach((value, index) => expect(value).toBeCloseTo(b[index]!, 9));

    it('copied whole and pasted on its enlarged duplicate lands on the same paper, and a paste there a paste’s step on in the window', () => {
      const [first] = twoSteps();
      lineOn(first);
      const copy = state().duplicateDiagramStep(first)!;
      enlarge(copy);
      state().openDiagramStep(first, 'annotate');
      state().selectDiagramAnnotation('line');
      state().copySelection();
      state().openDiagramStep(copy, 'annotate');
      void state().pasteClipboard();
      const [pasted] = marks(copy);
      exactly(onPicture(pasted!.from), line.from);
      exactly(onPicture(pasted!.to), line.to);
      // Copied there and pasted again on the same step: beside it, not pulled in to four windows out.
      state().selectDiagramAnnotation(pasted!.id);
      state().copySelection();
      void state().pasteClipboard();
      const beside = marks(copy)[1]!;
      exactly(beside.from, [pasted!.from[0] + PASTE_OFFSET, pasted!.from[1] + PASTE_OFFSET]);
      exactly(beside.to, [pasted!.to[0] + PASTE_OFFSET, pasted!.to[1] + PASTE_OFFSET]);
    });

    it('copied on the area’s step and pasted on an enlarged step of another picture lands at the same place on the picture, and back', () => {
      const [first, second] = twoSteps();
      lineOn(first);
      enlarge(second);
      state().copySelection();
      state().openDiagramStep(second, 'annotate');
      void state().pasteClipboard();
      const [pasted] = marks(second);
      exactly(onPicture(pasted!.from), line.from);
      exactly(onPicture(pasted!.to), line.to);
      // And back from the window to the whole picture of the other.
      state().selectDiagramAnnotation(pasted!.id);
      state().copySelection();
      state().openDiagramStep(first, 'annotate');
      void state().pasteClipboard();
      const back = marks(first)[1]!;
      exactly(back.from, line.from);
      exactly(back.to, line.to);
    });
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
