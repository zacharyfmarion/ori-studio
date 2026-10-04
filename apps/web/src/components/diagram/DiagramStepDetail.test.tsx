import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { DiagramLinkedPose } from '../../diagram/capture/useDiagramLinkedPose';
import { DEFAULT_DIAGRAM_STYLE, type DiagramStep } from '../../diagram/document/diagramDocument';
import { storedSceneJson } from '../../diagram/document/diagramFile';
import { cpStep, scenePicture } from '../../diagram/document/diagramSteps.fixtures';
import { sheetWithCrease } from '../../lib/paper/paperScene.fixtures';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramStepDetail } from './DiagramStepDetail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

const FLAT = { mode: 'folded-flat' as const, side: 'front' as const, rotationDeg: 0, foldCase: 1 };

/** A linked step's Pose with nothing to offer but, maybe, a preview. */
function linkedPose(preview: DiagramStep | null): DiagramLinkedPose {
  return {
    actions: [],
    layerOrder: null,
    spatial: null,
    onCamera: () => {},
    rotateTo: () => {},
    showAs: async () => true,
    simulate: async () => {},
    wantsRest: () => false,
    spread: null,
    preview,
  };
}

function show(step: DiagramStep, preview: DiagramStep | null, mode: 'pose' | 'annotate' = 'pose') {
  host ??= document.body.appendChild(document.createElement('div'));
  root ??= createRoot(host);
  act(() =>
    root!.render(
      <TooltipProvider>
        <DiagramStepDetail
          step={step}
          assets={{}}
          style={DEFAULT_DIAGRAM_STYLE}
          number={1}
          count={1}
          readOnly={false}
          mode={mode}
          onMode={() => {}}
          annotateTool={null}
          onAnnotateTool={() => {}}
          poseActions={[]}
          linkedPose={linkedPose(preview)}
          onBack={() => {}}
          onStep={() => {}}
          onUpload={() => {}}
          patternOpen
          onLink={() => {}}
          onFromReferences={() => {}}
          onGoToEdit={() => {}}
          dropping={false}
          drawerSlot={createRef()}
        />
      </TooltipProvider>
    )
  );
  return host.querySelector<HTMLImageElement>('img')?.src ?? null;
}

describe('DiagramStepDetail in Pose', () => {
  it('shows a spread being dragged in the step’s place, and the step again once it ends (Phase 13)', () => {
    const step = cpStep('step-1', FLAT);
    const spread = { ...sheetWithCrease(), items: [...sheetWithCrease().items].reverse() };
    const preview: DiagramStep = {
      ...cpStep('step-1', { ...FLAT, spread: { amount: 0.1, toward: 'up-left' } }),
      picture: { ...scenePicture('scene-preview'), sceneJson: storedSceneJson(spread)! },
    };
    const own = show(step, null);
    expect(own).toMatch(/^data:image\/svg\+xml/);
    const previewed = show(step, preview);
    expect(previewed).not.toBe(own);
    expect(show(step, null)).toBe(own);
  });
});
