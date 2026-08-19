import { describe, expect, it } from 'vitest';
import { DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS } from '../../lib/oristudioCpToolSettings';
import {
  convertSquareSize,
  resolveCpToolLineColor,
  squareAnchorPayload,
  squareExtentInModelUnits,
  squareOrientationPayload,
} from './squareTool';

// 400 / 16 — a 16-division grid, the common box-pleating case.
const GRID_WIDTH = 25;

describe('square size units', () => {
  it('measures grid sizes in cells', () => {
    expect(squareExtentInModelUnits(4, 'grid', GRID_WIDTH)).toBe(100);
    expect(squareExtentInModelUnits(16, 'grid', GRID_WIDTH)).toBe(400);
  });

  it('measures paper sizes in edges', () => {
    expect(squareExtentInModelUnits(1, 'paper', GRID_WIDTH)).toBe(400);
    expect(squareExtentInModelUnits(0.25, 'paper', GRID_WIDTH)).toBe(100);
  });

  /**
   * A document with no grid metadata still has to produce a square of some size.
   * Falling back to the paper edge gives a visible one; falling back to zero
   * would give a tool that silently does nothing.
   */
  it('falls back to the paper edge when there is no usable grid width', () => {
    for (const gridWidth of [undefined, 0, -1, Number.NaN]) {
      expect(squareExtentInModelUnits(1, 'grid', gridWidth)).toBe(400);
    }
  });
});

describe('switching the size unit', () => {
  it('keeps the square the same size', () => {
    expect(convertSquareSize(4, 'grid', 'paper', GRID_WIDTH)).toBe(0.25);
    expect(convertSquareSize(0.25, 'paper', 'grid', GRID_WIDTH)).toBe(4);
  });

  it('round-trips', () => {
    const asPaper = convertSquareSize(6, 'grid', 'paper', GRID_WIDTH);
    expect(convertSquareSize(asPaper, 'paper', 'grid', GRID_WIDTH)).toBe(6);
  });

  it('is a no-op for the same unit', () => {
    expect(convertSquareSize(7.5, 'grid', 'grid', GRID_WIDTH)).toBe(7.5);
  });

  /**
   * The regression this rounding exists for: 1/3 of the paper edge back and
   * forth used to surface as 3.9999999996 in the stepper.
   */
  it('does not leak float dust into the control', () => {
    const converted = convertSquareSize(1 / 3, 'paper', 'grid', GRID_WIDTH);
    expect(converted).toBe(5.3333);
    expect(String(converted).split('.')[1]?.length ?? 0).toBeLessThanOrEqual(4);
  });
});

describe('kernel payload shape', () => {
  it('maps orientations', () => {
    expect(squareOrientationPayload('normal')).toBe('Normal');
    expect(squareOrientationPayload('diagonal')).toBe('Diagonal');
  });

  it('maps every anchor cell', () => {
    expect(squareAnchorPayload('top-left')).toBe('TopLeft');
    expect(squareAnchorPayload('middle-right')).toBe('MiddleRight');
    expect(squareAnchorPayload('center')).toBe('Center');
    expect(squareAnchorPayload('bottom-center')).toBe('BottomCenter');
  });
});

describe('resolved tool line colour', () => {
  const withLineType = (squareLineType: 'edge' | 'active') => ({
    ...DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS,
    squareLineType,
  });

  it('gives Square its own line type', () => {
    expect(resolveCpToolLineColor('SquareGenerate', withLineType('edge'), 'Red1')).toBe('Black0');
    expect(resolveCpToolLineColor('SquareGenerate', withLineType('active'), 'Red1')).toBe('Red1');
  });

  /**
   * The whole point of the helper: every other tool must be untouched, or a
   * square-specific param would start deciding unrelated creases' colours.
   */
  it('leaves every other tool on the active colour', () => {
    expect(resolveCpToolLineColor('DrawCreaseFree', withLineType('edge'), 'Red1')).toBe('Red1');
    expect(resolveCpToolLineColor('PolygonSetNoCorners', withLineType('edge'), 'Blue2')).toBe(
      'Blue2',
    );
    expect(resolveCpToolLineColor(undefined, withLineType('edge'), 'Blue2')).toBe('Blue2');
  });
});
