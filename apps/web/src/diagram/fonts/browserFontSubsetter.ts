/**
 * The subsetter, loaded once on the first page composed: HarfBuzz's subset
 * wasm from harfbuzzjs, served from the bundle.
 */
import subsetWasmUrl from 'harfbuzzjs/dist/harfbuzz-subset.wasm?url';
import { createFontSubsetter, type FontSubsetter } from './fontSubset';

let loading: Promise<FontSubsetter> | null = null;

export function browserFontSubsetter(): Promise<FontSubsetter> {
  if (!loading) {
    const pending = fetch(subsetWasmUrl)
      .then((response) => {
        if (!response.ok) throw new Error(`harfbuzz-subset.wasm: ${response.status}`);
        return response.arrayBuffer();
      })
      .then((bytes) => createFontSubsetter(bytes));
    loading = pending;
    // A failure is forgotten, so the next page tries again.
    pending.catch(() => {
      if (loading === pending) loading = null;
    });
  }
  return loading;
}
