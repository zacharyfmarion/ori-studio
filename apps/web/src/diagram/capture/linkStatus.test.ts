import { describe, expect, it } from 'vitest';
import { DEFAULT_FOLDED_3D_CAMERA } from '../../cp-workspace/folded/folded3dCamera';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import { sheetRegions } from '../../cp-workspace/sheets/cpSheetRegions';
import { DEFAULT_DIAGRAM_STYLE, type DiagramCpRender, type DiagramCpScope } from '../document/diagramDocument';
import { cpStep } from '../document/diagramSteps.fixtures';
import { referencesStep } from '../document/diagramSteps.fixtures';
import { cpDocument, movedLines, TWO_SQUARES, twoSquaresIndex, type FixtureLine } from './capture.fixtures';
import { chooseStepCreases, creasesFingerprint, drawnLinesFingerprint } from './captureCreases';
import { linkStatus, refreshKind } from './linkStatus';

const sheets = twoSquaresIndex();
const [left] = sheetRegions(sheets);
const regionScope: DiagramCpScope = { kind: 'segment', region: regionReferenceFor(left!) };

const FOLDED: DiagramCpRender = { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1 };
const CREASE_PATTERN: DiagramCpRender = { mode: 'crease-pattern', rotationDeg: 0 };
const VIEW = { yaw: 0.8, pitch: -0.9, zoom: 1.4 };
/** Every way of showing a sheet folded: each draws the sheet's aux lines on its paper. */
const FOLDED_RENDERS: DiagramCpRender[] = [
  FOLDED,
  { mode: 'folded-3d', side: 'front', camera: DEFAULT_FOLDED_3D_CAMERA },
  { mode: 'simulated', foldPercent: 0, view: VIEW },
  { mode: 'simulated', foldPercent: 60, view: VIEW },
];

/** The source a capture of `scope` from `document` would record. */
function linked(scope: DiagramCpScope, document = cpDocument(), render: DiagramCpRender = FOLDED, index = sheets) {
  const choice = chooseStepCreases(document, scope, index);
  if (choice.status !== 'found') throw new Error('the scope should be found');
  const drawnFingerprint = drawnLinesFingerprint(choice.creases, render);
  return {
    scope,
    render,
    fingerprint: creasesFingerprint(choice.creases, render),
    ...(drawnFingerprint ? { drawnFingerprint } : {}),
  };
}

/** The same link as a build before folded pictures kept their drawn lines saved it. */
function savedBefore(scope: DiagramCpScope, document = cpDocument(), render: DiagramCpRender = FOLDED, index = sheets) {
  const { drawnFingerprint: _drawn, ...source } = linked(scope, document, render, index);
  return source;
}

/** The left diagonal turned valley. */
const edited = () =>
  cpDocument(TWO_SQUARES.map((line, i): FixtureLine => (i === 7 ? [...line.slice(0, 4), 'Blue2'] as FixtureLine : line)));

describe('linkStatus', () => {
  it('reads a region current against the pattern it was captured from, and stale once its creases change', () => {
    const source = linked(regionScope);
    expect(linkStatus(source, cpDocument(), sheets)).toBe('current');
    expect(linkStatus(source, edited(), sheets)).toBe('stale');
  });

  // The aux line in the left square (line 10) folds nothing, but every
  // picture of the square draws it: a crease pattern among its lines, a fold
  // on its paper. Moving it changed the picture Refresh would take, while a
  // folded step read current with Refresh disabled (bug 2, since 2026-10-03).
  it('reads a region stale when an aux line it draws moves, shown as its crease pattern or folded', () => {
    const scope = regionScope;
    const movedAux = cpDocument(
      TWO_SQUARES.map((line, i): FixtureLine => (i === 9 ? [0, 60, 50, 60, 'Cyan3'] : line))
    );
    expect(linkStatus(linked(scope, cpDocument(), CREASE_PATTERN), movedAux, sheets)).toBe('stale');
    for (const render of FOLDED_RENDERS) {
      expect(linkStatus(linked(scope, cpDocument(), render), cpDocument(), sheets)).toBe('current');
      expect(linkStatus(linked(scope, cpDocument(), render), movedAux, sheets)).toBe('stale');
    }
  });

  // The first aux line on a sheet that had none: the case a fingerprint of
  // the folds alone can never see.
  it('reads a fold stale when an aux line is drawn on a sheet that had none, and not for one drawn on another sheet', () => {
    const bare = TWO_SQUARES.filter((_, i) => i !== 9);
    const bareSheets = twoSquaresIndex({ lines: bare });
    const withAux = (line: FixtureLine) => [...bare, line];
    const ownAux = withAux([20, 70, 40, 80, 'Cyan3']);
    const otherAux = withAux([170, 70, 190, 80, 'Cyan3']);
    for (const render of FOLDED_RENDERS) {
      const source = linked(regionScope, cpDocument(bare), render, bareSheets);
      expect(linkStatus(source, cpDocument(bare), bareSheets)).toBe('current');
      expect(linkStatus(source, cpDocument(ownAux), twoSquaresIndex({ lines: ownAux }))).toBe('stale');
      expect(linkStatus(source, cpDocument(otherAux), twoSquaresIndex({ lines: otherAux }))).toBe('current');
    }
  });

  // Saved links: a folded step saved before it kept its drawn lines never
  // said which aux lines its picture drew. It reads as it did, so opening a
  // file changes no step's status, and its next capture starts keeping them.
  it('compares a folded link saved before it kept its drawn lines by its folds alone, as it was saved', () => {
    const movedAux = cpDocument(
      TWO_SQUARES.map((line, i): FixtureLine => (i === 9 ? [0, 60, 50, 60, 'Cyan3'] : line))
    );
    for (const render of FOLDED_RENDERS) {
      const saved = savedBefore(regionScope, cpDocument(), render);
      expect(saved).not.toHaveProperty('drawnFingerprint');
      expect(linkStatus(saved, cpDocument(), sheets)).toBe('current');
      expect(linkStatus(saved, movedAux, sheets)).toBe('current');
      expect(linkStatus(saved, edited(), sheets)).toBe('stale');
    }
  });

  // A saved Defox view draws none of the pattern's lines: it keeps no drawn
  // lines, and an aux edit leaves it as it was.
  it('keeps no drawn lines for a crease pattern or a saved Defox view', () => {
    const movedAux = cpDocument(
      TWO_SQUARES.map((line, i): FixtureLine => (i === 9 ? [0, 60, 50, 60, 'Cyan3'] : line))
    );
    const defox: DiagramCpRender = { mode: 'defox', snapshot: '{}' };
    expect(linked(regionScope, cpDocument(), CREASE_PATTERN)).not.toHaveProperty('drawnFingerprint');
    expect(linked(regionScope, cpDocument(), defox)).not.toHaveProperty('drawnFingerprint');
    expect(linkStatus(linked(regionScope, cpDocument(), defox), movedAux, sheets)).toBe('current');
  });

  it('reads a sheet whose border is gone missing, before it reads it stale', () => {
    const source = linked(regionScope);
    expect(linkStatus(source, edited(), twoSquaresIndex({ left: false }))).toBe('missing');
  });

  it('cannot say with no pattern open, or a sheet before the index is ready', () => {
    expect(linkStatus(linked(regionScope), null, sheets)).toBe('unknown');
    expect(linkStatus(linked(regionScope), cpDocument(), null)).toBe('unknown');
  });
});

// The whole pattern selected and dragged: no crease changed (Zach, 2026-10-03:
// "Pattern missing everywhere" after a move).
describe('linkStatus after the pattern moved', () => {
  const dx = -503.7;
  const dy = 0.1 + 0.2;
  const movedDocument = (lines = TWO_SQUARES) => cpDocument(movedLines(lines, dx, dy));
  const movedSheets = twoSquaresIndex({ dx, dy });

  it('reads a linked step current, shown as its crease pattern or folded', () => {
    expect(linkStatus(linked(regionScope, cpDocument(), FOLDED), movedDocument(), movedSheets)).toBe('current');
    expect(linkStatus(linked(regionScope, cpDocument(), CREASE_PATTERN), movedDocument(), movedSheets)).toBe('current');
  });

  it('reads a References step current: its sheet moved, and no crease of it changed', () => {
    const choice = chooseStepCreases(cpDocument(), regionScope, sheets);
    if (choice.status !== 'found') throw new Error('found');
    const step = referencesStep('step-r', { region: regionScope.region, fingerprint: choice.creases.drawnFingerprint });
    if (step.source?.kind !== 'references-step') throw new Error('a References step');
    expect(linkStatus(step.source, movedDocument(), movedSheets)).toBe('current');
  });

  // A folded step is found by its folds, so an aux edit to a moved sheet is
  // an edit, not a lost sheet: Refresh rather than Relink.
  it('reads a fold stale, not missing, when its sheet moved and an aux line on it moved too', () => {
    const movedAux = movedDocument(TWO_SQUARES.map((line, i): FixtureLine => (i === 9 ? [0, 60, 50, 60, 'Cyan3'] : line)));
    for (const render of FOLDED_RENDERS) {
      expect(linkStatus(linked(regionScope, cpDocument(), render), movedDocument(), movedSheets)).toBe('current');
      expect(linkStatus(linked(regionScope, cpDocument(), render), movedAux, movedSheets)).toBe('stale');
    }
    // A crease pattern is found by every line it draws: moved and changed, it cannot be told which.
    expect(linkStatus(linked(regionScope, cpDocument(), CREASE_PATTERN), movedAux, movedSheets)).toBe('missing');
  });

  // D6: a card is fingerprinted on every line of its sheet when sent, and
  // nothing about that changes.
  it('reads a References step as before: stale for an aux edit in place, missing for one to a moved sheet', () => {
    const choice = chooseStepCreases(cpDocument(), regionScope, sheets);
    if (choice.status !== 'found') throw new Error('found');
    const step = referencesStep('step-r', { region: regionScope.region, fingerprint: choice.creases.drawnFingerprint });
    if (step.source?.kind !== 'references-step') throw new Error('a References step');
    const auxLine = (lines: FixtureLine[]) => lines.map((line, i): FixtureLine => (i === 9 ? [0, 60, 50, 60, 'Cyan3'] : line));
    expect(linkStatus(step.source, cpDocument(), sheets)).toBe('current');
    expect(linkStatus(step.source, cpDocument(auxLine(TWO_SQUARES)), sheets)).toBe('stale');
    expect(linkStatus(step.source, movedDocument(auxLine(TWO_SQUARES)), movedSheets)).toBe('missing');
  });

  it('reads it missing when it moved and changed beside a sheet of its shape, and stale when it changed in place', () => {
    // Moved, and its diagonal recoloured: two squares of the one shape, so it cannot be told which.
    const editedMoved = movedDocument(
      TWO_SQUARES.map((line, i): FixtureLine => (i === 7 ? ([...line.slice(0, 4), 'Blue2'] as FixtureLine) : line))
    );
    expect(linkStatus(linked(regionScope), editedMoved, movedSheets)).toBe('missing');
    // Edited where it is: out of date, as before.
    expect(linkStatus(linked(regionScope), edited(), sheets)).toBe('stale');
  });

  it('compares a step that keeps a fingerprint from before the change the old way', () => {
    const choice = chooseStepCreases(cpDocument(), regionScope, sheets);
    if (choice.status !== 'found') throw new Error('found');
    const old = { scope: regionScope, render: FOLDED, fingerprint: choice.creases.absolute.fingerprint };
    expect(linkStatus(old, cpDocument(), sheets)).toBe('current');
    expect(linkStatus(old, edited(), sheets)).toBe('stale');
  });
});

describe('refreshKind', () => {
  const style = DEFAULT_DIAGRAM_STYLE;
  const view = { yaw: 0.8, pitch: -0.9, zoom: 1.4 };

  it('sends a step out of date to Refresh, unless it is folded part way in the simulator: that is Pose’s', () => {
    const flat = cpStep('step-flat', { mode: 'crease-pattern', rotationDeg: 0 });
    const atZero = cpStep('step-zero', { mode: 'simulated', foldPercent: 0, view });
    const folded = cpStep('step-folded', { mode: 'simulated', foldPercent: 40, view });
    expect(refreshKind(flat, 'stale', style)).toBe('refresh');
    expect(refreshKind(atZero, 'stale', style)).toBe('refresh');
    expect(refreshKind(folded, 'stale', style)).toBe('pose');
  });

  it('leaves a step up to date, one whose link cannot be checked, and one not linked to the pattern', () => {
    const flat = cpStep('step-flat', { mode: 'crease-pattern', rotationDeg: 0 });
    expect(refreshKind(flat, 'current', style)).toBeNull();
    expect(refreshKind(flat, 'unknown', style)).toBeNull();
    expect(refreshKind(flat, 'missing', style)).toBeNull();
    expect(refreshKind({ ...flat, source: null }, 'stale', style)).toBeNull();
  });
});
