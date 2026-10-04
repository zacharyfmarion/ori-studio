import { describe, expect, it } from 'vitest';
import { ANNOTATE_TOOL_GROUPS } from './annotateTools';
import { ANNOTATION_KINDS } from './annotationModel';

describe('the rail', () => {
  it('groups every kind’s tool once, after Select, in kind order', () => {
    expect(ANNOTATE_TOOL_GROUPS).toEqual([
      { id: 'select', tools: [null] },
      { id: 'arrows', tools: ['valley-arrow', 'mountain-arrow', 'fold-unfold-arrow', 'push-arrow', 'turn-over', 'rotate'] },
      { id: 'lines', tools: ['valley-line', 'mountain-line', 'hidden-line'] },
      { id: 'text', tools: ['label'] },
    ]);
    const tools = ANNOTATE_TOOL_GROUPS.flatMap((group) => group.tools).filter((tool) => tool !== null);
    expect([...tools].sort()).toEqual([...ANNOTATION_KINDS].sort());
  });
});
