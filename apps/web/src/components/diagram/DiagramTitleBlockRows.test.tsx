import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PAGE_SETTINGS,
  defaultTitleBlockContent,
  setPageSetup,
  type DiagramCreasePatternAsset,
  type DiagramPageSetup,
  type DiagramTitleBlockContent,
} from '../../diagram/document/diagramDocument';
import { cpStep } from '../../diagram/document/diagramSteps.fixtures';
import { emptyStep, patternStep, titleBlockDiagram } from '../../diagram/pages/titleBlock.fixtures';
import { titleBlockInksOf } from '../../diagram/pages/composeDiagramPage';
import { COLOR_PICK_SETTLE_MS } from '../../diagram/pages/useSettledColorPick';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramTitleBlockRows } from './DiagramTitleBlockRows';

const analytics = vi.hoisted(() => ({ trackDiagramPageSetupChanged: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));
/** The picker, and the file's reading, which runs the CP kernel. */
const files = vi.hoisted(() => ({ openBinaryFile: vi.fn(), readPatternFile: vi.fn() }));
vi.mock('../../platform/fileService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../platform/fileService')>()),
  getFileService: () => ({ openBinaryFile: files.openBinaryFile }),
}));
vi.mock('../../diagram/pages/titleBlockPatternFile', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../diagram/pages/titleBlockPatternFile')>()),
  readPatternFile: files.readPatternFile,
}));
const toasts = vi.hoisted(() => ({ error: vi.fn(), message: vi.fn() }));
vi.mock('sonner', async (importOriginal) => ({ ...(await importOriginal<typeof import('sonner')>()), toast: toasts }));
/** What the selects offer, as built, watched for when it is worked out. */
const choices = vi.hoisted(() => ({ titleBlockChoices: vi.fn() }));
vi.mock('../../diagram/pages/titleBlockChoices', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../diagram/pages/titleBlockChoices')>();
  choices.titleBlockChoices.mockImplementation(actual.titleBlockChoices);
  return { ...actual, ...choices };
});

/**
 * The title block's rows in the Page pane's Header & footer
 * (`implementation-plans/diagram-title-block.md`, section 7 and Phase 1c): the
 * toggle a page setting, what the block shows set one part at a time — each
 * one undo step and one count — and only what the block can show offered,
 * each select naming what Auto finds.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ON = { enabled: true, heightShare: PAGE_SETTINGS.titleBlock.default.heightShare };

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const state = () => useWorkspaceStore.getState();
const undoSteps = () => state().diagramHistory.past.length;

/**
 * Steps 1 and 2 linked to one pattern, step 3 to another, step 4 empty: the
 * model offers 1–3, the pattern 2 and 3. Installed as a file would be.
 */
function install(
  page: Partial<DiagramPageSetup> = {},
  readOnly = false,
  steps = [cpStep('s1'), cpStep('s2'), patternStep('s3'), emptyStep('s4')],
  content?: DiagramTitleBlockContent
) {
  const document = setPageSetup(titleBlockDiagram(steps), {
    layout: 'flow',
    titleBlock: PAGE_SETTINGS.titleBlock.legacy,
    ...page,
  });
  act(() =>
    state().installDiagram({ document: content ? { ...document, titleBlockContent: content } : document, readOnly, raw: {} })
  );
}

/** What a new diagram's title block says, in English. */
const NEW_CONTENT = defaultTitleBlockContent({
  subtitle: 'Subtitle',
  author: 'Author',
  authorName: 'Your name here',
  steps: 'Steps',
  recommendedPaper: 'Recommended paper',
  paperSize: '15 cm × 15 cm',
});
/** A block's words as an author may leave them: a credit with no value, a second, and the step count, live, last. */
const CREDITED: DiagramTitleBlockContent = {
  subtitle: 'Origami diagram',
  credits: [
    { label: 'Author', value: '' },
    { label: 'Recommended size', value: '' },
    { label: 'Steps', value: { kind: 'step-count' } },
  ],
};

const toggle = () => host!.querySelector<HTMLButtonElement>('button[role="switch"][aria-label="Title block"]')!;
const select = (label: string) => host!.querySelector<HTMLButtonElement>(`button[role="combobox"][aria-label="${label}"]`);
/** A stacked text field, by its label. */
const textField = (label: string) => {
  const found = [...host!.querySelectorAll('label')].find((each) => each.textContent === label);
  return found ? (document.getElementById(found.htmlFor) as HTMLTextAreaElement | null) : null;
};
const input = (label: string) => host!.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`);
const button = (name: string) =>
  [...host!.querySelectorAll<HTMLButtonElement>('button')].find(
    (each) => each.getAttribute('aria-label') === name || each.textContent === name
  );
const slider = (label: string) => host!.querySelector<HTMLInputElement>(`input[type="range"][aria-label="${label}"]`);
const swatch = (label: string) => host!.querySelector<HTMLInputElement>(`input[type="color"][aria-label="${label}"]`);
/** A colour picker's move to `color`, as the swatch reports it. */
function pickColor(label: string, color: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(swatch(label), color);
    swatch(label)!.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
const credits = () => state().diagram!.titleBlockContent?.credits;
const calls = () => analytics.trackDiagramPageSetupChanged.mock.calls;
/** The note a select is described by, and whether it is a reason; null with none. */
function noteOf(label: string) {
  const id = select(label)!.getAttribute('aria-describedby');
  const note = id ? document.getElementById(id) : null;
  return note ? { text: note.textContent, reason: note.dataset.fieldNote === 'reason' } : null;
}

/** The options a select offers, opened from the keyboard as a reader would. */
function optionsOf(label: string): string[] {
  act(() => select(label)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  const options = [...document.querySelectorAll<HTMLElement>('[role="option"]')].map((option) => option.textContent ?? '');
  act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  return options;
}

function choose(label: string, option: string) {
  act(() => select(label)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  const found = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) => each.textContent === option);
  if (!found) throw new Error(`no ${option} in ${label}`);
  act(() => found.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
}

/** Types `text` into a field, as a whole new value, the way a test can. */
function typeInto(field: HTMLTextAreaElement | HTMLInputElement, text: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** A sitting at a field: focused, typed through `texts`, left. */
function sitting(field: () => HTMLTextAreaElement | HTMLInputElement | null, ...texts: string[]) {
  act(() => field()!.focus());
  for (const text of texts) typeInto(field()!, text);
  act(() => field()!.blur());
}

/** A drag of slider `label` to `value`, let go there. */
function drag(label: string, value: string) {
  const input = slider(label)!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  act(() => input.dispatchEvent(new Event('change', { bubbles: true })));
}

beforeAll(() => {
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.releasePointerCapture ??= () => undefined;
  Element.prototype.scrollIntoView ??= () => undefined;
});

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  vi.useRealTimers();
});

const render = () =>
  act(() =>
    root?.render(
      <TooltipProvider>
        <DiagramTitleBlockRows />
      </TooltipProvider>
    )
  );

describe('DiagramTitleBlockRows', () => {
  it('turns the block on at today’s height with a new diagram’s subtitle and credits, one undo step and one count (Zach, 2026-10-15)', () => {
    // A diagram saved without the block, as Zach's crane was: the legacy 0.27 share, and nothing said of its words.
    install();
    const saved = state().diagram;
    render();
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    expect(select('Model')).toBeNull();
    expect(textField('Description')).toBeNull();
    act(() => toggle().click());
    expect(state().diagram!.page.titleBlock).toEqual(PAGE_SETTINGS.titleBlock.default);
    expect(state().diagram!.titleBlockContent).toEqual(NEW_CONTENT);
    expect(undoSteps()).toBe(1);
    expect(analytics.trackDiagramPageSetupChanged).toHaveBeenCalledExactlyOnceWith('title_block');
    // Shown at once, scaffolded: the subtitle, and the three credits, each with a value, the second following the
    // step count (Zach, 2026-10-15).
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(textField('Subtitle')!.value).toBe('Subtitle');
    expect([1, 2, 3].map((number) => input(`Label of credit ${number}`)!.value)).toEqual(['Author', 'Steps', 'Recommended paper']);
    expect([1, 2, 3].map((number) => input(`Value of credit ${number}`)!.value)).toEqual(['Your name here', 'Auto (4)', '15 cm × 15 cm']);
    expect(select('Model')).not.toBeNull();
    expect(select('Crease pattern')).not.toBeNull();
    // One Undo gives the diagram back as it was saved.
    act(() => state().undoDiagram());
    expect(state().diagram).toEqual(saved);
    act(() => toggle().click());
    // Off keeps its height and its words.
    act(() => toggle().click());
    expect(state().diagram!.page.titleBlock).toEqual({ ...PAGE_SETTINGS.titleBlock.default, enabled: false });
    expect(state().diagram!.titleBlockContent).toEqual(NEW_CONTENT);
    expect(select('Model')).toBeNull();
  });

  it('keeps the words a diagram already says when the block is turned on', () => {
    install({}, false, undefined, { subtitle: 'Modular', credits: [{ label: 'Units', value: '30' }] });
    render();
    act(() => toggle().click());
    expect(state().diagram!.titleBlockContent).toEqual({ subtitle: 'Modular', credits: [{ label: 'Units', value: '30' }] });
    // A subtitle and no credits — its author removed them all — is the author's: the toggle adds none.
    install({}, false, undefined, { subtitle: 'Modular' });
    act(() => toggle().click());
    expect(state().diagram!.titleBlockContent).toEqual({ subtitle: 'Modular' });
  });

  it('shows a new diagram’s words before there is one, so the first edit lands among them (review, 2026-10-15)', () => {
    // No diagram yet: the first edit makes one with the default subtitle and credits, then applies itself.
    render();
    expect(state().diagram).toBeNull();
    expect(textField('Subtitle')!.value).toBe('Subtitle');
    expect([1, 2, 3].map((number) => input(`Label of credit ${number}`)!.value)).toEqual(['Author', 'Steps', 'Recommended paper']);
    // The step count already follows: there is none to add.
    expect(button('Add Step Count')).toBeUndefined();
    act(() => button('Add Credit')!.click());
    expect(credits()!.map(({ label }) => label)).toEqual(['Author', 'Steps', 'Recommended paper', '']);
    expect(credits()!.filter(({ value }) => typeof value !== 'string')).toHaveLength(1);
    expect(document.activeElement).toBe(input('Label of credit 4'));
  });

  it('works out what the selects offer only while the first page has the block, as an old file has not', () => {
    install();
    render();
    act(() => state().setDiagramTitleBlockContent({ note: 'Design: Lang' }));
    expect(choices.titleBlockChoices).not.toHaveBeenCalled();
    act(() => toggle().click());
    expect(choices.titleBlockChoices).toHaveBeenCalled();
  });

  it('names the switch by what it turns on, and says what each select’s Auto follows', () => {
    install({ titleBlock: ON });
    render();
    expect(toggle()).not.toBeNull();
    const helpOf = (label: string) =>
      select(label)!.closest('[data-field-row]')!.querySelector('[data-field-help]')?.getAttribute('aria-label');
    expect(helpOf('Model')).toBe('The finished model, drawn from a step’s picture. Auto uses the last step with one.');
    expect(helpOf('Crease pattern')).toBe(
      'Its mountain and valley folds, from the crease pattern a step links or from a file you upload. Auto uses the last linked step; each pattern is listed once, by the step chosen for it or else the last step that links it.'
    );
  });

  it('reads as the block does, a step in under its toggle: subtitle, credits, description, then the model and the pattern with their sizes', () => {
    install({ titleBlock: ON }, false, undefined, CREDITED);
    render();
    const names = [...host!.querySelectorAll('[data-field-label], label, [role="group"][aria-labelledby]')].map(
      (each) =>
        each.getAttribute('role') === 'group'
          ? document.getElementById(each.getAttribute('aria-labelledby')!)!.textContent
          : each.textContent
    );
    expect(names).toEqual([
      'Title block',
      'Subtitle',
      'Band color',
      'Credits',
      'Description',
      'Model',
      'Model size',
      'Crease pattern',
      'Crease pattern size',
    ]);
    const nested = (element: Element) => element.closest('[data-nested]') !== null;
    expect(nested(toggle())).toBe(false);
    for (const each of [
      textField('Subtitle')!,
      swatch('Band color')!,
      input('Label of credit 1')!,
      textField('Description')!,
      select('Model')!,
      slider('Model size')!,
      select('Crease pattern')!,
      slider('Crease pattern size')!,
    ]) {
      expect(nested(each)).toBe(true);
    }
  });

  it('offers the steps with a picture for the model and each linked pattern once, each select naming what Auto finds', () => {
    install({ titleBlock: ON });
    render();
    expect(optionsOf('Model')).toEqual(['Auto (step 3)', 'Step 1', 'Step 2', 'Step 3', 'None']);
    // Steps 1 and 2 link one pattern: offered once, by the last of them.
    expect(optionsOf('Crease pattern')).toEqual(['Auto (step 3)', 'Step 2', 'Step 3', 'None', 'Upload a CP or FOLD file…']);
    expect(select('Model')!.textContent).toBe('Auto (step 3)');
  });

  it('says Auto finds nothing where no step has a picture or a link, and offers nothing else but None', () => {
    install({ titleBlock: ON }, false, [emptyStep('s1'), emptyStep('s2')]);
    render();
    expect(optionsOf('Model')).toEqual(['Auto (no pictures)', 'None']);
    expect(optionsOf('Crease pattern')).toEqual(['Auto (none linked)', 'None', 'Upload a CP or FOLD file…']);
  });

  it('sets where each part comes from, one undo step and one count of the kind each, never which step', () => {
    install({ titleBlock: ON });
    render();
    choose('Model', 'Step 1');
    expect(state().diagram!.titleBlockContent).toEqual({ model: { kind: 'step', stepId: 's1' } });
    expect(select('Model')!.textContent).toBe('Step 1');
    choose('Crease pattern', 'None');
    choose('Model', 'Auto (step 3)');
    expect(state().diagram!.titleBlockContent).toEqual({ pattern: { kind: 'none' } });
    expect(undoSteps()).toBe(3);
    expect(analytics.trackDiagramPageSetupChanged.mock.calls).toEqual([
      ['title_block_model', { titleBlockChoice: 'step' }],
      ['title_block_pattern', { titleBlockChoice: 'none' }],
      ['title_block_model', { titleBlockChoice: 'auto' }],
    ]);
  });

  it('names a chosen step that has lost its picture, as what the model is set to', () => {
    install({ titleBlock: ON });
    act(() => state().setDiagramTitleBlockContent({ model: { kind: 'step', stepId: 's1' } }));
    act(() => state().removeDiagramStepPicture('s1'));
    render();
    // The select names the step, whole; why it shows nothing is the row's note, read with it, as the Pages view says it.
    expect(select('Model')!.textContent).toBe('Step 1');
    expect(noteOf('Model')).toEqual({ text: 'Step 1 has no picture yet', reason: true });
    expect(optionsOf('Model')).toEqual(['Auto (step 3)', 'Step 1', 'Step 2', 'Step 3', 'None']);
    act(() => state().setDiagramTitleBlockContent({ model: { kind: 'step', stepId: 's2' } }));
    expect(noteOf('Model')).toBeNull();
  });

  it('calls the note the Description, and says it prints only when it has text (Zach, 2026-10-15)', () => {
    install({ titleBlock: ON });
    render();
    const help = textField('Description')!.parentElement!.querySelector('[data-field-help]');
    expect(help?.getAttribute('aria-label')).toBe('Free text under the credits. It prints only when it has text.');
    expect(textField('Note')).toBeNull();
    expect(host!.textContent).not.toMatch(/\bNote\b/);
  });

  it('offers no linked step whose pattern draws nothing, and names one chosen as the page’s overlay does', () => {
    const blank = patternStep('s2', []);
    install({ titleBlock: ON }, false, [cpStep('s1'), blank]);
    render();
    expect(optionsOf('Crease pattern')).toEqual(['Auto (step 1)', 'Step 1', 'None', 'Upload a CP or FOLD file…']);
    act(() => state().setDiagramTitleBlockContent({ pattern: { kind: 'step', stepId: 's2' } }));
    expect(select('Crease pattern')!.textContent).toBe('Step 2');
    expect(noteOf('Crease pattern')).toEqual({ text: 'Step 2 has no crease pattern', reason: true });
  });

  it('uploads a crease pattern file from the menu’s last entry: the picker inside the press, one undo step and one count by format', async () => {
    const asset: DiagramCreasePatternAsset = {
      id: 'asset-cp',
      kind: 'crease-pattern',
      name: 'crane.cp',
      pattern: { viewBox: '0 0 1000 1000', strokes: [{ x1: 0, y1: 0, x2: 1000, y2: 1000, role: 'valley' }] },
      bytes: 1,
    };
    files.openBinaryFile.mockResolvedValue({ bytes: new Uint8Array([1]), name: 'crane.cp', path: null, mimeType: '' });
    files.readPatternFile.mockResolvedValue({ ok: true, asset, format: 'cp', trimmed: false });
    install({ titleBlock: ON });
    render();
    choose('Crease pattern', 'Upload a CP or FOLD file…');
    // Opened in the press itself, before anything is awaited: a browser allows a picker only from a gesture.
    expect(files.openBinaryFile).toHaveBeenCalledOnce();
    expect(files.openBinaryFile.mock.calls[0]![0]).toMatchObject({ extensions: ['cp', 'fold', 'ori', 'orh'] });
    await act(async () => {});
    expect(state().diagram!.titleBlockContent).toEqual({ pattern: { kind: 'upload', assetId: 'asset-cp' } });
    expect(state().diagram!.assets).toEqual({ 'asset-cp': asset });
    expect(select('Crease pattern')!.textContent).toBe('crane.cp');
    expect(optionsOf('Crease pattern')).toEqual(['Auto (step 3)', 'Step 2', 'Step 3', 'crane.cp', 'None', 'Upload a CP or FOLD file…']);
    expect(undoSteps()).toBe(1);
    expect(calls()).toEqual([['title_block_pattern', { titleBlockChoice: 'upload', titleBlockPatternFormat: 'cp' }]]);
    // Choosing the file again changes nothing; choosing a step lets it go, and its asset with it.
    choose('Crease pattern', 'crane.cp');
    expect(undoSteps()).toBe(1);
    choose('Crease pattern', 'Step 2');
    expect(state().diagram!.assets).toEqual({});
    expect(optionsOf('Crease pattern')).toEqual(['Auto (step 3)', 'Step 2', 'Step 3', 'None', 'Upload a CP or FOLD file…']);
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it('changes nothing for a file that gives no pattern, and says why; nor for a picker dismissed', async () => {
    install({ titleBlock: ON });
    render();
    files.openBinaryFile.mockResolvedValue(null);
    choose('Crease pattern', 'Upload a CP or FOLD file…');
    await act(async () => {});
    expect(files.readPatternFile).not.toHaveBeenCalled();
    files.openBinaryFile.mockResolvedValue({ bytes: new Uint8Array([1]), name: 'square.fold', path: null, mimeType: '' });
    for (const [reason, said] of [
      ['no-folds', 'This crease pattern has no mountain or valley folds to show.'],
      ['unreadable', 'This file couldn’t be read as a crease pattern.'],
    ] as const) {
      files.readPatternFile.mockResolvedValueOnce({ ok: false, reason });
      choose('Crease pattern', 'Upload a CP or FOLD file…');
      await act(async () => {});
      expect(toasts.error).toHaveBeenLastCalledWith(said);
    }
    expect(state().diagram!.titleBlockContent).toBeUndefined();
    expect(undoSteps()).toBe(0);
    expect(calls()).toEqual([]);
  });

  it('commits the description as it is typed: a sitting at the field one undo step and one count, never its words', () => {
    vi.useFakeTimers();
    install({ titleBlock: ON });
    render();
    const note = () => textField('Description');
    act(() => note()!.focus());
    typeInto(note()!, 'Design');
    // A pause in typing commits.
    act(() => vi.advanceTimersByTime(1000));
    expect(state().diagram!.titleBlockContent?.note).toBe('Design');
    typeInto(note()!, 'Design: Lang\nPaper: 35 cm');
    act(() => note()!.blur());
    expect(state().diagram!.titleBlockContent?.note).toBe('Design: Lang\nPaper: 35 cm');
    expect(undoSteps()).toBe(1);
    expect(analytics.trackDiagramPageSetupChanged).toHaveBeenCalledExactlyOnceWith('title_block_note', { titleBlockNote: 'shown' });
    // Another sitting counts again; cleared, the note is none, and counted as hidden.
    sitting(note, '');
    expect(state().diagram!.titleBlockContent).toBeUndefined();
    expect(undoSteps()).toBe(2);
    expect(calls().at(-1)).toEqual(['title_block_note', { titleBlockNote: 'hidden' }]);
  });

  it('commits the subtitle on one line, a sitting one undo step and one count; cleared, there is none', () => {
    install({ titleBlock: ON }, false, undefined, CREDITED);
    render();
    const subtitle = () => textField('Subtitle');
    expect(subtitle()!.value).toBe('Origami diagram');
    sitting(subtitle, 'Origami', 'Origami\ndiagram by Lang');
    expect(state().diagram!.titleBlockContent?.subtitle).toBe('Origami diagram by Lang');
    expect(undoSteps()).toBe(1);
    expect(calls()).toEqual([['title_block_subtitle', { titleBlockSubtitle: 'shown' }]]);
    sitting(subtitle, '');
    expect(state().diagram!.titleBlockContent).not.toHaveProperty('subtitle');
    expect(subtitle()!.value).toBe('');
    expect(undoSteps()).toBe(2);
    expect(calls().at(-1)).toEqual(['title_block_subtitle', { titleBlockSubtitle: 'hidden' }]);
  });

  it('colours the band as the paper until one is picked: a pick one undo step and one count, Reset back on the paper’s (Zach, 2026-10-15)', () => {
    vi.useFakeTimers();
    install({ titleBlock: ON }, false, undefined, CREDITED);
    render();
    // Unset: the swatch shows the colour the band prints in, the paper's, and offers no Reset.
    const paper = titleBlockInksOf(state().diagram!.style).band;
    expect(swatch('Band color')!.value).toBe(paper);
    expect(button('Reset Band color to default')).toBeUndefined();
    // A pick shows as it goes, and is written as it settles; carried on after a pause, it is still one undo step.
    act(() => swatch('Band color')!.focus());
    pickColor('Band color', '#2a4d8f');
    pickColor('Band color', '#3b5ea0');
    expect(swatch('Band color')!.value).toBe('#3b5ea0');
    expect(state().diagram!.titleBlockContent?.bandColor).toBeUndefined();
    act(() => vi.advanceTimersByTime(COLOR_PICK_SETTLE_MS));
    expect(state().diagram!.titleBlockContent?.bandColor).toBe('#3b5ea0');
    pickColor('Band color', '#1b3e80');
    act(() => swatch('Band color')!.blur());
    expect(state().diagram!.titleBlockContent).toEqual({ ...CREDITED, bandColor: '#1b3e80' });
    expect(undoSteps()).toBe(1);
    expect(calls()).toEqual([['title_block_band_color', { titleBlockBand: 'custom' }]]);
    // Reset: the paper's colour again, a step and a count of its own.
    act(() => button('Reset Band color to default')!.click());
    expect(state().diagram!.titleBlockContent).toEqual(CREDITED);
    expect(swatch('Band color')!.value).toBe(paper);
    expect(undoSteps()).toBe(2);
    expect(calls().at(-1)).toEqual(['title_block_band_color', { titleBlockBand: 'paper' }]);
  });

  it('lists the credits as label and value fields, the step count live and followed, with no way to add a second', () => {
    install({ titleBlock: ON }, false, undefined, CREDITED);
    render();
    expect([1, 2, 3].map((number) => input(`Label of credit ${number}`)!.value)).toEqual([
      'Author',
      'Recommended size',
      'Steps',
    ]);
    expect(input('Value of credit 1')!.value).toBe('');
    // The live count is the credit's value, read and never typed: a field the keyboard reaches, which a reader hears.
    const live = () => input('Value of credit 3')!;
    expect(live().readOnly).toBe(true);
    expect(live().tabIndex).toBe(0);
    // Four numbered steps: a turn would not count.
    expect(live().value).toBe('Auto (4)');
    act(() => state().addDiagramStep());
    expect(live().value).toBe('Auto (5)');
    expect(button('Add Credit')).toBeDefined();
    expect(button('Add Step Count')).toBeUndefined();
  });

  it('keeps a credit field’s text on Enter and Escape, leaves it there, and lets an input method’s Enter be (review, 2026-10-15)', () => {
    install({ titleBlock: ON }, false, undefined, CREDITED);
    render();
    const author = () => input('Value of credit 1')!;
    const key = (init: KeyboardEventInit) => act(() => author().dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init })));
    act(() => author().focus());
    typeInto(author(), 'Lang');
    // An input method converting: its Enter is its own, and the field keeps the focus.
    key({ key: 'Enter', isComposing: true });
    expect(document.activeElement).toBe(author());
    key({ key: 'Enter' });
    expect(document.activeElement).not.toBe(author());
    expect(credits()![0]).toEqual({ label: 'Author', value: 'Lang' });
    act(() => author().focus());
    typeInto(author(), 'Robert J. Lang');
    key({ key: 'Escape' });
    expect(document.activeElement).not.toBe(author());
    expect(credits()![0]).toEqual({ label: 'Author', value: 'Robert J. Lang' });
    expect(undoSteps()).toBe(2);
  });

  it('types a credit’s label and value, a sitting at each one undo step and one count, never the words', () => {
    install({ titleBlock: ON }, false, undefined, CREDITED);
    render();
    sitting(() => input('Value of credit 1'), 'Robert', 'Robert J. Lang');
    sitting(() => input('Label of credit 2'), 'Paper');
    expect(credits()!.slice(0, 2)).toEqual([
      { label: 'Author', value: 'Robert J. Lang' },
      { label: 'Paper', value: '' },
    ]);
    expect(undoSteps()).toBe(2);
    expect(calls()).toEqual([
      ['title_block_credits', { titleBlockCreditChange: 'value', titleBlockCredits: 3 }],
      ['title_block_credits', { titleBlockCreditChange: 'label', titleBlockCredits: 3 }],
    ]);
  });

  it('types a value in place of the step count, and offers the step count back, each one undo step and one count', () => {
    install({ titleBlock: ON }, false, undefined, CREDITED);
    render();
    act(() => button('Type a value for credit 3 instead')!.click());
    expect(credits()![2]).toEqual({ label: 'Steps', value: '' });
    // The field it asked for, ready to type into.
    expect(document.activeElement).toBe(input('Value of credit 3'));
    expect(input('Value of credit 3')!.readOnly).toBe(false);
    expect(host!.querySelector('[data-credit-live]')).toBeNull();
    expect(calls()).toEqual([['title_block_credits', { titleBlockCreditChange: 'step_count_off', titleBlockCredits: 3 }]]);
    act(() => button('Add Step Count')!.click());
    expect(credits()!.at(-1)).toEqual({ label: 'Steps', value: { kind: 'step-count' } });
    expect(button('Add Step Count')).toBeUndefined();
    // The button that went with it hands the focus to the credit it added.
    expect(document.activeElement).toBe(input('Label of credit 4'));
    expect(undoSteps()).toBe(2);
    expect(calls().at(-1)).toEqual(['title_block_credits', { titleBlockCreditChange: 'step_count_on', titleBlockCredits: 4 }]);
  });

  it('adds a credit at the end, ready to name, and removes one, each one undo step and one count', () => {
    install({ titleBlock: ON }, false, undefined, CREDITED);
    render();
    act(() => button('Add Credit')!.click());
    expect(credits()).toHaveLength(4);
    expect(credits()![3]).toEqual({ label: '', value: '' });
    expect(document.activeElement).toBe(input('Label of credit 4'));
    act(() => button('Remove credit 1')!.click());
    expect(credits()!.map((credit) => credit.label)).toEqual(['Recommended size', 'Steps', '']);
    expect(input('Label of credit 1')!.value).toBe('Recommended size');
    expect(undoSteps()).toBe(2);
    expect(calls()).toEqual([
      ['title_block_credits', { titleBlockCreditChange: 'add', titleBlockCredits: 4 }],
      ['title_block_credits', { titleBlockCreditChange: 'remove', titleBlockCredits: 3 }],
    ]);
  });

  it('never lets the focus fall out of the credits as they are removed (review, 2026-10-15)', () => {
    install({ titleBlock: ON }, false, undefined, CREDITED);
    render();
    const remove = (number: number) => {
      act(() => button(`Remove credit ${number}`)!.focus());
      act(() => button(`Remove credit ${number}`)!.click());
    };
    // The first: the next credit's remove, now in its place.
    remove(1);
    expect(document.activeElement).toBe(button('Remove credit 1'));
    // The last: the one before it.
    remove(2);
    expect(document.activeElement).toBe(button('Remove credit 1'));
    // The only one: Add Credit.
    remove(1);
    expect(credits()).toBeUndefined();
    expect(document.activeElement).toBe(button('Add Credit'));
  });

  it('offers the step count to a block whose credits say nothing, as an old diagram’s', () => {
    install({ titleBlock: ON });
    render();
    expect(host!.querySelector('[data-credit]')).toBeNull();
    act(() => button('Add Step Count')!.click());
    expect(credits()).toEqual([{ label: 'Steps', value: { kind: 'step-count' } }]);
    expect(input('Value of credit 1')!.value).toBe('Auto (4)');
  });

  it('sizes the model and the pattern in percent, handed over where let go, each one undo step and one count, and resets them', () => {
    install({ titleBlock: ON });
    render();
    const readout = (label: string) =>
      slider(label)!.closest('[data-field-row]')!.querySelector('[data-field-readout]')!.textContent;
    const reset = (label: string) => button(`Reset ${label} to default`);
    expect(readout('Model size')).toBe('59%');
    expect(readout('Crease pattern size')).toBe('79%');
    // A browser snaps a range's value to its stops: the defaults must be stops, or the thumb leaves them.
    const onStop = (label: string, percent: number) => {
      const { min, step } = slider(label)!;
      return (percent - Number(min)) % Number(step) === 0;
    };
    expect(onStop('Model size', 59)).toBe(true);
    expect(onStop('Crease pattern size', 79)).toBe(true);
    expect(reset('Model size')).toBeUndefined();
    drag('Model size', '75');
    expect(state().diagram!.titleBlockContent?.modelSize).toBe(0.75);
    expect(readout('Model size')).toBe('75%');
    expect(undoSteps()).toBe(1);
    expect(calls()).toEqual([['title_block_model_size', { titleBlockSize: 'custom' }]]);
    act(() => reset('Model size')!.click());
    expect(state().diagram!.titleBlockContent).toBeUndefined();
    expect(undoSteps()).toBe(2);
    expect(calls().at(-1)).toEqual(['title_block_model_size', { titleBlockSize: 'default' }]);
    drag('Crease pattern size', '85');
    expect(state().diagram!.titleBlockContent?.patternSize).toBe(0.85);
    expect(calls().at(-1)).toEqual(['title_block_pattern_size', { titleBlockSize: 'custom' }]);
  });

  it('offers no pair of sizes at which the model would leave the pattern’s corner, each as far as the other allows (Zach, 2026-10-15)', () => {
    install({ titleBlock: ON });
    render();
    const max = (label: string) => Number(slider(label)!.max);
    // At the defaults the model goes to 100%, and the pattern to 88%.
    expect([max('Model size'), max('Crease pattern size')]).toEqual([100, 88]);
    drag('Model size', '100');
    expect(max('Crease pattern size')).toBe(80);
    drag('Model size', '30');
    expect(max('Crease pattern size')).toBe(94);
    drag('Crease pattern size', '94');
    expect(max('Model size')).toBe(30);
    // A pair a file says that does not fit is drawn, and shown, with the pattern as large as fits.
    act(() => state().setDiagramTitleBlockContent({ modelSize: 1, patternSize: 1 }));
    expect(slider('Crease pattern size')!.value).toBe('80');
    expect(slider('Model size')!.value).toBe('100');
  });

  it('offers a size only while its part is shown', () => {
    install({ titleBlock: ON });
    render();
    choose('Model', 'None');
    expect(slider('Model size')).toBeNull();
    expect(slider('Crease pattern size')).not.toBeNull();
    choose('Crease pattern', 'None');
    expect(slider('Crease pattern size')).toBeNull();
    choose('Model', 'Auto (step 3)');
    expect(slider('Model size')).not.toBeNull();
  });

  it('cannot be turned on in a grid of one row, and says why', () => {
    install({ layout: 'grid', rows: 1, titleBlock: ON });
    render();
    expect(toggle().disabled).toBe(true);
    // The setting is on, but the page has no block: the switch says what the page has.
    expect(toggle().getAttribute('aria-checked')).toBe('false');
    const note = document.getElementById(toggle().getAttribute('aria-describedby')!);
    expect(note?.textContent).toBe('Needs two rows or more');
    expect(select('Model')).toBeNull();
    act(() => state().setDiagramPage({ rows: 2 }));
    expect(toggle().disabled).toBe(false);
    expect(toggle().getAttribute('aria-checked')).toBe('true');
    expect(toggle().hasAttribute('aria-describedby')).toBe(false);
  });

  it('takes nothing on a read-only diagram', () => {
    install({ titleBlock: ON }, true, undefined, CREDITED);
    render();
    expect(toggle().disabled).toBe(true);
    expect(select('Model')!.disabled).toBe(true);
    expect(select('Crease pattern')!.disabled).toBe(true);
    expect(textField('Subtitle')!.disabled).toBe(true);
    expect(textField('Description')!.disabled).toBe(true);
    expect(swatch('Band color')!.disabled).toBe(true);
    expect(input('Label of credit 1')!.disabled).toBe(true);
    expect(input('Value of credit 1')!.disabled).toBe(true);
    for (const name of ['Remove credit 1', 'Type a value for credit 3 instead', 'Add Credit']) expect(button(name)!.disabled).toBe(true);
    expect(slider('Model size')!.disabled).toBe(true);
    expect(slider('Crease pattern size')!.disabled).toBe(true);
  });
});
