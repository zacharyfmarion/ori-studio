import { Component, act, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installTranslatedDomGuard } from './translatedDomGuard';

/**
 * The production failure, reduced.
 *
 * Google Translate replaces a text node with a `<font>` wrapping the translated words.
 * React still holds the original node and still believes its parent is the element it
 * rendered into, so the next removal throws `NotFoundError` and takes out the nearest error
 * boundary (ORI-STUDIO-7/-8).
 *
 * The shape here is the one that actually broke: a *portal* whose only child is a bare text
 * node — Radix `SelectItemText` portalling the selected label into the trigger — torn down
 * by a conditional render, which is what pressing Run in the box-pleat optimizer does.
 */
function translate(textNode: ChildNode): void {
  const font = document.createElement('font');
  textNode.replaceWith(font);
  font.append(textNode);
}

class Boundary extends Component<{ children: ReactNode }, { caught: Error | null }> {
  state = { caught: null as Error | null };
  static getDerivedStateFromError(caught: Error) {
    return { caught };
  }
  render() {
    return this.state.caught ? 'failed' : this.props.children;
  }
}

describe('translatedDomGuard', () => {
  let host: HTMLElement;
  let container: HTMLElement;
  let root: Root;
  let uninstall: () => void = () => {};

  beforeEach(() => {
    host = document.createElement('div');
    container = document.createElement('span');
    document.body.append(host, container);
    root = createRoot(host);
    // React logs a commit-phase error before handing it to the boundary.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    uninstall();
    act(() => root.unmount());
    host.remove();
    container.remove();
    vi.restoreAllMocks();
  });

  /** Mount a portalled text node, let the "translator" rewrap it, then unmount it. */
  function runTeardownAfterTranslation(): Boundary {
    let boundary!: Boundary;
    act(() =>
      root.render(
        <Boundary
          ref={(instance) => {
            if (instance) boundary = instance;
          }}
        >
          {createPortal('Use current layout', container)}
        </Boundary>
      )
    );
    expect(container.textContent).toBe('Use current layout');

    translate(container.firstChild!);
    expect(container.querySelector('font')).not.toBeNull();

    // The conditional render that swaps the portal away.
    act(() =>
      root.render(
        <Boundary
          ref={(instance) => {
            if (instance) boundary = instance;
          }}
        >
          {null}
        </Boundary>
      )
    );
    return boundary;
  }

  it('without it, tearing down a translated subtree takes out the error boundary', () => {
    // The production error verbatim: `NotFoundError: ... The node to be removed is not a
    // child of this node.` A `DOMException`, which is not an `Error` instance.
    expect(runTeardownAfterTranslation().state.caught).toMatchObject({ name: 'NotFoundError' });
  });

  it('with it, the same teardown leaves the boundary intact', () => {
    uninstall = installTranslatedDomGuard();
    expect(runTeardownAfterTranslation().state.caught).toBeNull();
  });

  it('reports the blocked method instead of throwing', () => {
    const onBlocked = vi.fn();
    uninstall = installTranslatedDomGuard({ onBlocked });

    const parent = document.createElement('div');
    const stranger = document.createElement('div');
    const child = document.createElement('span');
    stranger.append(child);

    expect(parent.removeChild(child)).toBe(child);
    expect(onBlocked).toHaveBeenCalledWith('removeChild');

    const inserted = document.createElement('b');
    expect(parent.insertBefore(inserted, child)).toBe(inserted);
    expect(onBlocked).toHaveBeenCalledWith('insertBefore');
    // Blocked, so it is not in either parent.
    expect(inserted.parentNode).toBeNull();
  });

  it('leaves ordinary DOM work alone', () => {
    uninstall = installTranslatedDomGuard();

    const parent = document.createElement('div');
    const first = document.createElement('span');
    const second = document.createElement('b');
    parent.append(first);

    expect(parent.insertBefore(second, first)).toBe(second);
    expect([...parent.children]).toEqual([second, first]);
    expect(parent.removeChild(first)).toBe(first);
    expect([...parent.children]).toEqual([second]);
  });

  // `insertBefore(node, undefined)` is a legal append — the reference argument is nullable
  // and `undefined` converts to `null`. Dockview appends that way, so a guard that read
  // `.parentNode` off it replaced the entire workspace shell with an error boundary.
  it('passes a loosely-typed reference argument through as an append', () => {
    const onBlocked = vi.fn();
    uninstall = installTranslatedDomGuard({ onBlocked });

    const parent = document.createElement('div');
    const first = document.createElement('span');
    parent.append(first);

    const appended = document.createElement('b');
    expect(
      parent.insertBefore(appended, undefined as unknown as Node | null)
    ).toBe(appended);
    expect([...parent.children]).toEqual([first, appended]);

    const alsoAppended = document.createElement('i');
    parent.insertBefore(alsoAppended, null);
    expect([...parent.children]).toEqual([first, appended, alsoAppended]);
    expect(onBlocked).not.toHaveBeenCalled();
  });

  // A non-node has a `TypeError` of its own coming; the guard must not pre-empt it with a
  // different one raised from a property read.
  it('lets the DOM reject a non-node argument itself', () => {
    uninstall = installTranslatedDomGuard();
    const parent = document.createElement('div');
    // The DOM's own wording, not one invented from reading `.parentNode` off `undefined`.
    expect(() => parent.removeChild(undefined as unknown as Node)).toThrow(
      /parameter 1 is not of type 'Node'/
    );
  });

  it('a second install does not wrap the first', () => {
    const onBlocked = vi.fn();
    const first = installTranslatedDomGuard({ onBlocked });
    const second = installTranslatedDomGuard({ onBlocked: () => expect.unreachable() });
    uninstall = () => {
      second();
      first();
    };

    const parent = document.createElement('div');
    const orphan = document.createElement('span');
    parent.removeChild(orphan);
    expect(onBlocked).toHaveBeenCalledTimes(1);
  });
});
