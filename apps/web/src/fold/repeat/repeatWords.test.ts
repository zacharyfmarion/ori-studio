import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import type { FoldRefusalBody } from '../engine/foldEngineWire';
import { foldRefusalNotice } from '../tools/refusalNotice';
import { repeatAxisName, repeatFailure, type RepeatRemedies } from './repeatWords';

const t = i18n.t.bind(i18n);

/** The tool window's words for a refusal, as a valley fold's window shows them. */
function toolWindow(refusal: FoldRefusalBody): { title: string; text: string } {
  return foldRefusalNotice(
    t,
    { refusal, fixes: [] },
    { kind: 'valley', flapNumber: (flap) => flap + 1, flapOf: null, readOnly: false },
    { includeFlaps: () => {}, foldOtherWay: () => {}, pickFlap: () => {}, useLine: () => {} }
  );
}

const BOTH: RepeatRemedies = { otherAxis: true, laterStart: true };

describe("Repeat's refusal words", () => {
  it("says a mirrored fold's refusal of its own picks about the mirror, never with the tool's advice", () => {
    const cases = [
      ['witness_not_in_face', 'Pick inside a layer'],
      ['seed_not_on_moving_side', 'Pick inside a layer'],
      ['free_line_too_short', 'Pick two points farther apart'],
      ['nothing_stays', 'Pick a flap to fold'],
      ['no_root', 'Pick other references'],
      ['no_moving_side', 'Swap the moving side'],
    ] as const;
    for (const [code, toolAdvice] of cases) {
      const refusal = { code } as FoldRefusalBody;
      const words = repeatFailure(t, { code, refusal, op: 'valley' }, BOTH);
      expect(toolWindow(refusal).text).toContain(toolAdvice);
      expect(words).not.toContain(toolAdvice);
      expect(words).toContain('mirrored');
      expect(words).not.toContain(code);
      expect(words.endsWith('Try another axis, or start the range after this operation.')).toBe(true);
    }
    expect(
      repeatFailure(t, { code: 'witness_not_in_face', refusal: { code: 'witness_not_in_face' } as FoldRefusalBody }, BOTH)
    ).toBe(
      'The spot the mirrored fold picks is not inside a layer on the moving side. Try another axis, or start the range after this operation.'
    );
  });

  it("keeps the tool window's words where they are a reason alone", () => {
    const refusal = { code: 'layer_order' } as FoldRefusalBody;
    expect(repeatFailure(t, { code: 'layer_order', refusal, op: 'valley' }, BOTH)).toBe(
      `${toolWindow(refusal).text} Try another axis, or start the range after this operation.`
    );
  });

  it("says the rest by the tool window's headline, without the tool's advice", () => {
    const refusal = { code: 'reverse_tip_not_free', blocking: [1], faces: [2] } as FoldRefusalBody;
    const words = repeatFailure(t, { code: refusal.code, refusal, op: 'inside-reverse' }, BOTH);
    expect(words).toBe('Layers are in the way. Try another axis, or start the range after this operation.');
    expect(words).not.toContain('Include their flaps');
  });

  it('adds no second stop to a headline that asks a question', () => {
    const refusal = { code: 'fan_stayer_detached' } as FoldRefusalBody;
    expect(repeatFailure(t, { code: refusal.code, refusal, op: 'swivel' }, BOTH)).toBe(
      'Which paper stays? Try another axis, or start the range after this operation.'
    );
  });

  it('says a closure that takes more flaps without numbering flaps no chip shows', () => {
    const refusal = { code: 'closure_adds_flaps', added: [2] } as FoldRefusalBody;
    const words = repeatFailure(t, { code: refusal.code, refusal });
    expect(words).toBe('Folding the mirrored layers would move other flaps too. Fold the other side with the tools instead.');
    expect(words).not.toContain('flap 3');
  });

  it('advises only what the bar can change: another axis, a later start, else the tools', () => {
    const refusal = { code: 'layer_order' } as FoldRefusalBody;
    const advice = (remedies: RepeatRemedies) =>
      repeatFailure(t, { code: 'layer_order', refusal }, remedies).slice(toolWindow(refusal).text.length + 1);
    expect(advice({ otherAxis: true, laterStart: true })).toBe('Try another axis, or start the range after this operation.');
    expect(advice({ otherAxis: true, laterStart: false })).toBe('Try another axis, or fold the other side with the tools.');
    expect(advice({ otherAxis: false, laterStart: true })).toBe(
      'Start the range after this operation, or fold the other side with the tools.'
    );
    expect(advice({ otherAxis: false, laterStart: false })).toBe('Fold the other side with the tools instead.');
    // Nothing advises showing the steps individually: that changes how a repeat is saved, not whether it folds.
    expect(advice(BOTH)).not.toMatch(/individual/i);
  });

  it('says a refusal it was not handed no code at all', () => {
    const words = repeatFailure(t, { code: 'layer_order' });
    expect(words).not.toContain('layer_order');
    expect(words).toBe(
      'The mirrored operation cannot be folded. No steps were added. Fold the other side with the tools instead.'
    );
  });

  it("keeps Repeat's own reasons in its own words, advising where they did not", () => {
    expect(repeatFailure(t, { code: 'repeat_limit' }, BOTH)).toBe('This repeat exceeds the search limit. Try a shorter range.');
    expect(repeatFailure(t, { code: 'repeat_order' }, BOTH)).toBe(
      'The original layer relationships cannot be preserved on the other side. Try another axis, or start the range after this operation.'
    );
  });

  it('names a symmetry axis by where it runs on the paper, as the crease pattern shows it, whichever way its normal points', () => {
    const s = Math.SQRT1_2;
    const name = (n: [number, number]) => repeatAxisName(t, { n, d: 0.5 });
    expect(name([1, 0])).toBe('Center line, top to bottom');
    expect(name([-1, 0])).toBe('Center line, top to bottom');
    expect(name([0, 1])).toBe('Center line, left to right');
    expect(name([0, -1])).toBe('Center line, left to right');
    // y up, as the crease pattern pane shows the sheet: the line y = x runs from the bottom left corner to the top right.
    expect(name([s, -s])).toBe('Diagonal, bottom left to top right');
    expect(name([-s, s])).toBe('Diagonal, bottom left to top right');
    expect(name([s, s])).toBe('Diagonal, top left to bottom right');
    // Any other, by its angle from the horizontal.
    expect(name([-Math.sin(Math.PI / 6), Math.cos(Math.PI / 6)])).toBe('Line through the center at 30°');
  });

  it("says a sink's refusal by the sink tool's headline", () => {
    const refusal = { code: 'no_order' } as FoldRefusalBody;
    expect(repeatFailure(t, { code: 'no_order', refusal, op: 'unsink' })).toBe(
      'The point cannot come back out here. Fold the other side with the tools instead.'
    );
  });
});
