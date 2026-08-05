import type { DesignKindId } from '../designKinds';

/**
 * The `.osf` v8 design-document shape.
 *
 * One generic payload for every design kind, rather than a per-kind branch. The
 * v1–v7 format spelled a TreeMaker design `{ tree: { format: 'tmd5', text } }`
 * and a box-pleat one `{ project: { engine, format, text } }`, which meant the
 * file-format module carried a hardcoded `if` per kind — the exact shape that
 * makes "adding a third design kind is trivial" false.
 *
 * v8 stores what every kind has: the id of the kind, and the text its codec
 * produced. The registry knows the rest.
 */
export interface NativeDesignPayload {
  /** Design kind id, matched against the registry at parse time. */
  kind: string;
  /** Codec output — `.tmd5` for TreeMaker, `.bps` for box-pleat. */
  text: string;
  /** Free-form label for the payload's dialect, for diagnostics and diffs. */
  format: string;
}

export interface NativeDesignDocumentV8 {
  /** Stable across saves. Also the design tab's id, so ordering survives. */
  id: string;
  /** Tab title. User-editable, so genuinely part of the document. */
  title: string;
  payload: NativeDesignPayload;
  /**
   * Per-design view state — the tab's serialized pane layout, and anything a
   * kind wants to remember about how it was being looked at.
   *
   * Validated drop-on-malformed, like the crease-pattern document's `viewport`
   * and `camera`: a corrupt layout must open with a default layout, never fail
   * the file.
   */
  viewState: Record<string, unknown>;
  extensions: Record<string, unknown>;
}

/**
 * The document id reserved for the Edit canvas's crease pattern.
 *
 * The crease pattern is not a design tab: there is exactly one, it has a
 * genuinely different shape, and `artifacts.fold.documentId` names it. Keeping
 * its id reserved is what lets design tab ids and this coexist in one array.
 *
 * v1–v7 also used `'tree'` and `'box-pleat'` as document ids, and a migrated
 * file keeps those verbatim as tab ids — so tab ids are *not* always `design-N`,
 * and nothing may assume otherwise.
 */
export const CREASE_PATTERN_DOCUMENT_ID = 'crease-pattern';

/** Whether a design tab may claim this id. */
export function isReservedDocumentId(id: string): boolean {
  return id === CREASE_PATTERN_DOCUMENT_ID;
}

/** The payload format label a kind writes. Diagnostics only; never parsed. */
export function designPayloadFormat(kind: DesignKindId): string {
  return kind === 'box-pleat' ? 'bps' : 'tmd5';
}
