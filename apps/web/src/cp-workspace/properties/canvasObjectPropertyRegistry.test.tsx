import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PropertySheet } from '../../lib/propertyDescriptors';
import { CANVAS_OBJECT_KINDS, resolveSelectedCanvasObject } from '../canvasObjects/canvasObjectKinds';
import { IMAGE, selectionFields } from '../canvasObjects/canvasObjectKinds.fixtures';

const analytics = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('../../analytics/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../analytics/runtime')>();
  return { ...actual, track: analytics.track };
});

const {
  CANVAS_OBJECT_PROPERTY_KINDS,
  canvasObjectPropertyRegistry,
} = await import('./canvasObjectPropertyRegistry');
const { SheetHost } = await import('./SheetHost');

/**
 * Resolver → registry → renderer, driven end to end with a stub row the way
 * `designKinds/registry.test.ts` stubs a design kind: the guarantee under test
 * is that a kind the resolver produces reaches the sheet its row names, with
 * nothing in between switching on the kind by hand.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const commit = vi.fn();
const STUB_SHEET: PropertySheet = {
  kind: 'image',
  targetId: IMAGE.id,
  title: 'Stub image',
  sections: [
    {
      id: 'stub',
      fields: [
        {
          id: 'flag',
          kind: 'toggle',
          label: 'Flag',
          support: 'supported',
          protocol: 'discrete',
          value: false,
          commit,
        },
      ],
    },
  ],
};

beforeEach(() => {
  analytics.track.mockClear();
  commit.mockClear();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('canvasObjectPropertyRegistry', () => {
  it('lists every kind the kind table lists', () => {
    expect([...canvasObjectPropertyRegistry().kinds].sort()).toEqual(
      Object.keys(CANVAS_OBJECT_KINDS).sort()
    );
    for (const kind of canvasObjectPropertyRegistry().kinds) {
      expect(CANVAS_OBJECT_PROPERTY_KINDS[kind].kind).toBe(kind);
    }
  });

  it('renders the sheet a stub row returns for the resolved selection', () => {
    const registry = canvasObjectPropertyRegistry({
      ...CANVAS_OBJECT_PROPERTY_KINDS,
      image: { kind: 'image', useSheet: () => STUB_SHEET },
    });
    const target = resolveSelectedCanvasObject(
      selectionFields({ oristudioCpSelectedAnnotationId: IMAGE.id })
    );
    expect(target?.kind).toBe('image');

    act(() => root?.render(<SheetHost target={target!} registry={registry} />));

    expect(host?.querySelector('.property-sheet__title')?.textContent).toBe('Stub image');
    // The host marks the sheet as the canvas selection's own surface.
    expect(host?.querySelector('.property-sheet')?.hasAttribute('data-cp-companion')).toBe(true);
  });

  it('reports one property change per commit, as enums', () => {
    const registry = canvasObjectPropertyRegistry({
      ...CANVAS_OBJECT_PROPERTY_KINDS,
      image: { kind: 'image', useSheet: () => STUB_SHEET },
    });
    const target = resolveSelectedCanvasObject(
      selectionFields({ oristudioCpSelectedAnnotationId: IMAGE.id })
    )!;
    act(() => root?.render(<SheetHost target={target} registry={registry} />));

    act(() => host?.querySelector<HTMLButtonElement>('[role="switch"]')?.click());

    expect(commit).toHaveBeenCalledWith(true);
    expect(analytics.track).toHaveBeenCalledTimes(1);
    expect(analytics.track).toHaveBeenCalledWith('canvas object property changed', {
      object_kind: 'image',
      property: 'flag',
    });
  });
});
