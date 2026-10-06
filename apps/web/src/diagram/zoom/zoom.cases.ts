import type { DiagramAsset, DiagramStep, DiagramStepZoom, KnownDiagramAnnotation } from '../document/diagramDocument';
import { createStep } from '../document/diagramDocument';
import { referencesStep } from '../document/diagramSteps.fixtures';
import { craneStep } from './zoom.fixtures';

/**
 * Enlarged steps as the goldens draw them (16d): each an enlarged step — its
 * frame stored as a capture leaves it, in its picture's units, and a few
 * marks in its window's — and, where its look has one, the step before it
 * with the area it was enlarged from.
 *
 * - `look-1`: Zach's look 1 on the crane's flat fold (`S.none`): a circle
 *   round the head's tip, cut where it crosses the paper.
 * - `look-2`: Zach's look 2: a rounded rectangle inside the body, drawn
 *   whole, and the step before with the area on its white casing.
 * - `turned`: a rounded rectangle landed at an angle, as a face turned it.
 * - `upload`: an upload, whose picture has no paper to cut along: drawn
 *   whole though its circle says Cut.
 * - `references`: a References card, rebuilt at its enlarged size, its circle
 *   cut where it leaves the sheet.
 */
export interface ZoomCase {
  id: string;
  step: DiagramStep;
  /** The step the area is on, when the case has one. */
  before?: DiagramStep;
  assets: Readonly<Record<string, DiagramAsset>>;
}

const MARKS: KnownDiagramAnnotation[] = [
  { id: 'mark-valley', kind: 'valley-line', from: [0.15, 0.62], to: [0.85, 0.62] },
  { id: 'mark-label', kind: 'label', from: [0.5, 0.3], to: [0.5, 0.3], text: 'A' },
];

function enlarged(step: DiagramStep, zoom: DiagramStepZoom, id: string): DiagramStep {
  return { ...step, id, zoom, annotations: MARKS, annotatedPictureKey: step.picture?.key ?? null };
}

const UPLOAD: DiagramAsset = {
  id: 'asset-upload',
  kind: 'svg',
  svg:
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">' +
    '<path d="M40 260L200 30L360 260Z" fill="#f4d8b0" stroke="#231f20" stroke-width="2"/>' +
    '<path d="M200 30L200 260" stroke="#231f20" stroke-dasharray="6 4"/></svg>',
  widthPx: 400,
  heightPx: 300,
  bytes: 0,
};

function uploadStep(): DiagramStep {
  return {
    ...createStep(() => 'step-upload'),
    source: { kind: 'upload', assetId: UPLOAD.id, rotationQuarterTurns: 0, mirrored: false },
    picture: { kind: 'asset', assetId: UPLOAD.id, paperScale: null, key: UPLOAD.id },
  };
}

const crane = craneStep('S.none');

export const ZOOM_CASES: readonly ZoomCase[] = [
  {
    id: 'look-1',
    step: enlarged(crane, { from: 'area-1', shape: 'circle', frame: { centre: [0.37, 0.13], radius: 0.13 } }, 'step-look-1'),
    before: {
      ...crane,
      id: 'step-area-1',
      annotations: [{ id: 'area-1', kind: 'zoom', from: [0.37, 0.13], to: [0.37, 0.13], radius: 0.13 }],
      annotatedPictureKey: crane.picture?.key ?? null,
    },
    assets: {},
  },
  {
    id: 'look-2',
    step: enlarged(crane, { from: 'area-2', shape: 'rounded', frame: { centre: [0.37, 0.76], size: [0.34, 0.24] } }, 'step-look-2'),
    before: {
      ...crane,
      id: 'step-area-2',
      annotations: [{ id: 'area-2', kind: 'zoom', from: [0.37, 0.76], to: [0.37, 0.76], size: [0.34, 0.24] }],
      annotatedPictureKey: crane.picture?.key ?? null,
    },
    assets: {},
  },
  {
    id: 'turned',
    step: enlarged(
      crane,
      { from: 'area-3', shape: 'rounded', frame: { centre: [0.37, 0.52], size: [0.3, 0.18], angle: 30 } },
      'step-turned'
    ),
    assets: {},
  },
  {
    id: 'upload',
    step: enlarged(
      uploadStep(),
      { from: 'area-4', shape: 'circle', frame: { centre: [0.5, 0.36], radius: 0.18 }, edge: 'cut' },
      'step-upload'
    ),
    assets: { [UPLOAD.id]: UPLOAD },
  },
  {
    id: 'references',
    step: enlarged(
      referencesStep('step-references'),
      { from: 'area-5', shape: 'circle', frame: { centre: [0.85, 0.5], radius: 0.3 } },
      'step-references'
    ),
    assets: {},
  },
];
