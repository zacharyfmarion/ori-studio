import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS,
  cpToolOptionKeysForGroups,
  cpToolSettingGroupsForOperation,
  evaluateOrieditaRatioExpression,
  formatOrieditaRatioHalf,
  parseOrieditaRatioHalfInput,
  ratioExpressionFromHalves,
} from './oristudioCpToolSettings';

describe('oristudioCpToolSettings', () => {
  it('uses Oriedita exact-ratio defaults for line ratio division', () => {
    const ratio = evaluateOrieditaRatioExpression(DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS.divisionRatio);

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
    expect(ratioExpressionFromHalves({ a: 1, b: 0, c: 0 }, { a: 0, b: 1, c: 2 })).toEqual(
      DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS.divisionRatio,
    );
  });

  it('maps operations to contextual option groups', () => {
    expect(cpToolSettingGroupsForOperation('LineSegmentDivision')).toEqual([
      'divide-mode',
      'division-count',
    ]);
    expect(cpToolSettingGroupsForOperation('LineSegmentRatioSet')).toEqual([
      'divide-mode',
      'division-ratio',
    ]);
    expect(cpToolSettingGroupsForOperation('ReplaceLineTypeSelect')).toEqual(['replace-line-type']);
    expect(cpToolSettingGroupsForOperation('FixInaccurate')).toEqual(['fix-precision']);
    expect(cpToolSettingGroupsForOperation('VoronoiCreate')).toEqual(['line-color', 'apply-lines']);
    expect(cpToolSettingGroupsForOperation('CircleChangeColor')).toEqual(['custom-circle-color']);
    expect(cpToolSettingGroupsForOperation('CircleDrawTangentLine')).toEqual([
      'line-color',
      'circle-select-help',
      'candidate-choice',
    ]);
    expect(cpToolSettingGroupsForOperation('CircleDrawInverted')).toEqual(['circle-select-help']);
    expect(cpToolSettingGroupsForOperation('CircleDrawConcentric')).toEqual(['circle-select-help']);
    expect(cpToolSettingGroupsForOperation('CircleDrawConcentricSelect')).toEqual([
      'circle-select-help',
      'candidate-choice',
    ]);
    expect(cpToolSettingGroupsForOperation('CircleDrawConcentricTwoCircleSelect')).toEqual([
      'circle-select-help',
    ]);
    expect(cpToolSettingGroupsForOperation('Text')).toEqual([]);
    expect(cpToolSettingGroupsForOperation('DisplayLengthBetweenPoints1')).toEqual(['measure']);
  });

  // Extend Line is one rail tool over two operations, and the panel follows the
  // resolved one. That the line-type readout is there in Active mode and gone in
  // Same mode falls out of `LINE_COLOR_OPERATION_IDS` holding only the first --
  // nothing in the panel branches on the mode.
  it('drops the line-type readout for the same-colour lengthen variant', () => {
    expect(cpToolSettingGroupsForOperation('LengthenCrease')).toEqual([
      'line-color',
      'lengthen-color-mode',
    ]);
    expect(cpToolSettingGroupsForOperation('LengthenCreaseSameColor')).toEqual([
      'lengthen-color-mode',
    ]);
  });

  it('includes line color and angle system settings for angle-restricted drawing', () => {
    expect(cpToolSettingGroupsForOperation('DrawCreaseAngleRestricted')).toEqual([
      'line-color',
      'angle-system',
      'candidate-choice',
    ]);
  });

  describe('cpToolOptionKeysForGroups', () => {
    it('names the options behind a group, so the reset can put them back', () => {
      expect(cpToolOptionKeysForGroups(['angle-system']).sort()).toEqual([
        'angleSystemAngles',
        'angleSystemDivider',
      ]);
      expect(cpToolOptionKeysForGroups(['fix-precision']).sort()).toEqual([
        'fixPrecision',
        'fixPrecisionUse22_5',
        'fixPrecisionUseBp',
      ]);
    });

    it('deduplicates across groups that share an option', () => {
      // Delete-by-type and erase-by-type both drive `customLineType`.
      expect(cpToolOptionKeysForGroups(['delete-line-type', 'erase-line-type'])).toEqual([
        'customLineType',
      ]);
    });

    it('yields nothing for groups that own no options', () => {
      expect(cpToolOptionKeysForGroups(['line-select-help', 'apply-lines', 'measure'])).toEqual([]);
      expect(cpToolOptionKeysForGroups([])).toEqual([]);
    });

    it('only names keys that exist on the options struct', () => {
      // The map is hand-maintained beside the switch that renders the controls;
      // a typo here would be a reset that silently misses a setting.
      const groups = [
        'angle-system',
        'division-count',
        'division-ratio',
        'replace-line-type',
        'delete-line-type',
        'erase-line-type',
        'fix-precision',
        'polygon-corners',
        'parallel-width',
        'candidate-choice',
        'custom-circle-color',
      ] as const;
      for (const key of cpToolOptionKeysForGroups([...groups])) {
        expect(DEFAULT_ORISTUDIO_CP_TOOL_OPTIONS).toHaveProperty(key);
      }
    });
  });
});
