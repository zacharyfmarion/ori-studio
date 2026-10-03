import type { KeyboardEvent } from 'react';

/**
 * Whether a key belongs to an input method's composition — the Enter that
 * accepts a kana-to-kanji conversion, the Escape that cancels one. A field's
 * own Enter and Escape must leave those alone, or a Japanese, Chinese or
 * Korean title commits mid-word. `keyCode` 229 is what WebKit reports for the
 * keydown that ends a composition, where `isComposing` is already false.
 */
export function isComposingKey(event: KeyboardEvent): boolean {
  return event.nativeEvent.isComposing || event.keyCode === 229;
}
