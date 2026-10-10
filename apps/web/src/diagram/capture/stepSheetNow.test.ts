import { beforeEach, describe, expect, it, vi } from 'vitest';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { takeCpRegionFocus } from '../../cp-workspace/regions/regionFocusRequest';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { createDiagram, insertSteps, type DiagramCpRender, type DiagramCpSource } from '../document/diagramDocument';
import { cpStep, referencesStep } from '../document/diagramSteps.fixtures';
import { cpDocument, movedLines, TWO_SQUARES, twoSquaresSegmentation } from './capture.fixtures';
import { chooseStepCreases, creasesFingerprint } from './captureCreases';
import { openDiagramStepInReferences } from './referencesStepActions';
import { openDiagramStepInEdit } from './stepCaptureActions';

/** The segmentation the open pattern has: the moved one, once it moved. */
const artifacts = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../cp-workspace/cpSegmentationArtifacts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cp-workspace/cpSegmentationArtifacts')>()),
  peekCpSegmentationArtifacts: () => artifacts.current,
}));

const segmentation = twoSquaresSegmentation();
const [left] = resolveCpSegments(segmentation);
const scope = { kind: 'segment' as const, region: regionReferenceFor(left!) };
const RENDER: DiagramCpRender = { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 };
const choice = chooseStepCreases(cpDocument(), scope, segmentation);
if (choice.status !== 'found') throw new Error('the left square should be found');

const state = () => useWorkspaceStore.getState();
const dx = 2000.1;
const dy = -50.7;
const moved = twoSquaresSegmentation({ dx, dy });
const [movedLeft] = resolveCpSegments(moved);

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useLayoutStore.getState().activatePanel = vi.fn();
  useLayoutStore.getState().activateWorkspace = vi.fn();
  const linked = cpStep('step-cp');
  const diagram = insertSteps(
    createDiagram({ title: 'D' }),
    [
      { ...linked, source: { ...(linked.source as DiagramCpSource), scope, render: RENDER, fingerprint: creasesFingerprint(choice.creases, RENDER) } },
      referencesStep('step-r', { region: scope.region, fingerprint: choice.creases.drawnFingerprint }),
    ],
    0
  );
  // The pattern moved since: its lines, and the segmentation worked out for them.
  useWorkspaceStore.setState({
    diagram,
    oristudioCpDocument: { handle: 1, document: cpDocument(movedLines(TWO_SQUARES, dx, dy)), geometry: null } as unknown as OristudioCpDocumentState,
  });
  artifacts.current = moved;
  takeCpRegionFocus();
});

describe('a step’s verbs, after its pattern moved', () => {
  it('Open in Edit frames the sheet where it is now', () => {
    openDiagramStepInEdit('step-cp');
    expect(takeCpRegionFocus()).toEqual(movedLeft!.bounds);
  });

  it('Open in References opens on the sheet where it is now', () => {
    openDiagramStepInReferences('step-r');
    expect(state().referencesSheetRequest?.boundary).toEqual(movedLeft!.boundary);
  });

  it('go where it was when the segmentation is not worked out yet', () => {
    artifacts.current = null;
    openDiagramStepInEdit('step-cp');
    expect(takeCpRegionFocus()).toEqual(scope.region.bounds);
    openDiagramStepInReferences('step-r');
    expect(state().referencesSheetRequest?.boundary).toEqual(scope.region.boundary);
  });
});
