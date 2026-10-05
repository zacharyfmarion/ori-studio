import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { ANNOTATE_TOOL_GROUPS, annotateToolHint, EDIT_PATH, type AnnotateToolHost } from './annotateTools';
import { ANNOTATION_KINDS } from './annotationModel';

describe('the rail', () => {
  it('groups every kind’s tool once, after Select and Edit Path, in kind order', () => {
    expect(ANNOTATE_TOOL_GROUPS).toEqual([
      { id: 'select', tools: [null, 'edit-path'] },
      {
        id: 'arrows',
        tools: ['valley-arrow', 'mountain-arrow', 'fold-unfold-arrow', 'push-arrow', 'white-arrow', 'turn-over', 'rotate'],
      },
      { id: 'lines', tools: ['valley-line', 'mountain-line', 'hidden-line'] },
      { id: 'marks', tools: ['circle', 'right-angle'] },
      { id: 'text', tools: ['label', 'callout'] },
    ]);
    const tools = ANNOTATE_TOOL_GROUPS.flatMap((group) => group.tools).filter((tool) => tool !== null && tool !== 'edit-path');
    expect([...tools].sort()).toEqual([...ANNOTATION_KINDS].sort());
  });
});

describe('the tool window', () => {
  const t = i18n.t.bind(i18n);
  const mac: AnnotateToolHost = { coarse: false, primary: 'Cmd', alt: 'Option' };
  const ends = 'Hold Cmd to put an end down anywhere, without snapping.';

  it('says each tool’s name, how to use it, and the keys it honours (decision 7)', () => {
    const hints = Object.fromEntries(
      ANNOTATE_TOOL_GROUPS.flatMap((group) => group.tools).map((tool) => [
        tool ?? 'select',
        annotateToolHint(t, tool, null, mac),
      ])
    );
    expect(hints).toEqual({
      // None for Select, where Annotate rests, as Edit's Box Select has none (review).
      select: null,
      // An arrow snaps nowhere (Zach, 2026-10-05): no key to put it down freely.
      'edit-path': {
        title: 'Edit Path',
        instructions: 'Select a fold arrow or a white arrow to shape it.',
        modifiers: [
          'Shift-drag a node to move it only across, up and down, or at 45°.',
          'Shift-drag a handle to turn it in 15° steps.',
          'Option-drag a smooth node’s handle to move it alone: the node becomes a corner.',
        ],
      },
      'valley-arrow': {
        title: 'Valley Fold Arrow',
        instructions: 'Drag from where the paper starts to where it lands.',
        modifiers: [],
      },
      'mountain-arrow': {
        title: 'Mountain Fold Arrow',
        instructions: 'Drag from where the paper starts to where it lands.',
        modifiers: [],
      },
      'fold-unfold-arrow': {
        title: 'Fold and Unfold Arrow',
        instructions: 'Drag from where the paper starts to where it lands: it folds over, then back.',
        modifiers: [],
      },
      'push-arrow': { title: 'Push Arrow', instructions: 'Drag toward the place to push.', modifiers: [] },
      'white-arrow': {
        title: 'White Arrow',
        instructions: 'Drag from where the paper starts to where it goes. Shape it with Edit Path.',
        modifiers: [],
      },
      'turn-over': { title: 'Turn Over', instructions: 'Click where the sign goes.', modifiers: [] },
      rotate: { title: 'Rotate', instructions: 'Click where the sign goes.', modifiers: [] },
      'valley-line': { title: 'Valley Line', instructions: 'Drag along the crease.', modifiers: [ends] },
      'mountain-line': { title: 'Mountain Line', instructions: 'Drag along the crease.', modifiers: [ends] },
      'hidden-line': { title: 'Hidden Line', instructions: 'Drag along the crease.', modifiers: [ends] },
      circle: {
        title: 'Circle',
        instructions: 'Click a point to circle it.',
        modifiers: ['Hold Cmd to put it down anywhere, without snapping.'],
      },
      'right-angle': {
        title: 'Right Angle',
        instructions: 'Click inside a right angle to mark it, or drag from a corner into the angle.',
        modifiers: [
          'Shift-drag to open it in 45° steps where it finds no right angle.',
          'Hold Cmd to put its corner down anywhere, without snapping.',
        ],
      },
      // Its words are typed in the Step pane, not in the window that says so.
      label: {
        title: 'Label',
        instructions: 'Click where the label goes, then type it in the Step pane.',
        modifiers: [],
      },
      callout: {
        title: 'Callout',
        instructions: 'Drag from a point to where the box goes, or click the point, then type its words in the Step pane.',
        modifiers: ['Hold Cmd to put its point down anywhere, without snapping.'],
      },
    });
  });

  it('names the keys as this platform does', () => {
    const other: AnnotateToolHost = { coarse: false, primary: 'Ctrl', alt: 'Alt' };
    expect(annotateToolHint(t, 'circle', null, other)!.modifiers).toEqual([
      'Hold Ctrl to put it down anywhere, without snapping.',
    ]);
    expect(annotateToolHint(t, EDIT_PATH, null, other)!.modifiers[2]).toBe(
      'Alt-drag a smooth node’s handle to move it alone: the node becomes a corner.'
    );
  });

  it('offers a finger no keys to hold', () => {
    const finger: AnnotateToolHost = { ...mac, coarse: true };
    for (const tool of ANNOTATE_TOOL_GROUPS.flatMap((group) => group.tools).filter((each) => each !== null)) {
      const hint = annotateToolHint(t, tool, null, finger)!;
      expect(hint.modifiers).toEqual([]);
      // A label's and a callout's words are typed in the Settings sheet's Step tab there (review).
      if (tool === 'label' || tool === 'callout') expect(hint.instructions).toMatch(/ in Settings, under Step\.$/);
      else expect(hint.instructions).toBe(annotateToolHint(t, tool, null, mac)!.instructions);
    }
  });

  it('names the Settings it sends a finger to as no other button is named, in every language (review 4)', () => {
    // The sheet's pill and the app's own cog were both "Settings" in seven of nine, and the cog comes first.
    const locales = resolve(__dirname, '../../../public/locales');
    for (const locale of readdirSync(locales).filter((name) => !name.startsWith('.'))) {
      const common = JSON.parse(readFileSync(resolve(locales, locale, 'common.json'), 'utf8'));
      expect(common.toolbar.settings, locale).not.toBe(common.viewDrawer.openSettings);
    }
  });

  it('says what Edit Path can do to what is selected', () => {
    const say = (kind: Parameters<typeof annotateToolHint>[2]) => annotateToolHint(t, EDIT_PATH, kind, mac)!.instructions;
    expect(say(null)).toBe('Select a fold arrow or a white arrow to shape it.');
    expect(say('label')).toBe('Only fold arrows and white arrows can be shaped.');
    expect(say('push-arrow')).toBe('Only fold arrows and white arrows can be shaped.');
    for (const kind of ['valley-arrow', 'mountain-arrow', 'fold-unfold-arrow', 'white-arrow'] as const) {
      expect(say(kind)).toMatch(/^Drag an arrow’s nodes/);
    }
  });
});
