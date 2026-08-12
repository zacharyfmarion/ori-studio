import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleShortcutKeyDown } from '../../keyboard/shortcutDispatcher';
import { shortcutScopeStackForContext } from '../../keyboard/shortcutRuntime';
import type { ShortcutActionId } from '../../keyboard/shortcuts';
import { SHORTCUT_STORAGE_KEY, useShortcutStore } from '../../store/shortcutStore';
import { OrieditaImportDialog } from './OrieditaImportDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { openBinaryFile } = vi.hoisted(() => ({ openBinaryFile: vi.fn() }));

vi.mock('../../platform/fileService', () => ({
  getFileService: () => ({
    surface: 'web' as const,
    supportsNativeDialogs: false,
    openBinaryFile,
    openTextFile: async () => null,
    saveTextFile: async () => null,
    saveBinaryFile: async () => null,
  }),
}));

/**
 * The real Java-produced export, byte for byte — the same fixture the archive
 * reader is tested against. Its `hotkey.properties` is:
 *
 *   spacedAction=shift ctrl pressed V   (no counterpart here)
 *   colRedAction=shift pressed A        (Mountain)
 *   angleBisectorAction=ctrl pressed B  (Square Bisector)
 *   clearedAction=                      (blank, and therefore ambiguous)
 *   nonAsciiAction=<CJK>                (no counterpart here)
 *
 * and its `config.json` carries a `defaultDirectory` and a `recentFileList`,
 * which the privacy test below pins as never reaching the DOM.
 *
 * An import carries the user's own edits and nothing else, so those five entries
 * are the whole preview — both mapped ones land on a key Ori Studio already
 * answers, which is exactly the dead end "Use anyway" exists to open up.
 */
const FIXTURES = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../lib/orieditaImport/__fixtures__'
);

const CONFIG_JSON_PATH = '/Users/someone/origami';

function fixtureBytes(name: string): Uint8Array {
  const bytes = readFileSync(resolve(FIXTURES, `${name}.oriconfig`));
  // `readFileSync` returns a window onto a shared pool for small files; copy out
  // so the bytes look like what `File.arrayBuffer()` hands the real caller.
  return new Uint8Array(bytes);
}

function openedFile(bytes: Uint8Array) {
  return {
    bytes,
    name: 'my-oriedita-settings.oriconfig',
    path: `${CONFIG_JSON_PATH}/my-oriedita-settings.oriconfig`,
    mimeType: 'application/octet-stream',
  };
}

const initialShortcutState = useShortcutStore.getInitialState();

let root: Root | null = null;
let container: HTMLDivElement | null = null;
const onClose = vi.fn();

function render() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(<OrieditaImportDialog onClose={onClose} />);
  });
  return container;
}

/**
 * Click and let the archive read settle. Inflating an entry goes through a
 * `DecompressionStream`, which resolves over several turns of the event loop
 * rather than a single microtask flush.
 */
async function clickAndSettle(button: HTMLElement): Promise<void> {
  await act(async () => {
    button.click();
    for (let turn = 0; turn < 20; turn += 1) {
      await new Promise((done) => setTimeout(done, 0));
    }
  });
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(container?.querySelectorAll('button') ?? []).find((element) =>
    element.textContent?.includes(label)
  );
  expect(found, `no button matching ${label}`).toBeDefined();
  return found as HTMLButtonElement;
}

function rowText(row: Element): string {
  return ['action', 'note', 'chord']
    .map((part) => row.querySelector(`.oriedita-import__${part}`)?.textContent ?? '')
    .join(' | ');
}

/** Every previewed row as `action | note | chord`, in the order shown. */
function rows(): string[] {
  return Array.from(container?.querySelectorAll('.oriedita-import__row') ?? []).map(rowText);
}

function sectionFor(heading: string): Element | undefined {
  return Array.from(container?.querySelectorAll('.settings-section') ?? []).find((element) =>
    element.querySelector('.settings-section__title')?.textContent?.includes(heading)
  );
}

/** The rows under one of the outcome headings, which is what groups them. */
function rowsUnder(heading: string): string[] {
  return Array.from(sectionFor(heading)?.querySelectorAll('.oriedita-import__row') ?? []).map(
    rowText
  );
}

function rowElementFor(action: string): Element {
  const row = Array.from(container?.querySelectorAll('.oriedita-import__row') ?? []).find(
    (element) => rowText(element).startsWith(`${action} |`)
  );
  expect(row, `no row for ${action}`).toBeDefined();
  return row as Element;
}

function rowFor(action: string): string {
  return rowText(rowElementFor(action));
}

/** The "Use anyway" button on one row, which only a row with an offer has. */
function useAnywayOn(action: string): HTMLButtonElement | undefined {
  return Array.from(rowElementFor(action).querySelectorAll('button')).find((element) =>
    element.textContent?.includes('Use anyway')
  );
}

async function click(element: HTMLElement): Promise<void> {
  await act(async () => {
    element.click();
  });
}

/**
 * Press one chord through the real dispatcher, in the crease-pattern context an
 * Oriedita importer works in, and report which action ran.
 *
 * The store's own state is the input: a chord the dialog said it applied has to
 * fire *its own* action afterwards, and only the real runtime can answer that.
 * An eviction is where this earns its keep — the freed key must now reach the
 * importing action rather than the binding that was unbound.
 */
function pressAndSee(event: KeyboardEvent): ShortcutActionId | null {
  let firedId: ShortcutActionId | null = null;
  const record = (id: ShortcutActionId): void => {
    firedId = id;
  };
  handleShortcutKeyDown(event, {
    scopeStack: shortcutScopeStackForContext({
      activeEditingContext: 'crease-pattern',
      activeViewportSurface: 'crease-pattern',
      simulatorFocused: false,
    }),
    overrides: useShortcutStore.getState().overrides,
    // The dialog plans against the active layout, so the check on what actually
    // fires has to run on the same one — reading only the overrides would judge
    // an Oriedita-source import against the Ori Studio keyboard and agree with
    // itself for the wrong reason.
    defaultsSource: useShortcutStore.getState().defaultsSource,
    executors: {
      menu: record,
      cpAction: record,
      viewport: (id) => {
        record(id);
        return true;
      },
    },
  });
  return firedId;
}

async function openSample(name = 'sample'): Promise<void> {
  openBinaryFile.mockResolvedValue(openedFile(fixtureBytes(name)));
  render();
  await clickAndSettle(button('Choose Settings Export'));
}

beforeEach(() => {
  localStorage.clear();
  useShortcutStore.setState(initialShortcutState, true);
  openBinaryFile.mockReset();
  onClose.mockReset();
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe('OrieditaImportDialog', () => {
  it('previews the archive’s own hotkeys and nothing else', async () => {
    await openSample();

    // No mode control: the dialog no longer asks whether to bring Oriedita's
    // layout along, so nothing outside the file may appear.
    expect(container?.textContent).not.toContain('Only my customizations');
    expect(container?.textContent).not.toContain("Match Oriedita's keyboard");
    expect(rows()).toHaveLength(5);
    expect(rows().some((row) => row.startsWith('Save |'))).toBe(false);
    expect(container?.textContent).toContain('This applies the hotkeys you changed in Oriedita');

    expect(useShortcutStore.getState().overrides).toEqual({});
  });

  it('gives every skipped row a reason in plain language', async () => {
    await openSample();

    const skipped = rowsUnder('Skipped');
    expect(skipped).toContain(
      'spacedAction | no matching action — Ori Studio has no matching action. | shift ctrl pressed V'
    );
    // The blank value is the one that must never read as an unbind.
    expect(rowFor('clearedAction')).toContain(
      'Left blank in Oriedita. Oriedita writes the same blank when a hotkey is reset to its default'
    );
    // Shift+A is Measure Angle's here, so the user's own Mountain edit loses —
    // and the row names the binding it would have taken the key from.
    expect(rowFor('Mountain')).toContain('Would take this key away from Measure Angle.');
    expect(skipped.every((row) => row.includes(' — '))).toBe(true);

    expect(useShortcutStore.getState().overrides).toEqual({});
  });

  it('never shows the file it read, or anything from config.json', async () => {
    await openSample();

    const shown = container?.textContent ?? '';
    expect(shown).not.toContain('my-oriedita-settings');
    expect(shown).not.toContain(CONFIG_JSON_PATH);
    expect(shown).not.toContain('crane.cp');
  });

  it('offers nothing to apply until a blocked row is let through', async () => {
    await openSample();

    // Both mapped hotkeys collide with something Ori Studio already answers, so
    // there is nothing honest to apply yet.
    expect(rowsUnder('Will change')).toEqual([]);
    expect(button('Apply').disabled).toBe(true);
    // An unmapped action has no blocker to unbind, so it gets no way through.
    expect(useAnywayOn('spacedAction')).toBeUndefined();
    expect(useAnywayOn('clearedAction')).toBeUndefined();
  });

  it('applies a shadowed row on Use anyway, and says what it costs', async () => {
    await openSample();
    const offer = useAnywayOn('Mountain');
    expect(offer).toBeDefined();
    // The screen-reader name is where the displaced binding is stated, since the
    // note above it already says who answers the key first.
    expect(offer?.getAttribute('aria-label')).toContain('Measure Angle');

    await click(offer as HTMLButtonElement);

    expect(rowsUnder('Will change')).toEqual([
      'Mountain | crease-pattern — Replaces A | Shift+A',
    ]);
    expect(rowsUnder('Will be unbound')).toEqual([
      'Measure Angle | Gives up this key to Mountain, and is left unassigned. | Shift+A',
    ]);
    expect(button('Apply').disabled).toBe(false);
    // Still nothing written: consent to unbind is not consent to import.
    expect(useShortcutStore.getState().overrides).toEqual({});
  });

  it('takes the offer back when the displaced binding is kept', async () => {
    await openSample();
    await click(useAnywayOn('Mountain') as HTMLButtonElement);

    await click(button('Keep it'));

    expect(rowsUnder('Will be unbound')).toEqual([]);
    expect(rowsUnder('Will change')).toEqual([]);
    expect(rowFor('Mountain')).toContain('Would take this key away from Measure Angle.');
  });

  it('applies exactly the rows it previewed, in a single persist', async () => {
    await openSample();
    await click(useAnywayOn('Mountain') as HTMLButtonElement);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    await click(button('Apply'));

    // The whole point of the bulk action: the new binding and the removal it
    // needed land in one write, never leaving the chord claimed twice.
    expect(setItem.mock.calls.filter(([key]) => key === SHORTCUT_STORAGE_KEY)).toHaveLength(1);

    const { overrides } = useShortcutStore.getState();
    expect(overrides['cp.action.line-type.mountain']).toEqual([{ key: 'a', shift: true }]);
    // The displaced binding is unbound outright, not merely left at its default,
    // or the dispatcher would keep handing it the chord.
    expect(overrides['cp.action.display-angle-between-three-points1']).toBeNull();
    // Nothing else: the archive's other mapped hotkey stayed blocked, and a row
    // the preview called skipped must never reach the store.
    expect(Object.keys(overrides)).toHaveLength(2);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('hands the freed key to the action that took it', async () => {
    await openSample();
    await click(useAnywayOn('Mountain') as HTMLButtonElement);
    await click(button('Apply'));

    // A real keydown, not the plan's own chord fed back in: Shift+A reports the
    // shifted character. Measure Angle held this key until the eviction, so a
    // binding that plans and applies but still runs the old action is exactly the
    // failure "Use anyway" would be lying about.
    const fired = pressAndSee(
      new KeyboardEvent('keydown', { key: 'A', shiftKey: true, bubbles: true, cancelable: true })
    );
    expect(fired).toBe('cp.action.line-type.mountain');
  });

  it('writes nothing when the import is cancelled', async () => {
    await openSample();
    await click(useAnywayOn('Mountain') as HTMLButtonElement);
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    await click(button('Cancel'));

    expect(onClose).toHaveBeenCalledOnce();
    expect(useShortcutStore.getState().overrides).toEqual({});
    expect(setItem).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });

  it('explains a file that is not a settings export', async () => {
    openBinaryFile.mockResolvedValue(openedFile(new Uint8Array([1, 2, 3, 4])));
    render();
    await clickAndSettle(button('Choose Settings Export'));

    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(
      'not an Oriedita settings export'
    );
    expect(rows()).toEqual([]);
    expect(useShortcutStore.getState().overrides).toEqual({});
  });

  it('has nothing to carry over from an export with no edited hotkeys', async () => {
    await openSample('no-hotkey');

    expect(container?.textContent).toContain('This export has no edited hotkeys');
    // And it points at the preference that does move the whole keyboard.
    expect(container?.textContent).toContain('Oriedita defaults');
    expect(rows()).toEqual([]);
    expect(button('Apply').disabled).toBe(true);
  });

  it('says so when the file cannot be read at all', async () => {
    openBinaryFile.mockRejectedValue(new Error('permission denied'));
    render();
    await clickAndSettle(button('Choose Settings Export'));

    expect(container?.querySelector('[role="alert"]')?.textContent).toContain(
      'could not be read'
    );
  });

  it('returns to the start when the picker is dismissed', async () => {
    openBinaryFile.mockResolvedValue(null);
    render();
    await clickAndSettle(button('Choose Settings Export'));

    expect(button('Choose Settings Export').disabled).toBe(false);
    expect(container?.querySelector('[role="alert"]')).toBeNull();
  });

  it('closes on Escape without writing', async () => {
    await openSample();

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(useShortcutStore.getState().overrides).toEqual({});
  });
});
