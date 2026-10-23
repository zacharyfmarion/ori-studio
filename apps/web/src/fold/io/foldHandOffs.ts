/**
 * What leaves a Fold sequence (plan D6, D10, D11): Send to Edit, the FOLD
 * export and the paper export of its steps. Each follows the active path —
 * root, the active child of each step, to the tip — whichever step is on
 * screen.
 *
 * Each holds the engine for as long as it works, so it runs from the menu
 * with no Fold surface mounted: the session replays the path if it must, and
 * a hand-off waits for every step of it to land. A path with a step that no
 * longer folds, or one this build cannot read, is not handed off: it would be
 * half a sequence.
 *
 * The app's stores, toasts and file dialogs are injected
 * (`FoldHandOffDeps`), so the hand-offs are tested over a fake session; the
 * app binds them in `foldIoCommands.ts`.
 */

import type { TFunction } from 'i18next';
import type { SendToEditPayload } from '../../designKinds/types';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import type { PaperExportScope, PaperExportTarget } from '../../paperExport/paperExportTarget';
import { exportFilename } from '../../platform/exportFilename';
import type { FileService } from '../../platform/fileService';
import { foldOpSteps } from '../document/foldSequenceDocument';
import type { FoldEngineStateHandle } from '../engine/foldEnginePort';
import { foldSendToEditPayload } from '../engine/foldEngineIoSendToEdit';
import type { FoldEngineRefused } from '../engine/foldEngineWire';
import type { FoldSession, FoldSessionWorker } from '../session/foldSession';
import { foldPathReady, type FoldPathReady } from './foldSessionWaits';
import {
  foldStepCreaseDiagram,
  foldStepIsNumbered,
  foldStepsExportTarget,
  type FoldStepPage,
} from './foldStepPages';

/** Why a hand-off did not happen, for the toast. */
export type FoldHandOffBlock =
  /** A step of the active path no longer folds, or was made by a newer build. */
  | 'path-broken'
  /** The engine could not be reached, or went away mid-way. */
  | 'unavailable'
  /** The path has no numbered step: nothing to export. */
  | 'no-step'
  /** "This step" with the flat sheet on screen, or a turn before the first step: no page to open on. */
  | 'sheet-on-screen'
  /** The FOLD file would be over the export's size cap. */
  | 'too-large';

export interface FoldHandOffDeps {
  session: FoldSession;
  t: TFunction;
  /** The sequence's title, or the project's: what the files and the merge are named. */
  title: () => string;
  /** Say why a hand-off did not happen. */
  blocked: (why: FoldHandOffBlock) => void;
  /** Merge the crease pattern into Edit's — the chokepoint every Send to Edit goes through — and show Edit. */
  sendToEdit: (payload: SendToEditPayload) => Promise<boolean>;
  /** The analytics event for a Send to Edit that landed. */
  sentToEdit: () => void;
  fileService: () => FileService;
  /** The Settings export style. */
  exportStyle: () => PaperStyle;
  /** Open the export dialog on a target. */
  openPaperExport: (target: PaperExportTarget, scope: PaperExportScope) => void;
}

/** The title the engine writes into a file: the sequence's, or "Untitled". */
function stem(title: string): string {
  return title.trim() || 'Untitled';
}

/**
 * A file's name from the title, by the rule every export's name is made by
 * (`exportFilename`): a title with a slash or a colon in it is no path, and a
 * desktop dialog would read it as one.
 */
function foldFilename(title: string): string {
  return exportFilename(title, 'fold');
}

/**
 * Run `handOff` with the active path landed, the engine held while it does.
 * False, and the reason said, when the path cannot be handed off.
 */
async function withLandedPath(
  deps: FoldHandOffDeps,
  handOff: (path: FoldPathReady) => Promise<boolean>
): Promise<boolean> {
  const release = deps.session.retain();
  try {
    const path = await foldPathReady(deps.session);
    if (path.status !== 'ready') {
      deps.blocked(path.reason === 'no-state' ? 'path-broken' : 'unavailable');
      return false;
    }
    return await handOff(path);
  } finally {
    release();
  }
}

/** The path's last state: its tip, or the sheet for a sequence with no step. */
function tipOf(path: FoldPathReady): FoldEngineStateHandle {
  return path.steps.at(-1)?.state ?? path.sheet;
}

/** Ask the engine about a landed state; null, with the reason said, when it no longer holds it. */
async function ask<T>(
  deps: FoldHandOffDeps,
  state: FoldEngineStateHandle,
  call: (engine: FoldSessionWorker, id: number) => Promise<T>
): Promise<T | null> {
  const answer = await deps.session.withState(state, call);
  if (answer.status === 'answered') return answer.value;
  deps.blocked('unavailable');
  return null;
}

/**
 * Send to Edit (plan D10): the tip's crease pattern as FOLD, merged into
 * Edit's through `importAddOristudioCpText` with its undo entry. Precreases
 * arrive as auxiliary lines (`foldSendToEditPayload`); the folds keep their
 * letters.
 */
export async function sendFoldSequenceToEdit(deps: FoldHandOffDeps): Promise<boolean> {
  return withLandedPath(deps, async (path) => {
    const title = stem(deps.title());
    const text = await ask(deps, tipOf(path), (engine, id) => engine.sendToEdit(id, title));
    if (text === null) return false;
    const payload = foldSendToEditPayload(text, {
      label: deps.t('common:toolbar.sendToEdit', 'Send to Edit'),
      filename: foldFilename(title),
    });
    const sent = await deps.sendToEdit(payload);
    if (sent) deps.sentToEdit();
    return sent;
  });
}

/** The FOLD export (plan D10): the active path, the sheet first, one frame per state, saved through the platform's dialog. */
export async function exportFoldSequence(deps: FoldHandOffDeps): Promise<boolean> {
  return withLandedPath(deps, async (path) => {
    const title = stem(deps.title());
    const states = [path.sheet, ...path.steps.map((step) => step.state)].map((state) => state.id);
    const exported = await ask(deps, tipOf(path), (engine) => engine.exportFold(states, title));
    if (exported === null) return false;
    if (exported.status !== 'ok') {
      deps.blocked(isTooLarge(exported) ? 'too-large' : 'unavailable');
      return false;
    }
    const saved = await deps.fileService().saveTextFile({
      title: deps.t('dialogs:foldExport.title', 'Export Fold Sequence'),
      contents: exported.text,
      suggestedName: foldFilename(title),
      extensions: ['fold'],
    });
    return saved !== null;
  });
}

function isTooLarge(refused: FoldEngineRefused): boolean {
  return refused.refusal.code === 'fold_export_too_large';
}

/**
 * The paper export of the steps (plan D11): one page per numbered step of
 * the active path, each its crease pattern with the step's creases the
 * instruction, opened on the step on screen (`this`) or on all of them.
 */
export async function openFoldStepsExport(deps: FoldHandOffDeps, scope: PaperExportScope): Promise<boolean> {
  const cursor = deps.session.store.getState().cursor;
  return withLandedPath(deps, async (path) => {
    const pages: FoldStepPage[] = [];
    // The page on show: the step on screen, or the numbered one before it.
    let current = -1;
    for (const step of path.steps) {
      if (foldStepIsNumbered(step.op)) {
        const drawn = await ask(deps, step.state, async (engine, id) => {
          const [scene, summary] = await Promise.all([engine.scene(id), engine.summary(id)]);
          // Every crease the step made: a Repeat's every operation's.
          return foldStepCreaseDiagram(scene.creases, summary.sheet, summary.step, summary.step - foldOpSteps(step.op));
        });
        if (drawn === null) return false;
        pages.push({ number: pages.length + 1, diagram: drawn });
      }
      if (step.id === cursor) current = pages.length - 1;
    }
    if (pages.length === 0 || (scope === 'this' && current < 0)) {
      deps.blocked(pages.length === 0 ? 'no-step' : 'sheet-on-screen');
      return false;
    }
    const target = foldStepsExportTarget({
      pages,
      current: Math.max(current, 0),
      title: deps.title(),
      exportStyle: deps.exportStyle(),
      t: deps.t,
    });
    deps.openPaperExport(target, scope);
    return true;
  });
}
