import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS,
  cpToolSettingGroupsForOperation,
  evaluateOrieditaRatioExpression,
  formatOrieditaRatioHalf,
  parseOrieditaRatioHalfInput,
  ratioExpressionFromHalves,
} from './oristudioCpToolSettings';

describe('oristudioCpToolSettings', () => {
  it('uses Oriedita exact-ratio defaults for line ratio division', () => {
    const ratio = evaluateOrieditaRatioExpression(
      DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS.divisionRatio
    );

    expect(ratio.ratioS).toBe(1);
    expect(ratio.ratioT).toBeCloseTo(Math.sqrt(2));
  });

  it('formats and parses the friendly exact-ratio input syntax', () => {
    expect(formatOrieditaRatioHalf({ a: 0, b: 1, c: 2 })).toBe('sqrt(2)');
    expect(formatOrieditaRatioHalf({ a: 1, b: 2, c: 3 })).toBe('1 + 2*sqrt(3)');
    expect(parseOrieditaRatioHalfInput('sqrt(2)')).toEqual({ a: 0, b: 1, c: 2 });
    expect(parseOrieditaRatioHalfInput('1 + 2sqrt(3)')).toEqual({ a: 1, b: 2, c: 3 });
    expect(parseOrieditaRatioHalfInput('2')).toEqual({ a: 2, b: 0, c: 0 });
    expect(parseOrieditaRatioHalfInput('sqrt(-2)')).toBeNull();
  });

  it('builds ratio expressions from left and right halves', () => {
    expect(
      ratioExpressionFromHalves(
        { a: 1, b: 0, c: 0 },
        { a: 0, b: 1, c: 2 }
      )
    ).toEqual(DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS.divisionRatio);
  });

  it('maps operations to contextual option groups', () => {
    expect(cpToolSettingGroupsForOperation('LineSegmentDivision')).toEqual([
      'division-count',
    ]);
    expect(cpToolSettingGroupsForOperation('LineSegmentRatioSet')).toEqual([
      'division-ratio',
    ]);
    expect(cpToolSettingGroupsForOperation('ReplaceLineTypeSelect')).toEqual([
      'replace-line-type',
    ]);
    expect(cpToolSettingGroupsForOperation('FixInaccurate')).toEqual(['fix-precision']);
    expect(cpToolSettingGroupsForOperation('VoronoiCreate')).toEqual([
      'line-color',
      'apply-lines',
    ]);
    expect(cpToolSettingGroupsForOperation('CircleChangeColor')).toEqual([
      'custom-circle-color',
    ]);
    expect(cpToolSettingGroupsForOperation('CircleDrawTangentLine')).toEqual([
      'line-color',
      'circle-select-help',
      'candidate-choice',
    ]);
    expect(cpToolSettingGroupsForOperation('CircleDrawInverted')).toEqual([
      'circle-select-help',
    ]);
    expect(cpToolSettingGroupsForOperation('CircleDrawConcentric')).toEqual([
      'circle-select-help',
    ]);
    expect(cpToolSettingGroupsForOperation('CircleDrawConcentricSelect')).toEqual([
      'circle-select-help',
      'candidate-choice',
    ]);
    expect(cpToolSettingGroupsForOperation('CircleDrawConcentricTwoCircleSelect')).toEqual([
      'circle-select-help',
    ]);
    expect(cpToolSettingGroupsForOperation('Text')).toEqual([]);
    expect(cpToolSettingGroupsForOperation('DisplayLengthBetweenPoints1')).toEqual([
      'measurement-readout',
    ]);
  });

  it('includes line color and angle system settings for angle-restricted drawing', () => {
    expect(cpToolSettingGroupsForOperation('DrawCreaseAngleRestricted')).toEqual([
      'line-color',
      'angle-system',
      'candidate-choice',
    ]);
  });
});
