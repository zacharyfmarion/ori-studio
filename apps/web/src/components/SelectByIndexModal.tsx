import { selectProject } from '../store/workspaceStore/designTabs';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { LocateFixed, X } from 'lucide-react';
import type { SelectablePartKind } from '../lib/selection';
import type { TreeProject } from '../lib/sampleProject';
import { useSelectionUiStore } from '../store/selectionUiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/Select';

const PART_KINDS: Array<{ kind: SelectablePartKind }> = [
  { kind: 'node' },
  { kind: 'edge' },
  { kind: 'path' },
  { kind: 'crease' },
  { kind: 'facet' },
  { kind: 'condition' },
];

function partKindLabel(t: TFunction, kind: SelectablePartKind): string {
  switch (kind) {
    case 'node':
      return t('dialogs:selectByIndex.partKind.node', 'Node');
    case 'edge':
      return t('dialogs:selectByIndex.partKind.edge', 'Edge');
    case 'path':
      return t('dialogs:selectByIndex.partKind.path', 'Path');
    case 'crease':
      return t('dialogs:selectByIndex.partKind.crease', 'Crease');
    case 'facet':
      return t('dialogs:selectByIndex.partKind.facet', 'Facet');
    case 'condition':
      return t('dialogs:selectByIndex.partKind.condition', 'Condition');
  }
}

function idsForKind(project: TreeProject, kind: SelectablePartKind): number[] {
  switch (kind) {
    case 'node':
      return project.nodes.map((node) => node.id);
    case 'edge':
      return project.edges.map((edge) => edge.id);
    case 'path':
      return project.paths.map((path) => path.id);
    case 'crease':
      return project.creases.map((crease) => crease.id);
    case 'facet':
      return project.facets.map((facet) => facet.id);
    case 'condition':
      return project.conditions.map((condition) => condition.id);
  }
}

export function SelectByIndexModal() {
  const { t } = useTranslation();
  const isOpen = useSelectionUiStore((state) => state.isSelectByIndexOpen);
  const close = useSelectionUiStore((state) => state.closeSelectByIndex);
  const project = useWorkspaceStore((state) => selectProject(state));
  const selectByIndex = useWorkspaceStore((state) => state.selectByIndex);
  const [kind, setKind] = useState<SelectablePartKind>('node');
  const ids = useMemo(() => idsForKind(project, kind), [kind, project]);
  const [draft, setDraft] = useState('');
  const parsedId = Number.parseInt(draft, 10);
  const canSelect = Number.isInteger(parsedId) && ids.includes(parsedId);

  useEffect(() => {
    if (!isOpen) return;
    const initialKind = PART_KINDS.find((part) => idsForKind(project, part.kind).length > 0)?.kind ?? 'node';
    setKind(initialKind);
    setDraft(String(idsForKind(project, initialKind)[0] ?? ''));
  }, [isOpen, project]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [close, isOpen]);

  if (!isOpen) return null;

  const submit = () => {
    if (!canSelect) return;
    selectByIndex(kind, parsedId);
    close();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('dialogs:selectByIndex.title', 'Select by index')}
      className="simple-modal"
      onMouseDown={close}
    >
      <div role="document" className="simple-modal__document" onMouseDown={(event) => event.stopPropagation()}>
        <header className="simple-modal__header">
          <span>
            <LocateFixed size={15} aria-hidden="true" />
            {t('dialogs:selectByIndex.title', 'Select by index')}
          </span>
          <IconButton size="sm" aria-label={t('dialogs:selectByIndex.close', 'Close select by index')} onClick={close}>
            <X size={15} />
          </IconButton>
        </header>
        <form
          className="simple-modal__body"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label className="field-row">
            <span>{t('dialogs:selectByIndex.part', 'Part')}</span>
            <Select
              value={kind}
              onValueChange={(value) => {
                const nextKind = value as SelectablePartKind;
                const nextIds = idsForKind(project, nextKind);
                setKind(nextKind);
                setDraft(String(nextIds[0] ?? ''));
              }}
            >
              <SelectTrigger aria-label={t('dialogs:selectByIndex.partType', 'Part type')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PART_KINDS.map((part) => (
                  <SelectItem key={part.kind} value={part.kind}>
                    {partKindLabel(t, part.kind)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="field-row">
            <span>{t('dialogs:selectByIndex.index', 'Index')}</span>
            <input
              type="number"
              min={ids[0] ?? 1}
              max={ids.at(-1) ?? 1}
              step={1}
              value={draft}
              onChange={(event) => setDraft(event.currentTarget.value)}
              autoFocus
            />
          </label>
          <div className="simple-modal__meta">
            {ids.length > 0
              ? t('dialogs:selectByIndex.available', 'Available: {{ids}}', { ids: ids.join(', ') })
              : t('dialogs:selectByIndex.noParts', 'No parts of this type')}
          </div>
          <footer className="simple-modal__footer">
            <Button size="sm" variant="ghost" onClick={close}>
              {t('common:cancel', 'Cancel')}
            </Button>
            <Button size="sm" variant="primary" type="submit" disabled={!canSelect}>
              {t('dialogs:selectByIndex.select', 'Select')}
            </Button>
          </footer>
        </form>
      </div>
    </div>
  );
}
