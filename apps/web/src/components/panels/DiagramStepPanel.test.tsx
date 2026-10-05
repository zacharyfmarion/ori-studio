import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cpDocument } from '../../diagram/capture/capture.fixtures';
import { createDiagram, type DiagramCpRender } from '../../diagram/document/diagramDocument';
import { cpStep, referencesStep, stepsIn } from '../../diagram/document/diagramSteps.fixtures';
import {
  buildDiagramLinkedPoseActions,
  buildDiagramSpreadControls,
} from '../../diagram/actions/diagramLinkedPoseActions';
import { publishOpenLinkedPose } from '../../diagram/capture/openLinkedPose';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { ANNOTATE_TOOL_GROUPS, annotateToolHelp } from '../../diagram/annotate/annotateTools';
import { angleMarkAt } from '../../diagram/annotate/annotationModel';
import i18n from '../../i18n';
import { STORAGE_KEYS, storageKey } from '../../lib/storage';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramStepPanel } from './DiagramStepPanel';

const tracked = vi.hoisted(() => ({ trackDiagramAnnotationBehind: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  trackDiagramAnnotationBehind: tracked.trackDiagramAnnotationBehind,
}));

/**
 * The Step pane through the store: what it says with nothing selected, and
 * what its position field, verbs and instruction do to the selected step.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialState = useWorkspaceStore.getInitialState();
let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  useWorkspaceStore.setState(initialState, true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <TooltipProvider>
        <DiagramStepPanel />
      </TooltipProvider>
    )
  );
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.useRealTimers();
});

const state = () => useWorkspaceStore.getState();
const ids = () => stepsIn(state().diagram!).map((step) => step.id) ?? [];
const button = (label: string) =>
  host?.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;
const position = () => host?.querySelector('input[aria-label="Step position"]') as HTMLInputElement;
const instruction = () => host?.querySelector('textarea') as HTMLTextAreaElement;

function setField(field: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype.prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function threeSteps() {
  act(() => {
    state().addDiagramStep();
    state().addDiagramStep();
    state().addDiagramStep();
  });
  return ids();
}

describe('DiagramStepPanel', () => {
  it('asks for a step when there is none, and for a selection when nothing is chosen', () => {
    expect(host?.textContent).toContain('Add a step to write its instruction here.');
    threeSteps();
    act(() => state().selectDiagramStep(null));
    expect(host?.textContent).toContain('Select a step to edit it.');
  });

  it('writes the instruction to the selected step, as one undo step', () => {
    const [, , third] = threeSteps();
    const past = state().diagramHistory.past.length;
    act(() => instruction().focus());
    setField(instruction(), 'Fold');
    act(() => vi.advanceTimersByTime(600));
    setField(instruction(), 'Fold in half.');
    act(() => instruction().blur());
    expect(stepsIn(state().diagram!).find((step) => step.id === third)?.text).toBe('Fold in half.');
    expect(state().diagramHistory.past).toHaveLength(past + 1);
  });

  it('shows a turn between steps as what it is and where, and changes and deletes it (D22)', () => {
    const [first] = threeSteps();
    let turn = '';
    act(() => {
      turn = state().insertDiagramTurn({ kind: 'turn-over', axis: 'vertical' }, { stepId: first!, where: 'after' })!;
    });
    expect(host!.textContent).toContain('Turn over, side to side');
    expect(host!.textContent).toContain('Between steps 1 and 2');
    // No instruction, no position: a turn has neither.
    expect(instruction()).toBeNull();
    const option = (label: string) =>
      [...host!.querySelectorAll<HTMLElement>('button[aria-pressed]')].find((element) => element.textContent === label)!;
    act(() => option('Rotate').click());
    expect(state().diagram!.steps[1]).toEqual({ id: turn, kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } });
    expect(host!.textContent).toContain('Rotate 1/4 turn clockwise');
    // Each control its own name.
    expect([...host!.querySelectorAll('[role="group"]')].map((group) => group.getAttribute('aria-label'))).toEqual([
      'Turn',
      'Amount',
      'Direction',
      'Turn actions',
    ]);
    const remove = [...host!.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === 'Delete Turn')!;
    act(() => remove.click());
    expect(state().diagram!.steps.some((entry) => entry.id === turn)).toBe(false);
  });

  it('numbers and walks the steps alone, past a turn between them', () => {
    const [first, second, third] = threeSteps();
    act(() => {
      state().insertDiagramTurn({ kind: 'turn-over', axis: 'vertical' }, { stepId: first!, where: 'after' });
      state().selectDiagramStep(third!);
    });
    expect(position().value).toBe('3');
    act(() => button('Previous Step')?.click());
    expect(state().diagramSelectedStepId).toBe(second);
    act(() => button('Previous Step')?.click());
    expect(state().diagramSelectedStepId).toBe(first);
    // Typed to 2: before the step that becomes 3. The turn stays before the step it was before.
    act(() => position().focus());
    setField(position(), '2');
    act(() => position().blur());
    expect(state().diagram!.steps.map((entry) => ('kind' in entry ? 'turn' : entry.id))).toEqual(['turn', second, first, third]);
    expect(position().value).toBe('2');
  });

  it('moves the step to a typed position, and puts back one that is not a position', () => {
    const [first, second, third] = threeSteps();
    expect(position().value).toBe('3');
    act(() => position().focus());
    setField(position(), '1');
    act(() => position().blur());
    expect(ids()).toEqual([third, first, second]);
    expect(position().value).toBe('1');

    act(() => position().focus());
    setField(position(), '9');
    act(() => position().blur());
    expect(ids()).toEqual([third, first, second]);
    expect(position().value).toBe('1');
  });

  it('goes to the step before and after, and runs the header verbs', () => {
    const [first, second, third] = threeSteps();
    // ‹ and › go to the neighbours, as the detail's do; they move nothing.
    expect(button('Next Step')?.disabled).toBe(true);
    act(() => button('Previous Step')?.click());
    expect(state().diagramSelectedStepId).toBe(second);
    expect(position().value).toBe('2');
    act(() => button('Previous Step')?.click());
    expect(state().diagramSelectedStepId).toBe(first);
    expect(button('Previous Step')?.disabled).toBe(true);
    act(() => button('Next Step')?.click());
    expect(state().diagramSelectedStepId).toBe(second);
    expect(ids()).toEqual([first, second, third]);

    act(() => button('Duplicate Step')?.click());
    expect(ids()).toHaveLength(4);
    expect(state().diagramSelectedStepId).toBe(ids()[2]);

    // An empty step goes without a question.
    act(() => button('Delete Step')?.click());
    expect(ids()).toEqual([first, second, third]);
  });

  describe('the picture', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1105.6" height="800" viewBox="0 0 1105.6 800"/>';
    const asset = { id: 'asset-a', kind: 'svg' as const, svg, widthPx: 1105.6, heightPx: 800, bytes: svg.length };
    const textButton = (label: string) =>
      [...(host?.querySelectorAll('button') ?? [])].find((candidate) => candidate.textContent === label);
    /** The option pressed in a segmented row, by the row's name. */
    const pressed = (label: string) =>
      host?.querySelector(`[aria-label="${label}"] button[aria-pressed="true"]`)?.textContent ?? null;

    it('offers only the ways to a first picture for a step without one', () => {
      act(() => {
        state().addDiagramStep();
      });
      expect(host?.textContent).toContain('No picture yet');
      expect(textButton('Upload Picture…')?.disabled).toBe(false);
      for (const dead of ['Adjust Pose', 'Export Picture…', 'Remove Picture', 'Refresh Picture']) {
        expect(textButton(dead)).toBeUndefined();
      }
    });

    it('shows the pose only while the step is open in detail, and no verbs: they are Pose’s toolbar’s', () => {
      let stepId = '';
      act(() => {
        stepId = state().addDiagramStep()!;
        state().setDiagramStepPicture(stepId, asset);
        state().setDiagramStepPose(stepId, { rotationQuarterTurns: 1, mirrored: true });
      });
      expect(host?.textContent).not.toContain('clockwise');
      act(() => textButton('Adjust Pose')?.click());
      expect(state().diagramDetail).toBe('pose');
      // Open in Pose, the verb leads nowhere new.
      expect(textButton('Adjust Pose')).toBeUndefined();
      expect(host?.textContent).toContain('90° clockwise');
      expect(host?.textContent).toContain('FlippedYes');
      for (const verb of ['Rotate Left', 'Rotate Right', 'Flip', 'Reset Pose']) {
        expect(textButton(verb)).toBeUndefined();
      }
      act(() => state().setDiagramStepPose(stepId, { rotationQuarterTurns: 0, mirrored: false }));
      expect(host?.textContent).toContain('0° clockwise');
      expect(host?.textContent).toContain('FlippedNo');
    });

    it('opens the References browser to fill an empty step from From References…', () => {
      let stepId = '';
      act(() => {
        // A pattern open, so there is something to plan.
        useWorkspaceStore.setState({
          oristudioCpDocument: { handle: 1, document: cpDocument(), geometry: null } as unknown as OristudioCpDocumentState,
        });
        stepId = state().addDiagramStep()!;
      });
      act(() => textButton('From References…')!.click());
      expect(state().diagramReferencesBrowser?.anchor).toEqual({ kind: 'fill', stepId });
    });

    it('says which way a 3D step looks at its model', () => {
      act(() => {
        const step = cpStep('step-3d', { mode: 'folded-3d', camera: { yaw: Math.PI / 4, pitch: -0.955, zoom: 1 }, side: 'front' });
        useWorkspaceStore.setState({ diagram: { ...createDiagram({ newId: () => 'diagram-1' }), steps: [step] } });
        state().selectDiagramStep('step-3d');
      });
      expect(host?.textContent).toContain('ViewYaw 45° · Pitch -55°');
    });

    it('turns a step sent from References over from the pane, by choosing its side', () => {
      act(() => {
        useWorkspaceStore.setState({ diagram: { ...createDiagram({ newId: () => 'diagram-1' }), steps: [referencesStep('step-r')] } });
        state().openDiagramStep('step-r');
      });
      expect(pressed('Side')).toBe('Front');
      expect(textButton('Turn Over')).toBeUndefined();
      act(() => textButton('Back')?.click());
      expect(stepsIn(state().diagram!)[0]!.picture).toMatchObject({ kind: 'step-diagram', mirrored: true });
      expect(pressed('Side')).toBe('Back');
      // The side it shows already: nothing to turn.
      act(() => textButton('Back')?.click());
      expect(stepsIn(state().diagram!)[0]!.picture).toMatchObject({ mirrored: true });
    });

    it('poses a linked flat fold from the pane with the open step’s own verbs, and its turn as a field', () => {
      const pose = vi.fn();
      const rotateTo = vi.fn();
      const render = { mode: 'folded-flat' as const, side: 'back' as const, rotationDeg: 30, foldCase: 2 };
      act(() => {
        useWorkspaceStore.setState({ diagram: { ...createDiagram({ newId: () => 'diagram-1' }), steps: [cpStep('step-f', render)] } });
        state().openDiagramStep('step-f');
        const actions = buildDiagramLinkedPoseActions(
          { render, readOnly: false, busy: false, solutions: { discovered: 1, hasNext: true } },
          { t: ((_key: string, fallback: string) => fallback) as never, pose }
        );
        publishOpenLinkedPose('step-f', {
          actions,
          layerOrder: { count: '2 of 2+', label: 'Layer order 2 of 2+' },
          spatial: null,
          onCamera: () => {},
          rotateTo,
          showAs: async () => true,
          simulate: async () => {},
          wantsRest: () => false,
          spread: null,
          preview: null,
        });
      });
      expect(pressed('Side')).toBe('Back');
      expect(host?.textContent).toContain('Layer order2 of 2+');
      act(() => textButton('Front')?.click());
      expect(pose).toHaveBeenCalledWith('turn-over');
      // Show as leads the pane, above the pose.
      const showAs = host!.querySelector('[role="group"][aria-label="Show as"]')!;
      const rotationField = host!.querySelector('input[aria-label="Rotation"]')!;
      expect(showAs.compareDocumentPosition(rotationField) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const rotation = host!.querySelector<HTMLInputElement>('input[aria-label="Rotation"]')!;
      expect(rotation.value).toBe('30');
      act(() => rotation.focus());
      setField(rotation, '100');
      act(() => rotation.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
      expect(rotateTo).toHaveBeenCalledWith(100);
      act(() => publishOpenLinkedPose(null, null));
    });

    /** A flat fold's spread published as the open step's controller would, its verbs mocks. */
    function spreadPane() {
      const verbs = { pose: vi.fn(), kind: vi.fn(), direction: vi.fn(), keep: vi.fn(), preview: vi.fn(), commit: vi.fn() };
      const t = ((_key: string, fallback: string, values?: Record<string, unknown>) =>
        fallback.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name]))) as never;
      const publish = (render: DiagramCpRender) => {
        const poseState = { render, readOnly: false, busy: false, solutions: { discovered: 1, hasNext: false } };
        const controls = buildDiagramSpreadControls(poseState, null, { t, ...verbs });
        publishOpenLinkedPose('step-f', {
          actions: buildDiagramLinkedPoseActions(poseState, { t, pose: verbs.pose }),
          layerOrder: null,
          spatial: null,
          onCamera: () => {},
          rotateTo: () => {},
          showAs: async () => true,
          simulate: async () => {},
          wantsRest: () => false,
          spread: controls && { ...controls, preview: verbs.preview, commit: verbs.commit, start: () => true },
          preview: null,
        });
      };
      const flat = { mode: 'folded-flat' as const, side: 'front' as const, rotationDeg: 0, foldCase: 1 };
      act(() => {
        useWorkspaceStore.setState({ diagram: { ...createDiagram({ newId: () => 'diagram-1' }), steps: [cpStep('step-f', flat)] } });
        state().openDiagramStep('step-f');
        publish(flat);
      });
      const slider = (name: string) => host!.querySelector<HTMLInputElement>(`input[type="range"][aria-label="${name}"]`);
      const kinds = () => host!.querySelector('[role="group"][aria-label="Spread by"]');
      return { verbs, publish, flat, slider, kinds };
    }

    it('spreads a flat fold’s layers from the pane: on, by depth, how far as a percentage, and which way (Phase 13)', () => {
      const { verbs, publish, flat, slider, kinds } = spreadPane();
      const toggle = () => host!.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Spread layers"]')!;
      const amount = () => slider('Spread amount');
      expect(toggle().getAttribute('aria-checked')).toBe('false');
      // Off: nothing to set.
      expect(amount()).toBeNull();
      expect(kinds()).toBeNull();
      act(() => toggle().click());
      expect(verbs.pose).toHaveBeenCalledWith('spread-layers');

      act(() => publish({ ...flat, spread: { kind: 'depth' as const, amount: 0.08, toward: 'up-left' } }));
      expect(toggle().getAttribute('aria-checked')).toBe('true');
      expect(amount()!.value).toBe('8');
      expect(amount()!.getAttribute('aria-valuetext')).toBe('8% of the model');
      expect(host!.textContent).toContain('8%');
      // By depth: no affine rows.
      expect(slider('Spread skew')).toBeNull();
      expect(slider('Spread axis')).toBeNull();
      const compass = host!.querySelector('[role="group"][aria-label="Spread direction"]')!;
      const directions = [...compass.querySelectorAll<HTMLButtonElement>('button')];
      expect(directions).toHaveLength(8);
      expect(directions.filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => button.getAttribute('aria-label'))).toEqual([
        'Deeper layers up and left',
      ]);
      act(() => directions.find((button) => button.getAttribute('aria-label') === 'Deeper layers down')!.click());
      expect(verbs.direction).toHaveBeenCalledWith('down');

      // A drag previews every move, and commits once, as the native change says it ended.
      setField(amount()!, '10');
      setField(amount()!, '12.5');
      expect(verbs.preview.mock.calls).toEqual([['amount', 0.1], ['amount', 0.125]]);
      expect(verbs.commit).not.toHaveBeenCalled();
      act(() => amount()!.dispatchEvent(new Event('change', { bubbles: true })));
      expect(verbs.commit).toHaveBeenCalledOnce();

      // Affine | Depth, under the switch: affine first (Zach, 2026-10-05).
      const segments = [...kinds()!.querySelectorAll<HTMLButtonElement>('button')];
      expect(segments.map((button) => button.textContent)).toEqual(['Affine', 'Depth']);
      act(() => segments[0]!.click());
      expect(verbs.kind).toHaveBeenCalledWith('affine');
      act(() => publishOpenLinkedPose(null, null));
    });

    it('spreads a flat fold affine from the pane: the layer held still, the amount, skew and axis (13g)', () => {
      const { verbs, publish, flat, slider } = spreadPane();
      act(() => publish({ ...flat, spread: { kind: 'affine', amount: 0.03, keep: 'top', skew: 1, axisDeg: 81 } }));
      // Affine: no compass.
      expect(host!.querySelector('[role="group"][aria-label="Spread direction"]')).toBeNull();
      expect(pressed('Spread by')).toBe('Affine');
      expect(pressed('Keep still')).toBe('Top');
      const amount = slider('Spread amount')!;
      expect(amount.max).toBe('25');
      expect(amount.getAttribute('aria-valuetext')).toBe('3% of the way back to the sheet along the axis');
      const skew = slider('Spread skew')!;
      expect(skew.value).toBe('100');
      const axis = slider('Spread axis')!;
      expect([axis.min, axis.max, axis.value]).toEqual(['0', '179', '81']);
      expect(axis.getAttribute('aria-valuetext')).toBe('Axis at 81° on the sheet');
      expect(host!.textContent).toContain('81°');

      const keeps = [...host!.querySelector('[role="group"][aria-label="Keep still"]')!.querySelectorAll<HTMLButtonElement>('button')];
      act(() => keeps.find((button) => button.textContent === 'Bottom')!.click());
      expect(verbs.keep).toHaveBeenCalledWith('bottom');

      setField(skew, '40');
      setField(axis, '99');
      setField(amount, '5');
      expect(verbs.preview.mock.calls).toEqual([['skew', 0.4], ['axis', 99], ['amount', 0.05]]);
      act(() => axis.dispatchEvent(new Event('change', { bubbles: true })));
      expect(verbs.commit).toHaveBeenCalledOnce();
      act(() => publishOpenLinkedPose(null, null));
    });

    it('says what the picture is, what sanitizing changed, and removes it', () => {
      act(() => {
        const stepId = state().addDiagramStep()!;
        state().setDiagramStepPicture(stepId, asset);
        state().noteDiagramPictureChanges('asset-a', ['flowed-text', 'css-dropped']);
      });
      expect(host?.textContent).toContain('Uploaded SVG, 1106 × 800 px');
      expect(host?.textContent).toContain('This picture was simplified.');
      expect(host?.textContent).toContain('Flowed text isn’t supported');
      expect(textButton('Replace Picture…')).toBeDefined();

      act(() => textButton('Remove Picture')?.click());
      expect(host?.textContent).toContain('No picture yet');
      expect(host?.textContent).not.toContain('simplified');
      expect(stepsIn(state().diagram!)[0].text).toBe('');
    });
  });
});

describe('DiagramStepPanel in Annotate', () => {
  /** A step with a picture, open in Annotate, carrying a label and an arrow. */
  function annotatedStep() {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30"/>';
    act(() => {
      state().addDiagramPictures([{ id: 'asset-1', kind: 'svg', svg, widthPx: 40, heightPx: 30, bytes: svg.length }]);
    });
    const stepId = state().diagramSelectedStepId!;
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [
        { id: 'a-1', kind: 'valley-arrow', from: [0.1, 0.2], to: [0.5, 0.2], bend: 0.1 },
        { id: 'a-2', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'B' },
        { id: 'a-3', kind: 'rotate', from: [0.8, 0.8], to: [0.8, 0.8], rotate: { amount: 'quarter', direction: 'cw' } },
      ]);
    });
    return stepId;
  }
  const annotations = () => stepsIn(state().diagram!)[0]!.annotations as { id: string; bend?: number; text?: string; rotate?: unknown }[];
  const row = (name: string) =>
    [...(host?.querySelectorAll<HTMLButtonElement>('ul button') ?? [])].find((candidate) => candidate.textContent === name)!;
  const buttonNamed = (name: string) =>
    [...(host?.querySelectorAll<HTMLButtonElement>('button') ?? [])].find((candidate) => candidate.textContent?.trim() === name)!;

  it('counts them out of Annotate, and leads in', () => {
    const stepId = annotatedStep();
    expect(host?.textContent).toContain('3 annotations');
    act(() => buttonNamed('Annotate').click());
    expect(state().diagramDetail).toBe('annotate');
    expect(state().diagramSelectedStepId).toBe(stepId);
  });

  it('lists them, selects one with a press, and offers its own controls', () => {
    const stepId = annotatedStep();
    act(() => state().openDiagramStep(stepId, 'annotate'));
    // A row pressed with a drawing tool in hand puts Select back, to move what it selected.
    act(() => state().setDiagramAnnotateTool('line'));
    act(() => row('Valley Fold Arrow').click());
    expect(state().diagramSelectedAnnotationId).toBe('a-1');
    expect(state().diagramAnnotateTool).toBeNull();
    expect(row('Valley Fold Arrow').getAttribute('aria-pressed')).toBe('true');
    act(() => buttonNamed('Flip Arc').click());
    expect(annotations()[0]!.bend).toBe(-0.1);
    act(() => row('Rotate').click());
    act(() => buttonNamed('1/2').click());
    expect(annotations()[2]!.rotate).toEqual({ amount: 'half', direction: 'cw' });
    act(() => buttonNamed('Delete').click());
    expect(annotations().map((annotation) => annotation.id)).toEqual(['a-1', 'a-2']);
    expect(state().diagramSelectedAnnotationId).toBeNull();
  });

  it('makes a selected line another type with Type, the same line, as one undo step (15a)', () => {
    const stepId = annotatedStep();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'l-1', kind: 'valley-line', from: [0.1, 0.6], to: [0.7, 0.6] },
      ]);
      state().openDiagramStep(stepId, 'annotate');
    });
    act(() => row('Valley Line').click());
    const type = () => host!.querySelector('[role="group"][aria-label="Type"]')!;
    const option = (name: string) => [...type().querySelectorAll<HTMLButtonElement>('button')].find((button) => button.getAttribute('aria-label') === name)!;
    expect(option('Valley').getAttribute('aria-pressed')).toBe('true');
    const past = state().diagramHistory.past.length;
    act(() => option('Mountain').click());
    expect(annotations().find((annotation) => annotation.id === 'l-1')).toEqual({
      id: 'l-1',
      kind: 'mountain-line',
      from: [0.1, 0.6],
      to: [0.7, 0.6],
    });
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Change line type');
    // Not a line: no Type.
    act(() => row('Valley Fold Arrow').click());
    expect(host!.querySelector('[role="group"][aria-label="Type"]')).toBeNull();
  });

  it('gives an equal-angle mark more ticks with Ticks, one when it says none, as one undo step (15b)', () => {
    const stepId = annotatedStep();
    const mark = angleMarkAt([0.5, 0.7], [0.4, 0.6], [0.5, 0.6])!;
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'm-1', kind: 'angle-mark', ...mark },
      ]);
      state().openDiagramStep(stepId, 'annotate');
    });
    act(() => row('Equal Angles').click());
    const ticks = () => [...host!.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Ticks"] button')];
    const tick = (count: string) => ticks().find((option) => option.textContent?.trim() === count)!;
    expect(ticks().map((option) => option.textContent?.trim())).toEqual(['1', '2', '3']);
    expect(tick('1').getAttribute('aria-pressed')).toBe('true');
    const past = state().diagramHistory.past.length;
    act(() => tick('2').click());
    expect(annotations().find((annotation) => annotation.id === 'm-1')).toEqual({ id: 'm-1', kind: 'angle-mark', ...mark, ticks: 2 });
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Change angle mark');
    // Not an angle mark: no Ticks.
    act(() => row('Valley Fold Arrow').click());
    expect(ticks()).toEqual([]);
  });

  it('gives a pleat arrow more Zs with Kinks, one to five, and steps them to the other side with Flip, each one undo step (15c)', () => {
    const stepId = annotatedStep();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'p-1', kind: 'pleat-arrow', from: [0.6, 0.4], to: [0.2, 0.5] },
      ]);
      state().openDiagramStep(stepId, 'annotate');
    });
    act(() => row('Pleat Arrow').click());
    const pleat = () => annotations().find((annotation) => annotation.id === 'p-1') as Record<string, unknown>;
    const kinks = host!.querySelector<HTMLInputElement>('input[aria-label="Kinks"]')!;
    // One when it says none.
    expect(kinks.value).toBe('1');
    const past = state().diagramHistory.past.length;
    act(() => button('Increase Kinks')!.click());
    expect(pleat().kinks).toBe(2);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Change pleat arrow');
    // No fewer than one, no more than five.
    act(() => kinks.focus());
    setField(kinks, '9');
    act(() => kinks.blur());
    expect(pleat().kinks).toBe(5);
    // Flip, as it is named on a pleat arrow: its Zs to the other side, and back.
    expect(buttonNamed('Flip Arc')).toBeUndefined();
    act(() => buttonNamed('Flip').click());
    expect(pleat().mirrored).toBe(true);
    act(() => buttonNamed('Flip').click());
    expect('mirrored' in pleat()).toBe(false);
  });

  it('flips the selected mark horizontally or vertically from its Flip row, each one undo step, and offers none on a label', () => {
    const stepId = annotatedStep();
    act(() => state().openDiagramStep(stepId, 'annotate'));
    act(() => row('Valley Fold Arrow').click());
    const arrow = () =>
      annotations().find((annotation) => annotation.id === 'a-1') as unknown as { from: number[]; to: number[]; bend?: number };
    // Two mirrors in the Flip row, each named in full.
    const horizontal = button('Flip Horizontal')!;
    const vertical = button('Flip Vertical')!;
    expect(horizontal.querySelector('svg')).not.toBeNull();
    expect(vertical.textContent).toBe('');
    const past = state().diagramHistory.past.length;
    act(() => vertical.click());
    // About its middle: the same ends, bulging the other way.
    expect(arrow()).toMatchObject({ from: [0.1, 0.2], to: [0.5, 0.2], bend: -0.1 });
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Flip vertical');
    act(() => horizontal.click());
    expect(arrow().from[0]).toBeCloseTo(0.5, 12);
    expect(arrow().to[0]).toBeCloseTo(0.1, 12);
    expect(arrow().bend).toBe(0.1);
    expect(state().diagramHistory.past).toHaveLength(past + 2);
    // A label is its point, the same either way over.
    act(() => row('B').click());
    expect(button('Flip Horizontal')).toBeNull();
  });

  it('scales a close-up with Scale, by halves or to a hundredth, within its range, each one undo step (15f)', () => {
    const stepId = annotatedStep();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'z-1', kind: 'close-up', from: [0.5, 0.4], to: [1.2, 0.4], radius: 0.1, scale: 2 },
      ]);
      state().openDiagramStep(stepId, 'annotate');
    });
    act(() => row('Close-Up').click());
    const closeUp = () => annotations().find((annotation) => annotation.id === 'z-1') as Record<string, unknown>;
    const scale = host!.querySelector<HTMLInputElement>('input[aria-label="Scale"]')!;
    expect(scale.value).toBe('2');
    const past = state().diagramHistory.past.length;
    act(() => button('Increase Scale')!.click());
    expect(closeUp().scale).toBe(2.5);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Change close-up');
    act(() => scale.focus());
    setField(scale, '3.333');
    act(() => scale.blur());
    expect(closeUp().scale).toBe(3.33);
    act(() => scale.focus());
    setField(scale, '40');
    act(() => scale.blur());
    expect(closeUp().scale).toBe(6);
    // Nothing to flip, shape or put behind: its own controls are its scale and Delete.
    expect(buttonNamed('Flip')).toBeUndefined();
    expect(host!.querySelector('[role="group"][aria-label="Tail"]')).toBeNull();
  });

  it('puts an arrow’s tail and tip behind a flap and how deep, each one undo step, counted the first time (15e)', () => {
    tracked.trackDiagramAnnotationBehind.mockClear();
    const flat = { mode: 'folded-flat' as const, side: 'front' as const, rotationDeg: 0, foldCase: 1 };
    act(() => {
      useWorkspaceStore.setState({ diagram: { ...createDiagram({ newId: () => 'diagram-1' }), steps: [cpStep('step-f', flat)] } });
      state().editDiagramAnnotations('step-f', 'Add annotation', () => [
        { id: 'a-1', kind: 'valley-arrow', from: [0.1, 0.2], to: [0.5, 0.2], bend: 0.1 },
      ]);
      state().openDiagramStep('step-f', 'annotate');
    });
    act(() => row('Valley Fold Arrow').click());
    const side = (end: string, name: string) =>
      [...host!.querySelectorAll<HTMLButtonElement>(`[role="group"][aria-label="${end}"] button`)].find(
        (option) => option.textContent?.trim() === name
      )!;
    const arrow = () => stepsIn(state().diagram!)[0]!.annotations[0] as { behind?: unknown };
    expect(side('Tail', 'In Front').getAttribute('aria-pressed')).toBe('true');
    expect(host!.querySelector('input[aria-label="Under"]')).toBeNull();
    const past = state().diagramHistory.past.length;
    act(() => side('Tail', 'Behind').click());
    expect(arrow().behind).toEqual({ from: 1 });
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Change behind');
    expect(tracked.trackDiagramAnnotationBehind.mock.calls).toEqual([['valley_arrow', 'tail', '1']]);
    // How deep, for every end behind; the other end goes behind as deep.
    act(() => button('Increase Under')!.click());
    expect(arrow().behind).toEqual({ from: 2 });
    act(() => side('Tip', 'Behind').click());
    expect(arrow().behind).toEqual({ from: 2, to: 2 });
    act(() => side('Tail', 'In Front').click());
    expect(arrow().behind).toEqual({ to: 2 });
    // Counted once: when it first went behind.
    expect(tracked.trackDiagramAnnotationBehind).toHaveBeenCalledTimes(1);
    expect(host!.textContent).not.toContain('Only a folded picture knows its flaps.');
  });

  it('keeps a mark’s place in the folds off on a picture that knows no flaps, and says why (15e)', () => {
    const stepId = annotatedStep();
    act(() => state().openDiagramStep(stepId, 'annotate'));
    act(() => row('Valley Fold Arrow').click());
    const options = [...host!.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Tail"] button')];
    expect(options).toHaveLength(2);
    expect(options.every((option) => option.disabled)).toBe(true);
    expect(host!.textContent).toContain('Only a folded picture knows its flaps.');
  });

  it('turns a right angle a quarter clockwise with Turn 90°, as one undo step', () => {
    const stepId = annotatedStep();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'a-4', kind: 'right-angle', from: [0.3, 0.3], to: [0.32, 0.3] },
      ]);
      state().openDiagramStep(stepId, 'annotate');
    });
    act(() => row('Right Angle').click());
    expect(buttonNamed('Flip Arc')).toBeUndefined();
    const past = state().diagramHistory.past.length;
    act(() => buttonNamed('Turn 90°').click());
    const turned = annotations()[3] as unknown as { from: [number, number]; to: [number, number] };
    // Opening right, now down: clockwise on the page, about its corner.
    expect(turned.from).toEqual([0.3, 0.3]);
    expect(turned.to[0]).toBeCloseTo(0.3, 12);
    expect(turned.to[1]).toBeCloseTo(0.32, 12);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
  });

  it('sets a white arrow’s width and tail, each one undo step, and shows the template’s for one that says none', () => {
    const stepId = annotatedStep();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'w-1', kind: 'white-arrow', from: [0.1, 0.6], to: [0.5, 0.6], path: [{ at: [0.1, 0.6] }, { at: [0.5, 0.6] }] },
      ]);
      state().openDiagramStep(stepId, 'annotate');
    });
    act(() => row('White Arrow').click());
    const options = (group: string) => [...host!.querySelectorAll<HTMLButtonElement>(`[role="group"][aria-label="${group}"] button`)];
    // Each option is a small arrow, named for a screen reader.
    const segment = (group: string, name: string) => options(group).find((option) => option.getAttribute('aria-label') === name)!;
    const checked = (group: string) =>
      options(group)
        .filter((option) => option.getAttribute('aria-pressed') === 'true')
        .map((option) => option.getAttribute('aria-label'));
    expect(checked('Width')).toEqual(['Regular']);
    expect(checked('Tail')).toEqual(['Pointed']);
    const past = state().diagramHistory.past.length;
    act(() => segment('Width', 'Wide').click());
    act(() => segment('Tail', 'Cleft').click());
    const white = annotations().find((annotation) => annotation.id === 'w-1') as { width?: string; tail?: string };
    expect(white).toMatchObject({ width: 'wide', tail: 'cleft' });
    expect(state().diagramHistory.past).toHaveLength(past + 2);
    expect(checked('Width')).toEqual(['Wide']);
    // Its verbs: Flip Arc, and no Reset while it is straight.
    expect(buttonNamed('Flip Arc')).toBeDefined();
    expect(buttonNamed('Reset Shape')).toBeUndefined();
  });

  it('fills a white arrow with ink with Fill and empties it again, each one undo step, a filled one listed as a Solid Arrow (15d)', () => {
    const stepId = annotatedStep();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'w-1', kind: 'white-arrow', from: [0.1, 0.6], to: [0.5, 0.6], path: [{ at: [0.1, 0.6] }, { at: [0.5, 0.6] }] },
      ]);
      state().openDiagramStep(stepId, 'annotate');
    });
    act(() => row('White Arrow').click());
    const fill = (name: string) =>
      [...host!.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Fill"] button')].find(
        (option) => option.getAttribute('aria-label') === name
      )!;
    // White, for one that says none.
    expect(fill('White').getAttribute('aria-pressed')).toBe('true');
    const past = state().diagramHistory.past.length;
    act(() => fill('Black').click());
    const arrow = () => annotations().find((annotation) => annotation.id === 'w-1') as Record<string, unknown>;
    expect(arrow().fill).toBe('black');
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(state().diagramHistory.past.at(-1)?.label).toBe('Change white arrow');
    // Named by its look in the list, and over its verbs.
    expect(row('Solid Arrow').getAttribute('aria-pressed')).toBe('true');
    expect(row('White Arrow')).toBeUndefined();
    act(() => fill('White').click());
    expect('fill' in arrow()).toBe(false);
    expect(row('White Arrow')).toBeDefined();
  });

  it('edits a label’s text in one line, and focuses it for a label just put down', async () => {
    const stepId = annotatedStep();
    act(() => state().openDiagramStep(stepId, 'annotate'));
    const { requestLabelFocus } = await import('../../diagram/annotate/labelFocus');
    act(() => {
      requestLabelFocus('a-2');
      state().selectDiagramAnnotation('a-2');
    });
    const field = host?.querySelector('textarea[maxlength="80"]') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(field);
    setField(field, 'C\nD');
    act(() => field.blur());
    expect(annotations()[1]!.text).toBe('C D');
  });

  it('edits a callout’s words as a label’s, focused for one just put down, and lists it by them', async () => {
    const stepId = annotatedStep();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'a-4', kind: 'callout', from: [0.2, 0.7], to: [0.6, 0.3], text: 'Repeat behind' },
      ]);
      state().openDiagramStep(stepId, 'annotate');
    });
    expect(row('Repeat behind')).toBeDefined();
    const { requestLabelFocus } = await import('../../diagram/annotate/labelFocus');
    act(() => {
      requestLabelFocus('a-4');
      state().selectDiagramAnnotation('a-4');
    });
    const field = host?.querySelector('textarea[maxlength="80"]') as HTMLTextAreaElement;
    expect(document.activeElement).toBe(field);
    expect(field.value).toBe('Repeat behind');
    setField(field, '裏側も\n同様に');
    act(() => field.blur());
    expect(annotations()[3]!.text).toBe('裏側も 同様に');
    expect(row('裏側も 同様に').getAttribute('aria-pressed')).toBe('true');
  });

  it('leaves what the tool in hand does to the tool window (decision 7)', () => {
    const stepId = annotatedStep();
    act(() => state().openDiagramStep(stepId, 'annotate'));
    const t = i18n.t.bind(i18n);
    for (const tool of ANNOTATE_TOOL_GROUPS.flatMap((group) => group.tools)) {
      act(() => state().setDiagramAnnotateTool(tool));
      expect(host?.textContent).not.toContain(annotateToolHelp(t, tool));
    }
    act(() => state().setDiagramAnnotateTool('edit-path'));
    expect(host?.textContent).not.toContain('Select a fold arrow or a white arrow to shape it.');
    // Its verbs on what is selected stay: the Snap switch, the list, Delete.
    act(() => state().selectDiagramAnnotation('a-2'));
    expect(host?.querySelector('button[role="switch"][aria-label="Snap to Picture"]')).not.toBeNull();
    expect(row('B').getAttribute('aria-pressed')).toBe('true');
    expect(buttonNamed('Delete')).toBeDefined();
  });

  it('offers the Snap switch in Annotate, for a finger, and remembers it as a preference', () => {
    const stepId = annotatedStep();
    const snapSwitch = () => host?.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Snap to Picture"]') ?? null;
    expect(snapSwitch()).toBeNull();
    act(() => state().openDiagramStep(stepId, 'annotate'));
    useSettingsStore.setState({ diagramAnnotateSnap: true });
    expect(snapSwitch()?.getAttribute('aria-checked')).toBe('true');
    // The key that puts a mark down freely follows the marks that snap, never
    // the arrows, which it does nothing to (review).
    const help = host?.querySelector('[data-field-help][aria-label^="Circles"]')?.getAttribute('aria-label');
    expect(help).toMatch(/nearby\. Hold (Cmd|Ctrl) to put one down anywhere\. Arrows go where they are drawn\.$/);
    const past = state().diagramHistory.past.length;
    act(() => snapSwitch()!.click());
    expect(useSettingsStore.getState().diagramAnnotateSnap).toBe(false);
    expect(snapSwitch()?.getAttribute('aria-checked')).toBe('false');
    expect(localStorage.getItem(storageKey(STORAGE_KEYS.diagramAnnotateSnap))).toBe('false');
    // A preference, not an edit: nothing to undo.
    expect(state().diagramHistory.past).toHaveLength(past);
    act(() => snapSwitch()!.click());
    expect(useSettingsStore.getState().diagramAnnotateSnap).toBe(true);
  });

  it('says when the picture changed under them, and keeps them on a press', () => {
    const stepId = annotatedStep();
    act(() => state().openDiagramStep(stepId, 'annotate'));
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"/>';
    act(() => {
      state().setDiagramStepPicture(stepId, { id: 'asset-2', kind: 'svg', svg, widthPx: 10, heightPx: 10, bytes: 1 });
    });
    expect(host?.textContent).toContain('The picture changed since these annotations were drawn.');
    act(() => buttonNamed('Keep Them Here').click());
    expect(host?.textContent).not.toContain('The picture changed');
  });

  describe('with Edit Path in hand', () => {
    const byLabel = (label: string) => host?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? null;
    const arrow = () => annotations()[0] as { id: string; bend?: number; path?: { at: number[]; type?: string }[] };

    it('keeps Edit Path in hand to shape what a row selects, offering node verbs only on what it shapes', () => {
      const stepId = annotatedStep();
      act(() => state().openDiagramStep(stepId, 'annotate'));
      act(() => state().setDiagramAnnotateTool('edit-path'));
      // A row pressed keeps Edit Path in hand, to shape what it selected.
      act(() => row('B').click());
      expect(state().diagramAnnotateTool).toBe('edit-path');
      expect(host?.textContent).not.toContain('Node');
      act(() => row('Valley Fold Arrow').click());
      expect(host?.textContent).toContain('2 nodes');
    });

    it('steps through the nodes, and adds, turns and deletes them, each one undo step', () => {
      const stepId = annotatedStep();
      act(() => state().openDiagramStep(stepId, 'annotate'));
      act(() => {
        state().selectDiagramAnnotation('a-1');
        state().setDiagramAnnotateTool('edit-path');
      });
      // The arc's two nodes, none selected: only the steppers act.
      expect(host?.textContent).toContain('2 nodes');
      expect(buttonNamed('Add Node').disabled).toBe(true);
      // Refusing, keeping the focus a press puts on it (`aria-disabled`).
      expect(buttonNamed('Reset Shape').getAttribute('aria-disabled')).toBe('true');
      act(() => byLabel('Next Node')!.click());
      expect(host?.textContent).toContain('Node 1 of 2');
      expect(arrow().bend).toBe(0.1);
      const past = state().diagramHistory.past.length;
      act(() => buttonNamed('Add Node').click());
      expect(arrow().path).toHaveLength(3);
      expect(host?.textContent).toContain('Node 2 of 3');
      act(() => buttonNamed('Corner').click());
      expect(arrow().path![1]!.type).toBe('corner');
      expect(buttonNamed('Corner').getAttribute('aria-checked') ?? buttonNamed('Corner').getAttribute('aria-pressed')).toBe('true');
      act(() => byLabel('Next Node')!.click());
      expect(host?.textContent).toContain('Node 3 of 3');
      // An end has no type to have.
      expect(buttonNamed('Smooth').disabled).toBe(true);
      act(() => buttonNamed('Delete Node').click());
      expect(arrow().path).toHaveLength(2);
      expect(host?.textContent).toContain('Node 2 of 2');
      expect(state().diagramHistory.past).toHaveLength(past + 3);
      act(() => buttonNamed('Reset Shape').click());
      expect(arrow().path).toBeUndefined();
      expect(host?.textContent).toContain('2 nodes');
      // Back on the arc: the node selected is none, and Delete takes the arrow, not a node.
      act(() => buttonNamed('Delete').click());
      expect(annotations().map((annotation) => annotation.id)).toEqual(['a-2', 'a-3']);
    });
  });
});
