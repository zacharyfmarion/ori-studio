import { describe, expect, it } from 'vitest';
import type { FoldLandmarks } from '../../engine/foldEngineWire';
import { FOLD_TOOL_INITIAL, type FoldToolState } from '../../tools/foldToolState';
import { bookScene } from '../foldCanvas.fixtures';
import { foldPickIndex } from '../foldPicking';
import { swivelMeetingMarks, swivelMeetingPick, swivelMeetings } from './swivelMeeting';

/** The book's landmarks: its folded edge, x = 0.5, shown along `visible`. */
function bookLandmarks(visible: [number, number][] = [[0, 1]]): FoldLandmarks {
  return {
    points: [],
    lines: [{ line: { n: [1, 0], d: 0.5 }, segments: [0], visible: true }],
    segments: [{ edge: 6, kind: 'bend', sheet: { a: [0.5, 0], b: [0.5, 1] }, at: [[0.5, 0], [0.5, 1]], line: 0, visible }],
  };
}

/** A valley crossing the folded edge at y = 0.3, running down and right at 22.5° off the vertical. */
const s = Math.sin(Math.PI / 8);
const c = Math.cos(Math.PI / 8);
const valley = { n: [c, s] as [number, number], d: c * 0.5 + s * 0.3 };

const inks = { accent: [0, 0, 1, 1] as [number, number, number, number], outline: [1, 1, 1, 1] as [number, number, number, number] };

describe('a swivel’s meeting points', () => {
  it('are where its valley crosses a folded edge the pane shows, exactly', () => {
    const index = foldPickIndex(bookScene(), bookLandmarks(), []);
    const [meeting, ...rest] = swivelMeetings(index, valley);
    expect(rest).toEqual([]);
    expect(meeting?.pick).toMatchObject({ kind: 'point', pane: 'folded', provenance: 'fold', mark: null });
    // On the valley and on the folded edge to the last bit: the engine meets the two lines there.
    const [x, y] = meeting?.pick.sheet ?? [NaN, NaN];
    expect(Math.abs(c * x + s * y - valley.d)).toBeLessThan(1e-15);
    expect(x).toBe(0.5);
    expect(y).toBeCloseTo(0.3, 14);
    // Asked again with the same valley, the same answer: once per valley.
    expect(swivelMeetings(index, valley)).toBe(swivelMeetings(index, valley));
  });

  it('are none where a layer hides the folded edge, or past its ends', () => {
    expect(swivelMeetings(foldPickIndex(bookScene(), bookLandmarks([[0.5, 1]]), []), valley)).toEqual([]);
    const past = { n: [c, s] as [number, number], d: c * 0.5 + s * 1.2 };
    expect(swivelMeetings(foldPickIndex(bookScene(), bookLandmarks(), []), past)).toEqual([]);
  });

  it('take a click near one, as the click’s step takes a point: a reference, or a free line’s end', () => {
    const meetings = swivelMeetings(foldPickIndex(bookScene(), bookLandmarks(), []), valley);
    const near = { x: 0.51, y: 0.31 };
    const reference = swivelMeetingPick(meetings, 'folded', near, 0.05, 'point');
    expect(reference).toMatchObject({ kind: 'point', provenance: 'fold' });
    const end = swivelMeetingPick(meetings, 'folded', near, 0.05, 'free');
    expect(end).toMatchObject({ kind: 'free', pane: 'folded' });
    if (end?.kind !== 'free' || reference?.kind !== 'point') throw new Error('no meeting');
    expect(end.sheet).toEqual(reference.sheet);
    expect(end.scene).toEqual(reference.scene);
    // Beyond reach, on the crease pattern, or for a click that takes a line: nothing.
    expect(swivelMeetingPick(meetings, 'folded', { x: 0.6, y: 0.3 }, 0.05, 'point')).toBeNull();
    expect(swivelMeetingPick(meetings, 'crease-pattern', near, 0.05, 'point')).toBeNull();
    expect(swivelMeetingPick(meetings, 'folded', near, 0.05, 'crease-required')).toBeNull();
  });

  it('are dotted while the mountain is located, the valley taken, and for no other tool', () => {
    const index = foldPickIndex(bookScene(), bookLandmarks(), []);
    const line = { line: { via: 'free' as const, through: [[0.5, 0.3], [0.6, 0.06]] as [[number, number], [number, number]] }, sceneLine: valley };
    const swivel: FoldToolState = { ...FOLD_TOOL_INITIAL, tool: 'swivel', swivelInput: 'valley-mountain', takenLine: line };
    const marks = swivelMeetingMarks(index, swivel, inks);
    expect(marks?.dots).toHaveLength(1);
    expect(marks?.dots[0]?.at.x).toBe(0.5);
    expect(swivelMeetingMarks(index, { ...swivel, takenLine: undefined }, inks)).toBeNull();
    expect(swivelMeetingMarks(index, { ...swivel, tool: 'squash' }, inks)).toBeNull();
    expect(swivelMeetingMarks(index, swivel, null)).toBeNull();
  });
});
