import { describe, expect, it } from 'vitest';
import { LESSONS } from './index';
import { SHORTCUT_DEFINITIONS } from '../../keyboard/shortcuts';

/**
 * The lessons quote keyboard shortcuts in prose, because telling someone the key
 * is most of what makes a tool stick. Prose cannot be generated from the
 * registry — the keys are woven into sentences — so this asserts the other
 * direction: every shortcut the tutorial *claims* is still the registry's
 * default. Rebinding a default now fails here, naming the lesson text to update,
 * rather than leaving the tutorial quietly teaching the wrong key.
 *
 * These are defaults; a user who rebinds sees their own keys in the app and the
 * tutorial's prose will be stale for them. That is a deliberate trade — stating
 * the default plainly reads far better than hedging every mention.
 */
const CLAIMED_SHORTCUTS: ReadonlyArray<{ label: string; key: string; why: string }> = [
  { label: 'Mountain', key: 'a', why: 'line-types and first-crease tell the user to press A' },
  { label: 'Valley', key: 's', why: 'line-types, snapping-and-grid and the construct chapter press S' },
  { label: 'Edge', key: 'd', why: 'auxiliary-lines lists D for the paper edge' },
  { label: 'Auxiliary', key: 'f', why: 'auxiliary-lines lists F' },
  { label: 'Line', key: 'z', why: 'the drawing steps press Z for the segment tool' },
  { label: 'Box Select', key: 'q', why: 'select-and-delete and mirroring press Q' },
  { label: 'Flip Mountain/Valley', key: 'c', why: 'line-types fixes the vertex with C' },
  { label: 'Perpendicular Line', key: 'y', why: 'the perpendiculars lesson presses Y' },
  { label: 'Angle Bisector', key: 'b', why: 'the angle-bisectors lesson presses B' },
  { label: 'Fold estimate', key: 'g', why: 'both folding steps press G' },
  { label: 'Pan (hand tool)', key: '1', why: 'the-canvas offers 1 as an alternative to Cmd-drag' },
];

function chordFor(label: string) {
  const definition = SHORTCUT_DEFINITIONS.find((entry) => entry.label === label);
  return definition?.defaultChord ?? null;
}

describe('shortcuts the lessons teach', () => {
  it.each(CLAIMED_SHORTCUTS.map((claim) => [claim.label, claim] as const))(
    '%s is still the default the prose quotes',
    (_label, claim) => {
      const chord = chordFor(claim.label);
      expect(chord, `no shortcut named "${claim.label}" — ${claim.why}`).toBeTruthy();
      expect(chord?.key, `${claim.why}`).toBe(claim.key);
      // A bare letter: the prose says "press A", so a modifier would make it wrong.
      expect(chord?.primary ?? false, `${claim.label} gained a modifier`).toBe(false);
      expect(chord?.shift ?? false, `${claim.label} gained shift`).toBe(false);
    }
  );

  it('quotes the viewport chords the canvas lesson lists', () => {
    for (const [label, key] of [
      ['Zoom In', '='],
      ['Zoom Out', '-'],
      ['Fit To View', '0'],
      ['Actual Size', '1'],
    ] as const) {
      const chord = chordFor(label);
      expect(chord?.key, `${label} key`).toBe(key);
      expect(chord?.primary, `${label} should stay a Cmd/Ctrl chord`).toBe(true);
    }
  });

  /**
   * Cheap protection against a lesson quoting a key that was never checked
   * above: any single-letter "press X" in lesson prose must appear in the
   * claims table.
   */
  it('checks every key the prose tells the user to press', () => {
    const claimed = new Set(CLAIMED_SHORTCUTS.map((c) => c.key.toUpperCase()));
    const unchecked = new Set<string>();
    for (const lesson of LESSONS) {
      for (const step of lesson.steps) {
        const text = [...step.body, 'hint' in step ? (step.hint ?? '') : ''].join(' ');
        for (const [, key] of text.matchAll(/\bPress ([A-Z])\b/g)) {
          if (!claimed.has(key)) unchecked.add(`${lesson.id}/${step.id}: ${key}`);
        }
      }
    }
    expect([...unchecked]).toEqual([]);
  });
});
