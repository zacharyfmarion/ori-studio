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
interface ShortcutClaim {
  label: string;
  key: string;
  why: string;
  /** Modifiers the prose spells out. Absent means the prose quotes a bare key. */
  shift?: boolean;
  primary?: boolean;
}

const CLAIMED_SHORTCUTS: ReadonlyArray<ShortcutClaim> = [
  { label: 'Mountain', key: 'a', why: 'line-types and first-crease tell the user to press A' },
  { label: 'Valley', key: 's', why: 'line-types, snapping-and-grid and the construct chapter press S' },
  { label: 'Edge', key: 'd', why: 'auxiliary-lines lists D for the paper edge' },
  { label: 'Auxiliary', key: 'f', why: 'auxiliary-lines lists F' },
  { label: 'Line', key: 'z', why: 'the drawing steps press Z for the segment tool' },
  { label: 'Box Select', key: 'q', why: 'select-and-delete and mirroring press Q' },
  { label: 'Flip Mountain/Valley', key: 'c', why: 'line-types fixes the vertex with C' },
  { label: 'Perpendicular Line', key: 'y', why: 'the perpendiculars lesson presses Y' },
  { label: 'Angle Bisector', key: 'b', why: 'the angle-bisectors lesson presses B' },
  { label: 'Make alternating M/V', key: 'x', why: 'the big-little-big step presses X' },
  { label: 'Fold estimate', key: 'g', why: 'both folding steps press G' },
  { label: 'Pan (hand tool)', key: '1', why: 'the-canvas offers 1 as an alternative to Cmd-drag' },
  {
    label: 'Simulate Selection Inline',
    key: 's',
    shift: true,
    why: 'the simulate-it step opens the window with Shift+S',
  },
  { label: 'Play / Pause Fold', key: 'space', why: 'simulate-it says Space plays and pauses' },
  { label: 'Fold Forward', key: 'arrowright', why: 'simulate-it steps the fold with the arrows' },
  { label: 'Fold Backward', key: 'arrowleft', why: 'simulate-it steps the fold with the arrows' },
  {
    label: 'Jump To Folded',
    key: 'arrowright',
    shift: true,
    why: 'simulate-it says Shift with an arrow jumps to fully folded',
  },
  {
    label: 'Jump To Flat',
    key: 'arrowleft',
    shift: true,
    why: 'simulate-it says Shift with an arrow jumps to flat',
  },
  { label: 'Replay From Flat', key: 'r', why: 'simulate-it says R rewinds to a flat sheet' },
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
      // Modifiers are part of the claim: prose that says "press A" is wrong the
      // moment the chord grows a Shift, and prose that says "Shift+S" is wrong
      // the moment it loses one.
      expect(chord?.primary ?? false, `${claim.label}: wrong Cmd/Ctrl — ${claim.why}`).toBe(
        claim.primary ?? false
      );
      expect(chord?.shift ?? false, `${claim.label}: wrong Shift — ${claim.why}`).toBe(
        claim.shift ?? false
      );
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
    const claimed = new Set(
      CLAIMED_SHORTCUTS.map((c) => `${c.shift ? 'shift+' : ''}${c.key.toUpperCase()}`)
    );
    // Bare "press A", and the "Shift+S" form the simulator steps use. Cmd
    // chords are deliberately left out: they are menu commands, checked
    // against the registry by the viewport test below and by menuShortcuts.
    const patterns = [/\bPress ([A-Z])\b/g, /\bShift\+([A-Z])\b/gi] as const;
    const unchecked = new Set<string>();
    for (const lesson of LESSONS) {
      for (const step of lesson.steps) {
        const text = [...step.body, 'hint' in step ? (step.hint ?? '') : ''].join(' ');
        for (const [index, pattern] of patterns.entries()) {
          const prefix = index === 0 ? '' : 'shift+';
          for (const [, key] of text.matchAll(pattern)) {
            const chord = `${prefix}${key.toUpperCase()}`;
            if (!claimed.has(chord)) unchecked.add(`${lesson.id}/${step.id}: ${chord}`);
          }
        }
      }
    }
    expect([...unchecked]).toEqual([]);
  });
});
