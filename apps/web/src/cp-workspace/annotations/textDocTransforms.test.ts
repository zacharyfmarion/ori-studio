import { describe, expect, it } from 'vitest';
import {
  $createParagraphNode,
  $getRoot,
  $isElementNode,
  $isTextNode,
  $selectAll,
  createEditor,
  type LexicalEditor,
  type SerializedEditorState,
} from 'lexical';
import { $createHeadingNode, HeadingNode, type HeadingTagType } from '@lexical/rich-text';
import { $patchStyleText, $setBlocksType } from '@lexical/selection';
import { textDocFromPlainText } from './textAnnotation';
import { setDocAlign, setDocBlock, setDocColor, textDocSummary } from './textDocTransforms';
import type { TextAlign, TextBlockType } from './textFormatting';

/**
 * Each JSON transform against its headless twin: a core Lexical editor with
 * no root element, fed the same document, driven the way the live editor is.
 * Deep-equal output is the contract — a Lexical upgrade that changes what
 * `$setBlocksType` or `$patchStyleText` serializes fails here rather than
 * forking the idle and editing write paths silently.
 *
 * `direction` is the one field normalised away: the reconciler that settles
 * it never runs headless, so a fresh node keeps `null` there while the
 * transform copies the old block's — which is what the live editor lands on.
 */
function editorWith(doc: SerializedEditorState): LexicalEditor {
  const editor = createEditor({ nodes: [HeadingNode], onError: (error) => { throw error; } });
  editor.setEditorState(editor.parseEditorState(doc));
  return editor;
}

function headless(doc: SerializedEditorState, act: () => void): SerializedEditorState {
  const editor = editorWith(doc);
  editor.update(act, { discrete: true });
  return editor.getEditorState().toJSON();
}

function withoutDirection(doc: SerializedEditorState): unknown {
  return JSON.parse(
    JSON.stringify(doc, (key, value) => (key === 'direction' ? undefined : value))
  );
}

/** Two paragraphs with text, one empty paragraph. */
const THREE = textDocFromPlainText('Alpha\n\nGamma');

/** A heading, with a coloured word. */
const HEADED = headless(textDocFromPlainText('Title'), () => {
  $selectAll();
  $setBlocksType($selectAll(), () => $createHeadingNode('h1'));
  $selectAll();
  $patchStyleText($selectAll(), { color: '#e5484d' });
});

describe('textDocSummary', () => {
  it('reads a uniform document', () => {
    expect(textDocSummary(THREE)).toEqual({ align: 'left', block: 'paragraph', color: '' });
    expect(textDocSummary(HEADED)).toEqual({ align: 'left', block: 'h1', color: '#e5484d' });
  });

  it('reports mixed blocks as null', () => {
    const mixed = setDocAlign(THREE, 'center');
    const root = mixed.root as unknown as { children: Array<{ format: string }> };
    root.children[0]!.format = 'right';
    expect(textDocSummary(mixed).align).toBeNull();
    expect(textDocSummary(HEADED).block).toBe('h1');
  });
});

describe('setDocAlign', () => {
  for (const align of ['left', 'center', 'right'] as const satisfies readonly TextAlign[]) {
    it(`matches setFormat('${align}') on every block`, () => {
      const expected = headless(THREE, () => {
        for (const block of $getRoot().getChildren()) {
          if ($isElementNode(block)) block.setFormat(align);
        }
      });
      expect(setDocAlign(THREE, align)).toEqual(expected);
      expect(textDocSummary(setDocAlign(THREE, align)).align).toBe(align);
    });
  }

  it('returns a new document and leaves the input alone', () => {
    const next = setDocAlign(THREE, 'center');
    expect(next).not.toBe(THREE);
    expect(textDocSummary(THREE).align).toBe('left');
  });
});

describe('setDocBlock', () => {
  const cases: Array<[SerializedEditorState, TextBlockType]> = [
    [THREE, 'h1'],
    [THREE, 'h2'],
    [HEADED, 'paragraph'],
    [HEADED, 'h2'],
    [setDocAlign(THREE, 'center'), 'h1'],
  ];
  for (const [doc, type] of cases) {
    it(`matches $setBlocksType to ${type} over a select-all`, () => {
      const expected = headless(doc, () => {
        $setBlocksType($selectAll(), () =>
          type === 'paragraph' ? $createParagraphNode() : $createHeadingNode(type as HeadingTagType)
        );
      });
      expect(withoutDirection(setDocBlock(doc, type))).toEqual(withoutDirection(expected));
      expect(textDocSummary(setDocBlock(doc, type)).block).toBe(type);
    });
  }
});

describe('setDocColor', () => {
  for (const color of ['#4c9aff', '']) {
    it(`matches $patchStyleText with ${color || 'the default'} over a select-all`, () => {
      for (const doc of [THREE, HEADED]) {
        const expected = headless(doc, () => {
          $patchStyleText($selectAll(), { color: color || null });
        });
        expect(setDocColor(doc, color)).toEqual(expected);
        expect(textDocSummary(setDocColor(doc, color)).color).toBe(color);
      }
    });
  }

  it('keeps the other style declarations of a text node', () => {
    const styled = headless(THREE, () => {
      $patchStyleText($selectAll(), { 'font-style': 'italic' });
    });
    const recoloured = setDocColor(styled, '#30a46c');
    const first = (recoloured.root as unknown as { children: Array<{ children: Array<{ style: string }> }> })
      .children[0]!.children[0]!;
    expect(first.style).toContain('font-style: italic;');
    expect(first.style).toContain('color: #30a46c;');
    const root = $getRootTextNodes(recoloured);
    expect(root.every((node) => node.style.includes('color: #30a46c;'))).toBe(true);
  });
});

function $getRootTextNodes(doc: SerializedEditorState): Array<{ style: string }> {
  const editor = editorWith(doc);
  const out: Array<{ style: string }> = [];
  editor.getEditorState().read(() => {
    for (const block of $getRoot().getChildren()) {
      if (!$isElementNode(block)) continue;
      for (const node of block.getChildren()) {
        if ($isTextNode(node)) out.push({ style: node.getStyle() });
      }
    }
  });
  return out;
}
