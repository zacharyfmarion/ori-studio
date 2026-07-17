import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CpTextOverlay } from './CpTextOverlay';
import type { OristudioCpTextElement } from '../engine/oristudioCpTypes';
import type { CpOverlayView } from './CreasePatternWebglCanvas';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Identity-ish view: model (x, y) → CSS (x, y).
const VIEW: CpOverlayView = { origin: [0, 0], ex: [1, 0], ey: [0, 1] };

let root: Root | null = null;
let container: HTMLDivElement | null = null;

// Test bodies create handlers as plain vi.fn(); render() casts them to the
// component's specific callback signatures (vi.fn's broad Mock type isn't directly
// assignable, but the mock is call-compatible at runtime).
type AnyMock = ReturnType<typeof vi.fn>;

interface Handlers {
  onToggleText?: AnyMock;
  onSelectText?: AnyMock;
  onCreateText?: AnyMock;
  onSetTextContent?: AnyMock;
  onDeleteText?: AnyMock;
  onMoveText?: AnyMock;
  onCreateDraftConsumed?: AnyMock;
}

function render(
  props: {
    texts: OristudioCpTextElement[];
    textToolActive?: boolean;
    selectedTextIds?: number[];
    createDraftAt?: { x: number; y: number } | null;
  } & Handlers
) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <CpTextOverlay
        texts={props.texts}
        selectedTextIds={props.selectedTextIds ?? []}
        view={VIEW}
        zoomPercent={100}
        selectable
        textToolActive={props.textToolActive ?? false}
        createDraftAt={props.createDraftAt ?? null}
        onCreateDraftConsumed={props.onCreateDraftConsumed as (() => void) | undefined}
        onToggleText={
          (props.onToggleText ?? vi.fn()) as (id: number, additive?: boolean) => void
        }
        onSelectText={props.onSelectText as ((id: number) => void) | undefined}
        onCreateText={
          props.onCreateText as
            | ((anchor: { x: number; y: number }, text: string) => void)
            | undefined
        }
        onSetTextContent={
          props.onSetTextContent as ((id: number, text: string) => void) | undefined
        }
        onDeleteText={props.onDeleteText as ((id: number) => void) | undefined}
        onMoveText={
          props.onMoveText as
            | ((id: number, delta: { x: number; y: number }) => void)
            | undefined
        }
      />
    );
  });
}

function rerender(node: ReactElement) {
  act(() => {
    root?.render(node);
  });
}

function textElement(x: number, y: number, text: string): OristudioCpTextElement {
  return { x, y, text } as unknown as OristudioCpTextElement;
}

function textarea(): HTMLTextAreaElement {
  const el = container?.querySelector('textarea');
  expect(el).not.toBeNull();
  return el as HTMLTextAreaElement;
}

function labels(): HTMLSpanElement[] {
  return Array.from(container?.querySelectorAll('.cp-text-label') ?? []);
}

function type(el: HTMLTextAreaElement, value: string) {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    setter?.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// React drives onBlur off native focusout (which bubbles); a raw 'blur' event does
// not trigger it. Dispatch focusout to exercise the component's blur-commit path.
function blur(el: HTMLTextAreaElement) {
  act(() => el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
}

// jsdom lacks the Pointer Capture API; stub the calls the drag handlers make.
function stubPointerCapture(el: Element) {
  const target = el as Element & {
    setPointerCapture: () => void;
    releasePointerCapture: () => void;
    hasPointerCapture: () => boolean;
  };
  target.setPointerCapture = () => {};
  target.releasePointerCapture = () => {};
  target.hasPointerCapture = () => false;
}

function pointer(el: Element, type: string, clientX: number, clientY: number, button = 0) {
  stubPointerCapture(el);
  act(() => {
    const event = new MouseEvent(type, { bubbles: true, button, clientX, clientY });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    el.dispatchEvent(event);
  });
}

// Under the Text tool the editor opens on a press+release with no movement (a
// click), not on the DOM 'click' event.
function openEditor(el: Element) {
  pointer(el, 'pointerdown', 0, 0, 0);
  pointer(el, 'pointerup', 0, 0, 0);
}

beforeEach(() => {
  container = null;
  root = null;
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('CpTextOverlay inline editor', () => {
  it('opens a create draft and commits a new text on blur', () => {
    const onCreateText = vi.fn();
    const onCreateDraftConsumed = vi.fn();
    render({
      texts: [],
      textToolActive: true,
      createDraftAt: { x: 10, y: 20 },
      onCreateText,
      onCreateDraftConsumed,
    });

    expect(onCreateDraftConsumed).toHaveBeenCalled();
    const el = textarea();
    type(el, 'hello');
    blur(el);

    expect(onCreateText).toHaveBeenCalledWith({ x: 10, y: 20 }, 'hello');
  });

  it('drops a blank create draft (never creates)', () => {
    const onCreateText = vi.fn();
    render({
      texts: [],
      textToolActive: true,
      createDraftAt: { x: 5, y: 5 },
      onCreateText,
    });

    const el = textarea();
    type(el, '   ');
    blur(el);

    expect(onCreateText).not.toHaveBeenCalled();
  });

  it('commits an edit to an existing text via SetContent', () => {
    const onSetTextContent = vi.fn();
    const onSelectText = vi.fn();
    render({
      texts: [textElement(1, 1, 'old')],
      textToolActive: true,
      onSetTextContent,
      onSelectText,
    });

    openEditor(labels()[0]);
    expect(onSelectText).toHaveBeenCalledWith(1);

    const el = textarea();
    expect(el.value).toBe('old');
    type(el, 'new');
    blur(el);

    expect(onSetTextContent).toHaveBeenCalledWith(1, 'new');
  });

  it('deletes an existing text edited down to blank', () => {
    const onDeleteText = vi.fn();
    const onSetTextContent = vi.fn();
    render({
      texts: [textElement(1, 1, 'old')],
      textToolActive: true,
      onDeleteText,
      onSetTextContent,
    });

    openEditor(labels()[0]);
    const el = textarea();
    type(el, '');
    blur(el);

    expect(onDeleteText).toHaveBeenCalledWith(1);
    expect(onSetTextContent).not.toHaveBeenCalled();
  });

  it('does not commit an unchanged existing text', () => {
    const onSetTextContent = vi.fn();
    const onDeleteText = vi.fn();
    render({
      texts: [textElement(1, 1, 'same')],
      textToolActive: true,
      onSetTextContent,
      onDeleteText,
    });

    openEditor(labels()[0]);
    const el = textarea();
    blur(el);

    expect(onSetTextContent).not.toHaveBeenCalled();
    expect(onDeleteText).not.toHaveBeenCalled();
  });

  it('Escape commits the draft and closes the editor', () => {
    const onCreateText = vi.fn();
    render({
      texts: [],
      textToolActive: true,
      createDraftAt: { x: 0, y: 0 },
      onCreateText,
    });

    const el = textarea();
    type(el, 'kept');
    act(() => {
      el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(onCreateText).toHaveBeenCalledWith({ x: 0, y: 0 }, 'kept');
    expect(container?.querySelector('textarea')).toBeNull();
  });

  it('leaving the Text tool commits the open session', () => {
    const onCreateText = vi.fn();
    render({
      texts: [],
      textToolActive: true,
      createDraftAt: { x: 2, y: 3 },
      onCreateText,
    });
    const el = textarea();
    type(el, 'onexit');

    rerender(
      <CpTextOverlay
        texts={[]}
        selectedTextIds={[]}
        view={VIEW}
        zoomPercent={100}
        selectable
        textToolActive={false}
        createDraftAt={null}
        onToggleText={vi.fn() as (id: number, additive?: boolean) => void}
        onCreateText={
          onCreateText as (anchor: { x: number; y: number }, text: string) => void
        }
      />
    );

    expect(onCreateText).toHaveBeenCalledWith({ x: 2, y: 3 }, 'onexit');
  });

  it('routes plain (non-text-tool) clicks to onToggleText', () => {
    const onToggleText = vi.fn();
    const onSelectText = vi.fn();
    render({
      texts: [textElement(1, 1, 'a')],
      textToolActive: false,
      onToggleText,
      onSelectText,
    });

    act(() => labels()[0].dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onToggleText).toHaveBeenCalledWith(1, false);
    expect(onSelectText).not.toHaveBeenCalled();
    expect(container?.querySelector('textarea')).toBeNull();
  });

  it('drags a text and commits the model delta on release', () => {
    const onMoveText = vi.fn();
    render({
      // Identity view → 1 model unit == 1 CSS px, so a 20px drag == a 20-unit move.
      texts: [textElement(1, 1, 'a')],
      textToolActive: true,
      onMoveText,
    });

    const label = labels()[0];
    pointer(label, 'pointerdown', 100, 100, 0);
    pointer(label, 'pointermove', 120, 108, 0);
    pointer(label, 'pointerup', 120, 108, 0);

    expect(onMoveText).toHaveBeenCalledWith(1, { x: 20, y: 8 });
    // A drag must not also open the editor.
    expect(container?.querySelector('textarea')).toBeNull();
  });

  it('treats a press with no movement as a click that opens the editor', () => {
    const onMoveText = vi.fn();
    render({
      texts: [textElement(1, 1, 'a')],
      textToolActive: true,
      onMoveText,
    });

    const label = labels()[0];
    pointer(label, 'pointerdown', 50, 50, 0);
    pointer(label, 'pointerup', 50, 50, 0);

    expect(onMoveText).not.toHaveBeenCalled();
    expect(container?.querySelector('textarea')).not.toBeNull();
  });

  it('right-clicking a text deletes it', () => {
    const onDeleteText = vi.fn();
    render({
      texts: [textElement(1, 1, 'a')],
      textToolActive: true,
      onDeleteText,
    });

    act(() =>
      labels()[0].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }))
    );
    expect(onDeleteText).toHaveBeenCalledWith(1);
  });
});
