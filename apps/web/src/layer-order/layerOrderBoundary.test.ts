/**
 * The Layer order dialog's two boundaries
 * (`implementation-plans/layer-order-dialog.md`, approach 5 and "Risks").
 *
 * 1. **The dialog knows no host.** Edit's figures, an Edit selection, a
 *    Diagram step and Pose each hand it a `LayerOrderRequest` and take back a
 *    `LayerOrderApplied` (`lib/layerOrder/`); it reads no store and no host's
 *    document. A module under `layer-order/` that imports Edit's workspace
 *    store, the Diagram or the Fold workspace makes the dialog depend on how
 *    one host keeps its state, and a change there breaks every other host.
 * 2. **The Fold engine never loads with the page.** Its wasm (about 1 MB
 *    gzipped) is fetched only when a worker that needs it starts, so it is
 *    imported only inside `workers/`. A module anywhere else that imports the
 *    glue, even for a type, pulls it into a chunk the page loads.
 * 3. **The inspector model is pure** (U9, AGENTS.md's panel rules). Under
 *    `layer-order/model/` there is no React, no store, no package at all and
 *    no engine runtime: the reducer describes its effects as data and the
 *    hook (U10) runs them. It reads the engine's types and pure helpers only,
 *    through `model/layerOrderEngineFacts.ts`.
 * 4. **Hosts come in through the doors** (U4). The dialog's component and
 *    everything it brings (`components/layer-order/`, but for the app root's
 *    mount) are one lazy chunk, which only its gateway
 *    (`layer-order/dialog/layerOrderDialogGateway.ts`) imports, and only by
 *    `import()` or `import type`; the mount renders it once the gateway has
 *    loaded it, and imports none of it. A host, and the mount like one,
 *    reaches the dialog through that gateway and the host engine through its
 *    own (`host/hostEngineGateway.ts`), never the dialog's other modules, the
 *    engine runtime or the host engine itself, so neither the runtime,
 *    comlink nor a worker's URL joins a chunk the page loads.
 *
 * The dialog's components (`components/layer-order/`) are held to the first
 * rule too: they draw what a request hands them and read no host's state.
 *
 * Tests and fixtures may reach anything: they never ship.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest's root is `apps/web`, as the stylesheet ratchet reads it.
const SRC = resolve(process.cwd(), 'src');

const posix = (path: string) => path.split(sep).join('/');

/** Shipped sources under `dir`: no tests, no fixtures. */
function sourcesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = resolve(dir, name);
    if (statSync(path).isDirectory()) return name === 'generated' || name === 'test' ? [] : sourcesUnder(path);
    return /\.tsx?$/.test(name) && !/\.(test|fixtures)\.tsx?$/.test(name) ? [path] : [];
  });
}

/**
 * Every relative module `text` (the source of `file`) names, resolved under
 * `src/`: static imports and exports (types included), side-effect and
 * dynamic imports, and `new URL(…)` assets.
 */
function targetsIn(text: string, file: string): string[] {
  const specifiers = [
    ...text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\bnew\s+URL\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g),
  ].map((match) => match[1]!);
  return specifiers.map((specifier) => posix(relative(SRC, resolve(dirname(file), specifier))));
}

function importsOf(file: string): string[] {
  return targetsIn(readFileSync(file, 'utf8'), file);
}

/**
 * The relative modules `text` loads with it, resolved under `src/`: static
 * imports and re-exports that bring a value (side-effect ones included), not
 * `import type` or `export type`, and not a dynamic `import()`, which loads a
 * chunk of its own when it runs.
 */
function staticValueTargetsIn(text: string, file: string): string[] {
  const specifiers = [
    ...text.matchAll(/(?:^|[;\n])\s*(?:import|export)\s+(?!type\b)(?:[^'";]*?\s+from\s+)?['"](\.{1,2}\/[^'"]+)['"]/g),
  ].map((match) => match[1]!);
  return specifiers.map((specifier) => posix(relative(SRC, resolve(dirname(file), specifier))));
}

/** A shipped module's path under `src/`, without its extension: what imports resolve to. */
const moduleOf = (file: string) => posix(relative(SRC, file)).replace(/\.tsx?$/, '');

/** The file a module path under `src/` names, or null for one that is not a source (a JSON, a package). */
function fileOf(module: string): string | null {
  for (const candidate of [`${module}.ts`, `${module}.tsx`, `${module}/index.ts`, `${module}/index.tsx`]) {
    const file = resolve(SRC, candidate);
    if (existsSync(file)) return file;
  }
  return null;
}

/** Every module `entry` loads with it: its static value imports, and theirs, under `src/`. */
function staticClosureOf(entry: string): Set<string> {
  const seen = new Set<string>();
  const waiting = [entry];
  while (waiting.length > 0) {
    const module = waiting.pop()!;
    if (seen.has(module)) continue;
    seen.add(module);
    const file = fileOf(module);
    if (file) waiting.push(...staticValueTargetsIn(readFileSync(file, 'utf8'), file));
  }
  return seen;
}

/** The hosts' own state and documents: what the dialog never reaches into. */
const HOSTS: readonly RegExp[] = [
  // Edit's workspace store, which also holds the Fold workspace's slices.
  /^store\/workspaceStore(\/|$)/,
  /^store\/diagram\w*$/,
  /^store\/selectionUiStore$/,
  /^components\/panels\//,
  /^diagram\//,
  /^components\/diagram\//,
  /^fold\//,
  /^components\/fold\//,
  /^workspaces\//,
];

const FOLD_WASM = /^generated\/oristudio-fold-wasm(\/|$)/;

const DIALOG_GATEWAY = 'layer-order/dialog/layerOrderDialogGateway';
const DIALOG_COMPONENT = 'components/layer-order/LayerOrderDialog';
const DIALOG_MOUNT = 'components/layer-order/LayerOrderDialogMount';
/** The dialog's lazy chunk: every module of its components but the mount. */
const DIALOG_CHUNK = new RegExp(`^components/layer-order/(?!LayerOrderDialogMount$)`);

/**
 * What a host never imports: the dialog's modules but its gateway (which
 * re-exports the outcome a host reads), the engine runtime and the host
 * engine.
 */
const BEHIND_THE_DOORS: readonly RegExp[] = [
  /^layer-order\/dialog\/(?!layerOrderDialogGateway$)/,
  /^layer-order\/engine\/layerOrderRuntime$/,
  /^layer-order\/host\/layerOrderHostEngine$/,
  /^layer-order\/host\/layerOrderSolutionCursor$/,
];

/** Every module `text` names, relative or a package: what the model's purity is checked on. */
function specifiersIn(text: string): string[] {
  return [...text.matchAll(/(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+|\bnew\s+URL\s*\(\s*)['"]([^'"]+)['"]/g)].map(
    (match) => match[1]!
  );
}

/**
 * What the inspector model may import, resolved under `src/`: itself, the
 * dialog's budgets, the engine contract's types and pure helpers (never its
 * runtime or worker), the record's types, and the analytics taxonomy's pure
 * bucketing.
 */
const MODEL_MAY_IMPORT: readonly RegExp[] = [
  /^layer-order\/model\/[\w.]+$/,
  // The dialog's measured budgets (D7's label cap): constants only, the cap's one source.
  /^layer-order\/layerOrderBudgets$/,
  /^layer-order\/engine\/(layerOrderEngine|layerOrderWire|faceIndex)$/,
  /^lib\/layerOrder\/layerOrderRecord$/,
  /^analytics\/events$/,
];

describe('the Layer order dialog’s boundaries', () => {
  it('finds the sources to check', () => {
    expect(sourcesUnder(resolve(SRC, 'layer-order')).length).toBeGreaterThan(2);
    expect(sourcesUnder(SRC).length).toBeGreaterThan(500);
  });

  it('nothing under layer-order/ or the dialog’s components imports a host', () => {
    const dialogComponents = sourcesUnder(resolve(SRC, 'components/layer-order'));
    expect(dialogComponents.length).toBeGreaterThan(2);
    const reaches = [...sourcesUnder(resolve(SRC, 'layer-order')), ...dialogComponents].flatMap((file) =>
      importsOf(file)
        .filter((target) => HOSTS.some((host) => host.test(target)))
        .map((target) => `${posix(relative(SRC, file))} → ${target}`)
    );
    expect(reaches).toEqual([]);
  });

  it('nothing but the gateway imports the dialog’s chunk, and the mount imports none of it', () => {
    const reaches = sourcesUnder(SRC).flatMap((file) => {
      const from = moduleOf(file);
      // The chunk's own modules import one another; the mount is outside it.
      if (from !== DIALOG_MOUNT && from.startsWith('components/layer-order/')) return [];
      return importsOf(file)
        .filter((target) => DIALOG_CHUNK.test(target) && !(from === DIALOG_GATEWAY && target === DIALOG_COMPONENT))
        .map((target) => `${from} → ${target}`);
    });
    expect(reaches).toEqual([]);
    // The gateway does import it, so the check above has something to let through.
    expect(importsOf(resolve(SRC, `${DIALOG_GATEWAY}.ts`))).toContain(DIALOG_COMPONENT);
  });

  it('the gateway reaches the dialog’s component only through import() or import type, so it loads with no page', () => {
    const gateway = resolve(SRC, `${DIALOG_GATEWAY}.ts`);
    expect(staticValueTargetsIn(readFileSync(gateway, 'utf8'), gateway)).not.toContain(DIALOG_COMPONENT);
  });

  it('what the gateway loads with the page holds nothing of the dialog or the engine but its leaves', () => {
    const loaded = staticClosureOf(DIALOG_GATEWAY);
    // Its own store, and the load-failure rule over the call-failure codes: nothing else of the dialog,
    // the engine, the wire contract or the workers.
    const ours = /^(layer-order|components\/layer-order|lib\/layerOrder|workers)\//;
    expect([...loaded].filter((module) => ours.test(module)).sort()).toEqual([
      'layer-order/dialog/layerOrderDialogGateway',
      'layer-order/dialog/layerOrderDialogStore',
      'layer-order/engine/layerOrderCallFailures',
      'layer-order/engine/layerOrderLoadFailure',
    ]);
    // It follows imports far enough to have seen the rest of what loads (the store's focus helper, say).
    expect(loaded).toContain('components/ui/useModalDialog');
  });

  it('tells a static value import from import type and import()', () => {
    const file = resolve(SRC, 'layer-order/dialog/example.ts');
    expect(
      staticValueTargetsIn(
        `
        import type * as Chunk from '../../components/layer-order/LayerOrderDialog';
        import type { LayerOrderDialogOpening } from './layerOrderDialogStore';
        export type { X } from './x';
        const chunk = () => import('../../components/layer-order/LayerOrderDialog');
        import { toast } from 'sonner';
        import { lazyModule } from '../../lib/lazyModule';
        import {
          beginLayerOrderDialog,
          type LayerOrderDialogOutcome,
        } from './layerOrderDialogStore';
        import '../../components/layer-order/LayerOrderDialogFrame';
        export { registerLayerOrderDialogMount } from './layerOrderDialogStore';
        import Dialog from '../../components/layer-order/LayerOrderDialog';
        `,
        file
      )
    ).toEqual([
      'lib/lazyModule',
      'layer-order/dialog/layerOrderDialogStore',
      'components/layer-order/LayerOrderDialogFrame',
      'layer-order/dialog/layerOrderDialogStore',
      DIALOG_COMPONENT,
    ]);
  });

  it('tells the chunk from the mount, and the doors from what is behind them', () => {
    expect(DIALOG_CHUNK.test(DIALOG_COMPONENT)).toBe(true);
    expect(DIALOG_CHUNK.test('components/layer-order/LayerOrderDialogFrame')).toBe(true);
    expect(DIALOG_CHUNK.test(DIALOG_MOUNT)).toBe(false);
    const behind = (target: string) => BEHIND_THE_DOORS.some((inside) => inside.test(target));
    expect(behind(DIALOG_GATEWAY)).toBe(false);
    expect(behind('layer-order/host/hostEngineGateway')).toBe(false);
    expect(behind('layer-order/dialog/useLayerOrderSession')).toBe(true);
    expect(behind('layer-order/engine/layerOrderRuntime')).toBe(true);
    expect(behind('layer-order/host/layerOrderHostEngine')).toBe(true);
    expect(behind('layer-order/host/layerOrderSolutionCursor')).toBe(true);
  });

  it('a host, the app root’s mount among them, reaches the dialog and the host engine only through their gateways', () => {
    /** Inside the doors: the dialog's own modules, its chunk and the workers; the mount stands outside, as a host does. */
    const inside = (module: string) =>
      /^(layer-order|workers)\//.test(module) || (DIALOG_CHUNK.test(module) && module !== DIALOG_MOUNT);
    const hosts = sourcesUnder(SRC).filter((file) => !inside(moduleOf(file)));
    expect(hosts.map(moduleOf)).toContain(DIALOG_MOUNT);
    const reaches = hosts.flatMap((file) =>
      importsOf(file)
        .filter((target) => BEHIND_THE_DOORS.some((door) => door.test(target)))
        .map((target) => `${moduleOf(file)} → ${target}`)
    );
    expect(reaches).toEqual([]);
  });

  it('no shipped module outside workers/ imports the Fold wasm glue', () => {
    const reaches = sourcesUnder(SRC)
      .filter((file) => !posix(relative(SRC, file)).startsWith('workers/'))
      .flatMap((file) =>
        importsOf(file)
          .filter((target) => FOLD_WASM.test(target))
          .map((target) => `${posix(relative(SRC, file))} → ${target}`)
      );
    expect(reaches).toEqual([]);
  });

  it('the inspector model imports no React, no store, no package and no engine runtime', () => {
    const model = resolve(SRC, 'layer-order/model');
    const files = sourcesUnder(model);
    expect(files.length).toBeGreaterThan(5);
    const reaches = files.flatMap((file) =>
      specifiersIn(readFileSync(file, 'utf8'))
        .map((specifier) =>
          specifier.startsWith('.') ? posix(relative(SRC, resolve(dirname(file), specifier))) : `package:${specifier}`
        )
        .filter((target) => !MODEL_MAY_IMPORT.some((allowed) => allowed.test(target)))
        .map((target) => `${posix(relative(SRC, file))} → ${target}`)
    );
    expect(reaches).toEqual([]);
  });

  it('the model’s check sees packages and the engine runtime', () => {
    const file = resolve(SRC, 'layer-order/model/example.ts');
    const named = specifiersIn(`
      import { useReducer } from 'react';
      import { create } from 'zustand';
      import type { X } from '../engine/layerOrderRuntime';
      import { y } from './layerOrderSentence';
    `);
    expect(named).toEqual(['react', 'zustand', '../engine/layerOrderRuntime', './layerOrderSentence']);
    const resolved = named.map((specifier) =>
      specifier.startsWith('.') ? posix(relative(SRC, resolve(dirname(file), specifier))) : `package:${specifier}`
    );
    expect(resolved.map((target) => MODEL_MAY_IMPORT.some((allowed) => allowed.test(target)))).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it('sees every shape of import it must catch', () => {
    const file = resolve(SRC, 'layer-order/engine/example.ts');
    expect(
      targetsIn(
        `
        import type { FoldEngine } from '../../generated/oristudio-fold-wasm/oristudio_fold_wasm';
        const wasm = await import('../../generated/oristudio-fold-wasm/oristudio_fold_wasm');
        import '../../store/workspaceStore';
        export { x } from '../../diagram/document/diagramDocument';
        new URL('../../generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm', import.meta.url);
        `,
        file
      )
    ).toEqual([
      'generated/oristudio-fold-wasm/oristudio_fold_wasm',
      'generated/oristudio-fold-wasm/oristudio_fold_wasm',
      'store/workspaceStore',
      'diagram/document/diagramDocument',
      'generated/oristudio-fold-wasm/oristudio_fold_wasm_bg.wasm',
    ]);
  });
});
