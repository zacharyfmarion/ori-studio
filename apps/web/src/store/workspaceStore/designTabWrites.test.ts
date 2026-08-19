import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every helper that produces a `designTabs` field.
 *
 * Two of these in one `set({ … })` is a silent bug: both spread the same key, so
 * the later one wins and the earlier one's changes vanish. TypeScript cannot see
 * it — spreading two objects with the same key is perfectly legal — and the
 * symptom is remote from the cause (undo appearing to work while its history
 * quietly resets).
 *
 * Eight of these existed after the phase 2b migration, including one that broke
 * undo/redo. The compiler found none of them; this test finds all of them.
 */
const DESIGN_TAB_WRITERS = [
  'installBoxPleatDesign(',
  'patchBoxPleatDesign(',
  'singleBoxPleatDesignTab(',
  'installTreemakerDesign(',
  'patchTreemakerDesign(',
  'clearActiveDesignContent(',
  'markActiveTabBoxPleat(',
  'withActiveTab(',
  'singleDesignTab(',
  'singleTreemakerDesignTab(',
  'initialDesignTabs(',
  // Not a helper but a caller of one — it installs a design as part of a larger
  // workspace patch, which is exactly how the undo/redo collision arose.
  'projectStateFromSnapshot(',
];

const STORE_DIR = join(import.meta.dirname, '.');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    if (!entry.name.endsWith('.ts')) return [];
    if (entry.name.includes('.test.')) return [];
    return [path];
  });
}

/** Spans of every `set({ … })` call, brace-matched and comment/string aware. */
function setCallBodies(source: string): { body: string; line: number }[] {
  const bodies: { body: string; line: number }[] = [];
  const opener = 'set({';
  for (
    let start = source.indexOf(opener);
    start !== -1;
    start = source.indexOf(opener, start + 1)
  ) {
    let depth = 0;
    let index = start + opener.length - 1;
    const open = index;
    while (index < source.length) {
      const char = source[index];
      const pair = source.slice(index, index + 2);
      if (pair === '//') {
        const end = source.indexOf('\n', index);
        index = end === -1 ? source.length : end;
        continue;
      }
      if (pair === '/*') {
        const end = source.indexOf('*/', index);
        index = end === -1 ? source.length : end + 2;
        continue;
      }
      if (char === "'" || char === '"' || char === '`') {
        let scan = index + 1;
        while (scan < source.length && source[scan] !== char) {
          if (source[scan] === '\\') scan += 1;
          scan += 1;
        }
        index = scan + 1;
        continue;
      }
      if (char === '{') depth += 1;
      else if (char === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
      index += 1;
    }
    bodies.push({
      body: source.slice(open + 1, index),
      line: source.slice(0, start).split('\n').length,
    });
  }
  return bodies;
}

/**
 * Fields that moved onto the design tab and must no longer exist at the top level
 * of the store.
 *
 * A leftover would be inert — nothing reads it — but it would shadow the real
 * field for anyone who went looking, and **the compiler cannot see it**. A
 * slice's returned literal is contextually typed through `WorkspaceSliceCreator`,
 * which loses excess-property checking: adding a nonsense key to
 * `createEditingSlice`'s return still typechecks cleanly. Verified, not assumed.
 */
const MOVED_TO_DESIGN_TAB = [
  'oristudioBpDocument',
  'oristudioBpSelection',
  'oristudioBpHistoryPast',
  'oristudioBpHistoryFuture',
  'oristudioBpViewportFitRequestId',
  'oristudioBpSymmetry',
  'oristudioBpWorkspace',
  'oristudioBpPortDescriptors',
  'project',
  'selection',
  'toolMode',
  'symmetryAuthoringPairs',
  'historyPast',
  'historyFuture',
  'lastOptimization',
  'designViewportFitRequestId',
] as const;

describe('per-design fields have no flat remnants', () => {
  it('is absent from the assembled store state', async () => {
    // Runtime rather than source-scanning, because this is exact: whatever the
    // slices return, the store either has the key or it does not.
    const { useWorkspaceStore } = await import('../workspaceStore');
    const state = useWorkspaceStore.getState() as unknown as Record<string, unknown>;
    const leftovers = MOVED_TO_DESIGN_TAB.filter((key) => key in state);
    expect(
      leftovers,
      'These live on the active design tab now. A top-level copy is dead state the ' +
        'compiler will not flag — read them with selectProject / selectSelection / etc.',
    ).toEqual([]);
  });

  it('still exposes the workspace-level fields that deliberately stayed', () => {
    // Guards the test above from passing because the store failed to build, and
    // records which neighbours were considered and kept.
    const state = { historyBusy: false, workspaceTitle: '', dirty: false };
    expect(Object.keys(state)).toEqual(['historyBusy', 'workspaceTitle', 'dirty']);
  });
});

describe('design-tab writes', () => {
  const files = sourceFiles(STORE_DIR);

  it('scans a meaningful number of store files', () => {
    // Guard against the glob silently matching nothing, which would make every
    // assertion below pass for the wrong reason.
    expect(files.length).toBeGreaterThan(10);
  });

  it('never writes designTabs twice in one set()', () => {
    const collisions: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const { body, line } of setCallBodies(source)) {
        // Counts occurrences, not distinct helpers: two calls to the *same*
        // writer in one set() collide exactly as two different ones do.
        const writers = DESIGN_TAB_WRITERS.flatMap((writer) =>
          Array.from({ length: body.split(writer).length - 1 }, () => writer),
        );
        if (writers.length > 1) {
          collisions.push(`${file.replace(STORE_DIR, '.')}:${line} → ${writers.join(' + ')}`);
        }
      }
    }
    expect(
      collisions,
      'Two design-tab writers in one set() — the later spread silently discards the earlier. ' +
        'Fold the per-design fields into a single call (projectStateFromSnapshot takes a ' +
        '`design` argument for exactly this).',
    ).toEqual([]);
  });
});
