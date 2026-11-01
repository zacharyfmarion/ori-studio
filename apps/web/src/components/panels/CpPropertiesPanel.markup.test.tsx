import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FIGURE,
  IMAGE,
  REGION,
  TEXT,
  WINDOW,
} from '../../cp-workspace/canvasObjects/canvasObjectKinds.fixtures';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { createStarterOristudioCpDocument } from '../../lib/oristudioCpStarterDocument';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { CpPropertiesPanel } from './CpPropertiesPanel';

/**
 * The structure each canvas-object kind's sheet renders, pinned. The shared
 * renderer grows optional parts for one kind at a time (the folded figure's
 * header verbs, a stacked choice, a stepper, a note line); a kind that uses
 * none of them must render exactly what it did, and this is where a change
 * that leaks into the others shows.
 *
 * Structure only: each element's tag, its `data-*`, `role` and `aria-*`
 * attributes, and its text. Not class names, which belong to other
 * components' modules; not inline styles; not the ids React and Radix
 * generate, which an `aria-*` reference is renamed by order of appearance;
 * and not an icon's drawing, which is the icon set's.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialState = useWorkspaceStore.getInitialState();

const DOCUMENT = {
  handle: 4,
  loadSerial: 1,
  document: createStarterOristudioCpDocument(),
  geometry: null,
  summary: null,
  source: { format: 'cp', filename: 'Untitled.cp', path: null },
} as unknown as OristudioCpDocumentState;

/** The `aria-*` attributes whose values are ids of other elements. */
const ID_REFERENCES = new Set([
  'aria-activedescendant',
  'aria-controls',
  'aria-describedby',
  'aria-details',
  'aria-errormessage',
  'aria-flowto',
  'aria-labelledby',
  'aria-owns',
]);

let root: Root | null = null;
let host: HTMLDivElement | null = null;

beforeEach(() => {
  useWorkspaceStore.setState(initialState, true);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useWorkspaceStore.setState(initialState, true);
});

/** The sheet as an indented outline of its structure. */
function sheetStructure(): string {
  const sheet = host?.querySelector('[data-property-sheet]');
  if (!sheet) return '';
  const ids = new Map<string, string>();
  const idOf = (id: string) => {
    if (!ids.has(id)) ids.set(id, `#${ids.size + 1}`);
    return ids.get(id)!;
  };
  const lines: string[] = [];
  const walk = (node: Node, depth: number) => {
    const indent = '  '.repeat(depth);
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent?.trim();
      if (text) lines.push(`${indent}"${text}"`);
      return;
    }
    if (!(node instanceof Element)) return;
    const attributes = [...node.attributes]
      .filter(({ name }) => name.startsWith('data-') || name.startsWith('aria-') || name === 'role')
      .map(({ name, value }) =>
        ID_REFERENCES.has(name) ? `${name}="${value.split(/\s+/u).map(idOf).join(' ')}"` : `${name}="${value}"`
      )
      .sort();
    lines.push(`${indent}<${node.tagName.toLowerCase()}${attributes.map((a) => ` ${a}`).join('')}>`);
    // An icon is the icon set's drawing, not the sheet's structure.
    if (node.tagName.toLowerCase() === 'svg') return;
    for (const child of node.childNodes) walk(child, depth + 1);
  };
  walk(sheet, 0);
  return lines.join('\n');
}

describe('CpPropertiesPanel markup', () => {
  it.each([
    ['image', { oristudioCpSelectedAnnotationId: IMAGE.id }],
    ['text', { oristudioCpSelectedAnnotationId: TEXT.id }],
    ['suppression region', { oristudioCpSelectedAnnotationId: REGION.id }],
    ['simulation window', { oristudioCpFocusedInlineSimulationId: WINDOW.id }],
  ] as const)('draws the %s sheet as it always has', (_kind, selection) => {
    useWorkspaceStore.setState({
      oristudioCpDocument: DOCUMENT,
      oristudioCpAnnotations: [IMAGE, TEXT, REGION],
      oristudioCpFoldedFigures: [FIGURE],
      oristudioCpInlineSimulations: [WINDOW],
      ...selection,
    });
    act(() =>
      root?.render(
        <TooltipProvider>
          <CpPropertiesPanel />
        </TooltipProvider>
      )
    );
    expect(sheetStructure()).toMatchSnapshot();
  });
});
