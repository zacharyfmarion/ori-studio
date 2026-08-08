import { useEffect, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { IconButton } from '../components/ui/IconButton';
import { clampLength, nudgeLength, type TreeLengthRule } from './lengths';
import type { EditableTreeEdge } from './model';

/**
 * Contextual editor for a selected edge's length.
 *
 * What counts as a length — its floor, its ceiling, its step, how it reads — is
 * the surface's {@link TreeLengthRule}, so the same field serves whole grid
 * cells and arbitrary reals. The ceiling is applied but never shown: box-pleat's
 * is an overflow guard rather than a design constraint (`ceil(8192·√2)` less the
 * depth the branch already spends) and reads as a meaningless five-digit number.
 * Upstream passes it to the number field's `max` and never renders it either;
 * see `third_party/box-pleating-studio/src/app/vue/panel/edge.vue`.
 *
 * Its wording is passed in rather than taken from the tree editor's copy, so a
 * surface that calls the same edit something else can say so: a river's width
 * *is* its dual edge's length, and Box Pleating Studio's river panel labels it
 * "Width" (`src/app/vue/panel/river.vue`).
 */
export function TreeEdgeLengthEditor({
  edge,
  rule,
  title,
  label,
  groupLabel,
  increaseLabel,
  decreaseLabel,
  onSetLength,
  onEscape,
}: {
  edge: EditableTreeEdge;
  rule: TreeLengthRule;
  title: string;
  label: string;
  groupLabel: string;
  increaseLabel: string;
  decreaseLabel: string;
  onSetLength: (length: number) => void;
  onEscape?: () => void;
}) {
  const [draft, setDraft] = useState(() => rule.format(edge.length));
  useEffect(() => {
    setDraft(rule.format(edge.length));
  }, [edge.id, edge.length, rule]);

  const max = rule.max(edge);
  const commit = (value: number) => {
    if (!Number.isFinite(value)) {
      setDraft(rule.format(edge.length));
      return;
    }
    const clamped = clampLength(rule, edge, value);
    if (clamped !== edge.length) onSetLength(clamped);
    else setDraft(rule.format(edge.length));
  };

  return (
    <div className="bp-tree-edge-editor" role="group" aria-label={groupLabel}>
      <span className="bp-tree-edge-editor__title">{title}</span>
      <span className="bp-tree-edge-editor__label">{label}</span>
      <IconButton
        size="sm"
        variant="toolbar"
        title={decreaseLabel}
        disabled={edge.length <= rule.min}
        onClick={() => commit(nudgeLength(rule, edge.length, -1))}
      >
        <Minus size={14} />
      </IconButton>
      <input
        className="bp-tree-edge-editor__input"
        type="number"
        min={rule.min}
        max={max ?? undefined}
        step={rule.step ?? 'any'}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => commit(Number.parseFloat(draft))}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            commit(Number.parseFloat(draft));
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setDraft(rule.format(edge.length));
            event.currentTarget.blur();
            onEscape?.();
          }
        }}
      />
      <IconButton
        size="sm"
        variant="toolbar"
        title={increaseLabel}
        disabled={max !== null && edge.length >= max}
        onClick={() => commit(nudgeLength(rule, edge.length, 1))}
      >
        <Plus size={14} />
      </IconButton>
    </div>
  );
}
