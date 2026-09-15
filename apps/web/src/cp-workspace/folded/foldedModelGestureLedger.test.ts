import { describe, expect, it } from 'vitest';
import { createFoldedModelGestureLedger } from './foldedModelGestureLedger';

const front = { scope: 'folded-color:f1:front_color', label: 'Change folded model color' };
const back = { scope: 'folded-color:f1:back_color', label: 'Change folded model color' };

describe('foldedModelGestureLedger', () => {
  it('opens a scope once, however many changes it streams', () => {
    const ledger = createFoldedModelGestureLedger();
    expect(ledger.open(front)).toBe(true);
    expect(ledger.open(front)).toBe(false);
    expect(ledger.isOpen(front.scope)).toBe(true);
  });

  it('closes only the open scope, exactly once', () => {
    const ledger = createFoldedModelGestureLedger();
    ledger.open(front);
    expect(ledger.close(back.scope)).toBeNull();
    expect(ledger.close(front.scope)).toEqual(front);
    // The second commit for one drag — blur, then unmount — records nothing.
    expect(ledger.close(front.scope)).toBeNull();
    expect(ledger.isOpen(front.scope)).toBe(false);
  });

  it('is a no-op to close with nothing open', () => {
    const ledger = createFoldedModelGestureLedger();
    expect(ledger.close(front.scope)).toBeNull();
    expect(ledger.closeAny()).toBeNull();
  });

  // The pre-emption case: a second control starts while the first is still
  // mid-drag. The first must land as its own entry, under its own label.
  it('hands back the open gesture, with its label, when anything else begins', () => {
    const ledger = createFoldedModelGestureLedger();
    ledger.open(front);
    expect(ledger.closeAny()).toEqual(front);
    expect(ledger.open(back)).toBe(true);
    expect(ledger.isOpen(front.scope)).toBe(false);
  });
});
