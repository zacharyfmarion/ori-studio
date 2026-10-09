import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { SHORTCUT_DEFINITIONS } from '../../keyboard/shortcuts';
import {
  ANNOTATE_TOOL_GROUPS,
  annotateToolBlocker,
  annotateToolHint,
  annotationLabel,
  drawingKind,
  drawingLook,
  EDIT_PATH,
  isClickTool,
  isPickTool,
  LINE_TYPE_SHORTCUTS,
  lineTypeForShortcut,
  toolForShortcut,
  type AnnotateToolHost,
} from './annotateTools';
import { ANNOTATION_KINDS, SOLID_ARROW_LOOK } from './annotationModel';
import { DIAGRAM_LINE_TYPES, isLineKind } from './lineTypes';

describe('the rail', () => {
  it('lays a white arrow in the solid arrow’s look with the Solid Arrow, named by its look in the list (15d)', () => {
    const t = i18n.getFixedT('en');
    expect(drawingKind('solid-arrow', 'valley')).toBe('white-arrow');
    expect(drawingLook('solid-arrow')).toEqual(SOLID_ARROW_LOOK);
    // Every other tool lays its kind as it is — but the Enlarge tools, each an area in a shape of its own (Revision 2).
    expect(drawingLook('white-arrow')).toEqual({});
    expect(drawingKind('enlarge', 'valley')).toBe('zoom');
    expect(drawingKind('enlarge-frame', 'valley')).toBe('zoom');
    expect(drawingLook('enlarge')).toEqual({ shape: 'circle' });
    expect(drawingLook('enlarge-frame')).toEqual({ shape: 'rounded' });
    expect(isClickTool('solid-arrow')).toBe(false);
    expect(annotationLabel(t, { kind: 'white-arrow', fill: 'black' })).toBe('Solid Arrow');
    expect(annotationLabel(t, { kind: 'white-arrow' })).toBe('White Arrow');
  });

  it('groups every tool once, after Select and Edit Path: one Line tool for the four lines (15a, 17a), the pleat and solid arrows among the arrows (15c, 15d), equal divisions, the close-up and the two Enlarge tools among the marks (Revision 2, 15f)', () => {
    expect(ANNOTATE_TOOL_GROUPS).toEqual([
      { id: 'select', tools: [null, 'edit-path'] },
      {
        id: 'arrows',
        tools: [
          'valley-arrow',
          'mountain-arrow',
          'fold-unfold-arrow',
          'pleat-arrow',
          'push-arrow',
          'white-arrow',
          'solid-arrow',
        ],
      },
      { id: 'lines', tools: ['line', 'angle-bisector'] },
      // The two equality marks side by side (ED8).
      // Enlarge and Enlarge in Frame after Close-Up (Z1). The star after the circle (Revision 3, R3-25 A).
      { id: 'marks', tools: ['circle', 'star', 'right-angle', 'angle-mark', 'divisions', 'close-up', 'enlarge', 'enlarge-frame'] },
      { id: 'text', tools: ['label', 'callout'] },
    ]);
    // Every kind is drawn by a tool: each its own, the lines by Line in each
    // type, the angle mark by its picks (alone, or with a bisector's line) —
    // but the turn signs, which none draws: turning the model over or round is
    // a step between steps (D22; Zach, 2026-10-05). The enlarge area is
    // laid by two tools of its own, one for each shape (Revision 2).
    const drawn = ANNOTATE_TOOL_GROUPS.flatMap((group) => group.tools).flatMap((tool) =>
      isPickTool(tool) ? ['angle-mark' as const] : DIAGRAM_LINE_TYPES.map((type) => drawingKind(tool, type))
    );
    expect([...new Set(drawn.filter((kind) => kind !== null))].sort()).toEqual(
      ANNOTATION_KINDS.filter((kind) => kind !== 'turn-over' && kind !== 'rotate').sort()
    );
    // Nor has either a key: plain T and R, theirs, pick nothing in the Diagram.
    const plain = SHORTCUT_DEFINITIONS.filter((definition) => definition.scope === 'diagram')
      .flatMap((definition) => definition.defaultChords)
      .filter((chord) => !chord.primary && !chord.ctrl && !chord.meta && !chord.alt && !chord.shift)
      .map((chord) => chord.key);
    expect(plain).not.toContain('t');
    expect(plain).not.toContain('r');
    // D divides (ED8), and picks Equal Divisions; E enlarges, Shift+E in a frame (Z1).
    expect(plain).toContain('d');
    expect(toolForShortcut('diagram.toolDivisions')).toBe('divisions');
    expect(plain).toContain('e');
    expect(toolForShortcut('diagram.toolEnlarge')).toBe('enlarge');
    expect(toolForShortcut('diagram.toolEnlargeFrame')).toBe('enlarge-frame');
    const lines = ['valley-line', 'mountain-line', 'hidden-line', 'solid-line'];
    expect(DIAGRAM_LINE_TYPES.map((type) => drawingKind('line', type))).toEqual(lines);
    expect(ANNOTATION_KINDS.filter(isLineKind)).toEqual(lines);
  });

  it('keeps the three first line keys and Solid’s (17a), each picking a line type rather than a tool', () => {
    expect(LINE_TYPE_SHORTCUTS).toEqual({
      valley: 'diagram.toolValleyLine',
      mountain: 'diagram.toolMountainLine',
      hidden: 'diagram.toolHiddenLine',
      solid: 'diagram.toolSolidLine',
    });
    expect(DIAGRAM_LINE_TYPES.map((type) => lineTypeForShortcut(LINE_TYPE_SHORTCUTS[type]))).toEqual(DIAGRAM_LINE_TYPES);
    expect(DIAGRAM_LINE_TYPES.map((type) => toolForShortcut(LINE_TYPE_SHORTCUTS[type]))).toEqual([undefined, undefined, undefined, undefined]);
    expect(lineTypeForShortcut('diagram.toolValleyArrow')).toBeUndefined();
  });
});

describe('the tool window', () => {
  const t = i18n.t.bind(i18n);
  const mac: AnnotateToolHost = { coarse: false, primary: 'Cmd', alt: 'Option' };
  const ends = 'Hold Cmd to put an end down anywhere, without snapping.';
  const picks = 'Hold Cmd to put a point down anywhere, without snapping.';

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
      // Never snapped, as every arrow (15c).
      'pleat-arrow': { title: 'Pleat Arrow', instructions: 'Drag the way the paper is pleated or crimped.', modifiers: [] },
      'push-arrow': { title: 'Push Arrow', instructions: 'Drag toward the place to push.', modifiers: [] },
      'white-arrow': {
        title: 'White Arrow',
        instructions: 'Drag from where the paper starts to where it goes. Shape it with Edit Path.',
        modifiers: [],
      },
      // A white arrow in a look of its own (15d): drawn and shaped as one.
      'solid-arrow': {
        title: 'Solid Arrow',
        instructions: 'Drag from where the paper starts to where it goes. Shape it with Edit Path.',
        modifiers: [],
      },
      line: { title: 'Line', instructions: 'Drag along the crease.', modifiers: [ends] },
      circle: {
        title: 'Circle',
        instructions: 'Click a point to circle it.',
        modifiers: ['Hold Cmd to put it down anywhere, without snapping.'],
      },
      // Put down as a circle is; turned in 15° steps with Select (Revision 3, R3-24 A, R3-28 A).
      star: {
        title: 'Star',
        instructions: 'Click a point to mark it with a star.',
        modifiers: [
          'Hold Cmd to put it down anywhere, without snapping.',
          'With Select, Shift-drag a round handle at a corner to turn it in 15° steps.',
        ],
      },
      'right-angle': {
        title: 'Right Angle',
        instructions: 'Click inside a right angle to mark it, or drag from a corner into the angle.',
        modifiers: [
          'Shift-drag to open it in 45° steps where it finds no right angle.',
          'Hold Cmd to put the corner it marks down anywhere, without snapping.',
        ],
      },
      // Its words are typed in the Layers pane, not in the window that says so.
      label: {
        title: 'Label',
        instructions: 'Click where the label goes, then type it in the Layers pane.',
        modifiers: [],
      },
      callout: {
        title: 'Callout',
        instructions: 'Drag from a point to where the box goes, or click the point, then type its words in the Layers pane.',
        modifiers: ['Hold Cmd to put its point down anywhere, without snapping.'],
      },
      'angle-bisector': {
        title: 'Angle Bisector',
        instructions: 'Click three points, the vertex second, or two lines; then the line it runs to.',
        modifiers: [picks],
      },
      'angle-mark': {
        title: 'Equal Angles',
        instructions: 'Click a point on one arm, the vertex, then a point on the other arm.',
        modifiers: [picks],
      },
      // Its count is typed next, and its offset set with Select: the window
      // says so, the ⌘ line every line's end has, and Shift's halves (Revision 2).
      divisions: {
        title: 'Equal Divisions',
        instructions:
          'Drag along a line from one end to the other, or click it, to divide it; then type how many parts. With Select, drag the mark to set how far off the line it sits.',
        modifiers: [ends, 'With Select, Shift-drag the mark to move its line by half millimetres.'],
      },
      // Its rings are moved and sized with Select: the window says how, and Shift's halves (15f).
      'close-up': {
        title: 'Close-Up',
        instructions:
          'Drag out from the middle of the area to show larger, or click it. With Select, drag either circle to move it, or its ring to resize it.',
        modifiers: ['Shift-drag the close-up’s ring to scale it by halves.'],
      },
      // A circle from its middle, never snapped, as a close-up's area (Revision 2, S1).
      enlarge: {
        title: 'Enlarge',
        instructions: 'Drag out from the middle of an area to mark it for an enlarged step. Click for a standard size.',
        modifiers: [],
      },
      // Corner to corner: Shift makes it square, Alt draws it from its middle (S2).
      'enlarge-frame': {
        title: 'Enlarge in Frame',
        instructions:
          'Drag from corner to corner round an area to mark it for an enlarged step. Click for a standard size.',
        modifiers: ['Shift-drag to make it square.', 'Option-drag to draw it out from its middle.'],
      },
    });
  });

  it('holds the Enlarge tools on an enlarged step, saying why, and no other (Revision 2)', () => {
    for (const tool of ANNOTATE_TOOL_GROUPS.flatMap((group) => group.tools)) {
      const enlargeTool = tool === 'enlarge' || tool === 'enlarge-frame';
      expect(annotateToolBlocker(t, tool, { enlarged: true })).toBe(
        enlargeTool ? 'This step is already enlarged — draw the area on a step that shows the whole model' : null
      );
      expect(annotateToolBlocker(t, tool, { enlarged: false })).toBeNull();
    }
  });

  it('says what a pick tool’s next press is for, and why its last drew nothing (15b)', () => {
    const hint = (tool: 'angle-bisector' | 'angle-mark', progress: Parameters<typeof annotateToolHint>[4]) =>
      annotateToolHint(t, tool, null, mac, progress)!.instructions;
    expect(hint('angle-bisector', { step: 'vertex', refusal: null })).toBe('Click the angle’s vertex.');
    expect(hint('angle-bisector', { step: 'line-end', refusal: null })).toBe('Click the line it runs to, or where it ends.');
    expect(hint('angle-bisector', { step: 'first', refusal: 'no-angle' })).toBe(
      'Those make no angle. Click a point on one arm of the angle, or a line.'
    );
    expect(hint('angle-mark', { step: 'other-arm', refusal: null })).toBe('Click a point on the other arm.');
    // With no sequence under way, its help.
    expect(hint('angle-mark', null)).toBe('Click a point on one arm, the vertex, then a point on the other arm.');
  });

  it('says what equal divisions clicked on no line could not do, until the next press (Revision 2)', () => {
    const notice = { tool: 'divisions', notice: 'no-line' } as const;
    expect(annotateToolHint(t, 'divisions', null, mac, null, notice)!.instructions).toBe(
      'Click on a line to divide it whole, or drag from one end to the other.'
    );
    // Said only for the tool it is about, and on a touch screen too.
    expect(annotateToolHint(t, 'circle', null, mac, null, notice)!.instructions).toBe('Click a point to circle it.');
    expect(annotateToolHint(t, 'divisions', null, { ...mac, coarse: true }, null, notice)!.instructions).toBe(
      'Click on a line to divide it whole, or drag from one end to the other.'
    );
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
      // A label's and a callout's words, and equal divisions' count, are typed in the Settings sheet's Layers tab there (review).
      if (tool === 'label' || tool === 'callout' || tool === 'divisions') {
        expect(hint.instructions).toMatch(/ in Settings, under Layers\.$/);
      } else expect(hint.instructions).toBe(annotateToolHint(t, tool, null, mac)!.instructions);
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
