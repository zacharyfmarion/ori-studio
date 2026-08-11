import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  foldedFigureHandleRefCount,
  releaseFoldedFigureHandle,
  releaseFoldedFigureHandles,
  resetFoldedFigureHandles,
  retainFoldedFigureHandle,
  retainFoldedFigureHandles,
  setFoldedFigureHandleFree,
} from './foldedFigureHandles';

const free = vi.fn();

beforeEach(() => {
  resetFoldedFigureHandles();
  free.mockClear();
  setFoldedFigureHandleFree(free);
});

describe('folded figure handle ownership', () => {
  it('frees only when the last reference goes', () => {
    retainFoldedFigureHandle(7);
    retainFoldedFigureHandle(7);
    expect(foldedFigureHandleRefCount(7)).toBe(2);

    releaseFoldedFigureHandle(7);
    expect(free).not.toHaveBeenCalled();

    releaseFoldedFigureHandle(7);
    expect(free).toHaveBeenCalledExactlyOnceWith(7);
    expect(foldedFigureHandleRefCount(7)).toBe(0);
  });

  it('treats handle 0 as a real slot, not as absent', () => {
    // Handle 0 is a valid wasm slot index; a falsy check here would leak it.
    retainFoldedFigureHandle(0);
    expect(foldedFigureHandleRefCount(0)).toBe(1);
    releaseFoldedFigureHandle(0);
    expect(free).toHaveBeenCalledExactlyOnceWith(0);
  });

  it('ignores figures that have no handle yet', () => {
    retainFoldedFigureHandle(null);
    retainFoldedFigureHandle(undefined);
    releaseFoldedFigureHandle(null);
    expect(free).not.toHaveBeenCalled();
  });

  it('ignores a release of something it does not hold, so nothing frees early', () => {
    // The same figure object can appear in several history entries; a stray
    // double release must not free a handle another entry still needs.
    retainFoldedFigureHandle(3);
    releaseFoldedFigureHandle(3);
    expect(free).toHaveBeenCalledTimes(1);
    releaseFoldedFigureHandle(3);
    expect(free).toHaveBeenCalledTimes(1);
  });

  it('retains and releases a whole figure list', () => {
    const figures = [{ handle: 1 }, { handle: 2 }, { handle: null }];
    retainFoldedFigureHandles(figures);
    expect(foldedFigureHandleRefCount(1)).toBe(1);
    expect(foldedFigureHandleRefCount(2)).toBe(1);

    releaseFoldedFigureHandles(figures);
    expect(free).toHaveBeenCalledTimes(2);
    expect(free).toHaveBeenCalledWith(1);
    expect(free).toHaveBeenCalledWith(2);
  });

  it('survives a delete while history still holds the handle', () => {
    // The shape that motivates all of this: the live list and one history entry
    // both hold a figure; deleting it must not free the handle, or undo would
    // restore a figure that draws but can no longer be edited.
    retainFoldedFigureHandle(5); // live list
    retainFoldedFigureHandle(5); // history entry

    releaseFoldedFigureHandle(5); // delete
    expect(free).not.toHaveBeenCalled();

    releaseFoldedFigureHandle(5); // that entry scrolls off the undo stack
    expect(free).toHaveBeenCalledExactlyOnceWith(5);
  });

  it('frees on reset rather than trusting the document to take its handles with it', () => {
    // This asserted the opposite until the belief behind it was checked:
    // "closing a document takes the whole wasm session with it; the caller
    // frees." `CpSession::free_document` nulls the document slot and nothing
    // else — folded figures are a separate arena — so the handles stayed.
    retainFoldedFigureHandle(9);
    void resetFoldedFigureHandles();
    expect(foldedFigureHandleRefCount(9)).toBe(0);
    expect(free).toHaveBeenCalledExactlyOnceWith(9);
  });
});

describe('resetFoldedFigureHandles', () => {
  it('frees every handle it was tracking, not only the ones a caller can still see', async () => {
    // The leak this replaced: reset dropped its bookkeeping without freeing, on
    // the belief that closing a document took the kernel's handles with it.
    // `CpSession::free_document` nulls the document slot only — folded figures
    // live in their own arena — so a handle held by an undo entry rather than a
    // live figure stayed allocated for the tab's lifetime.
    retainFoldedFigureHandle(3);
    retainFoldedFigureHandle(4);
    retainFoldedFigureHandle(4);

    await resetFoldedFigureHandles();

    expect(free.mock.calls.map(([handle]) => handle).sort()).toEqual([3, 4]);
    expect(foldedFigureHandleRefCount(3)).toBe(0);
    expect(foldedFigureHandleRefCount(4)).toBe(0);
  });

  it('frees a multiply-retained handle exactly once', () => {
    retainFoldedFigureHandle(9);
    retainFoldedFigureHandle(9);
    retainFoldedFigureHandle(9);

    void resetFoldedFigureHandles();

    expect(free).toHaveBeenCalledExactlyOnceWith(9);
  });

  it('leaves nothing to free after a release already took the last reference', () => {
    retainFoldedFigureHandle(5);
    releaseFoldedFigureHandle(5);
    free.mockClear();

    void resetFoldedFigureHandles();

    expect(free).not.toHaveBeenCalled();
  });
});
