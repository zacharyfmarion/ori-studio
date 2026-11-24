/**
 * The lines each old folded link's sheet held when its pattern was opened:
 * what tells an aux edit made since on a step whose link never kept the lines
 * it draws (`drawnLinesUntracked`). Its folds alone cannot tell one, and a file
 * saved before links kept them holds nothing else, so without this every
 * folded step of such a file read up to date after an aux edit until its
 * first Refresh.
 *
 * What a picture showed before the open cannot be told — its file never said —
 * so a step already behind when the file opened reads as it did, with Refresh
 * offered. Nor does a baseline outlive the session: a save writes none, and the
 * next open takes the lines as they were saved.
 *
 * One slot, like the link status caches: one crease pattern is open at a time.
 * Filled by `installOpenedLinesSync` once the sheet index for the lines as
 * they opened lands, and emptied when another pattern is loaded.
 */
import type { CpSheetIndex } from '../../engine/oristudioCpSheetIndex';
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import type { DiagramCpScope, DiagramCpSource } from '../document/diagramDocument';
import { chooseStepCreases, knownCreasesOf, type KnownCreases } from './captureCreases';

/** What a baseline is taken for: an old link's scope, and the creases it remembers. */
export type OpenedLinkSource = Pick<DiagramCpSource, 'scope' | 'fingerprint' | 'render'>;

/** Each link's sheet's drawn-lines fingerprint as the pattern opened, by {@link baselineKey}. */
let opened: ReadonlyMap<string, string> | null = null;

/**
 * Take each link's sheet from `document` as it opened, found as its status
 * finds it (`chooseStepCreases`), and keep the lines it draws. A link whose
 * sheet cannot be found gets none, and reads as it did.
 */
export function rememberOpenedLines(
  document: OristudioCpDocumentSnapshot,
  sheets: CpSheetIndex,
  sources: Iterable<OpenedLinkSource>
): void {
  const drawn = new Map<string, string>();
  for (const source of sources) {
    const known = knownCreasesOf(source);
    const choice = chooseStepCreases(document, source.scope, sheets, known);
    if (choice.status === 'found') drawn.set(baselineKey(source.scope, known), choice.creases.drawnFingerprint);
  }
  opened = drawn;
}

/** Drop the baselines: another pattern was loaded. */
export function forgetOpenedLines(): void {
  opened = null;
}

/** The drawn-lines fingerprint `scope`'s sheet had when its pattern opened, or undefined when none was taken. */
export function openedDrawnFingerprint(scope: DiagramCpScope, known: KnownCreases): string | undefined {
  return opened?.get(baselineKey(scope, known));
}

/** By what the link says rather than its objects: an undo may give a step back a copy of its source. */
function baselineKey(scope: DiagramCpScope, known: KnownCreases): string {
  return `${known.drawn ? 'drawn' : 'fold'}|${known.fingerprint ?? ''}|${scopeKey(scope)}`;
}

const scopeKeys = new WeakMap<DiagramCpScope, string>();

function scopeKey(scope: DiagramCpScope): string {
  let key = scopeKeys.get(scope);
  if (key === undefined) {
    key = JSON.stringify(scope);
    scopeKeys.set(scope, key);
  }
  return key;
}
