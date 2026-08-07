import type { DesignKindCodec } from '../designKinds/types';
import {
  createExploriDocument,
  parseExploriDocument,
  serializeExploriDocument,
  type ExploriDocument,
} from './document';

/**
 * ExplOri documents, behind the same handle interface the wasm engines use.
 *
 * There is no engine here — the document is plain JSON in this module's own map.
 * Wearing the handle interface anyway is what lets the document registry treat
 * every design the same way: acquire, park, evict, serialize. Parking a JSON
 * document is nearly free, and going through it rather than around it means the
 * LRU, the `.osf` writer and undo all keep working without a special case.
 *
 * The consequence to remember is the one parking implies: **a park round-trips
 * through `serialize`/`hydrate`, so anything not in the document is lost on a
 * tab switch.** That is why the chosen result lives in the document and the rest
 * of a result list lives in a cache keyed by design id, not by handle.
 */

const documents = new Map<number, ExploriDocument>();
let nextHandle = 1;

export function exploriDocument(handle: number): ExploriDocument | null {
  return documents.get(handle) ?? null;
}

/** Replace a handle's document. Returns false for a handle already freed. */
export function replaceExploriDocument(handle: number, next: ExploriDocument): boolean {
  if (!documents.has(handle)) return false;
  documents.set(handle, next);
  return true;
}

export function createExploriCodec(): DesignKindCodec {
  return {
    async create() {
      const handle = nextHandle;
      nextHandle += 1;
      documents.set(handle, createExploriDocument());
      return handle;
    },
    async hydrate(text: string) {
      const handle = nextHandle;
      nextHandle += 1;
      documents.set(handle, parseExploriDocument(text));
      return handle;
    },
    async serialize(handle: number) {
      const document = documents.get(handle);
      if (!document) throw new Error(`No ExplOri document for handle ${handle}`);
      return serializeExploriDocument(document);
    },
    async free(handle: number) {
      documents.delete(handle);
    },
  };
}
