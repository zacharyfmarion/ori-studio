import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { PaperExportMark, PaperExportMarks } from '../../lib/paperExportSettings';
import { Button } from '../ui/Button';
import { MenuCheckboxItem, MenuContent, MenuItemIcon, MenuItemLabel } from '../ui/Menu';
import styles from './DiagramReferencesShowMenu.module.css';

/**
 * The References browser's Show menu (17d, RM4): which of each card's marks
 * a pull brings — its letters and its reference lines — as the export
 * dialog's Marks choose for a page, under the same names. A mark hidden here
 * is not pulled at all, and the cards' pictures leave it out, so what is
 * seen is what is pulled; the rings stay, as they do in export. Remembered;
 * a Replace opens on the step's own choice. The trigger says how many are
 * hidden, so a choice remembered from another day is not a surprise.
 */
export function DiagramReferencesShowMenu({
  marks,
  onToggle,
}: {
  marks: PaperExportMarks;
  onToggle: (mark: PaperExportMark) => void;
}) {
  const { t } = useTranslation();
  const hidden = [marks.letters, marks.highlights].filter((shown) => !shown).length;
  const rows: { mark: PaperExportMark; label: string; hint: string }[] = [
    {
      mark: 'letters',
      label: t('panels:diagram.references.showLetters', 'Letters'),
      hint: t(
        'panels:diagram.references.showLettersHint',
        'The names of the points a step refers to. Its instruction may still name them.'
      ),
    },
    {
      mark: 'highlights',
      label: t('panels:diagram.references.showReferenceLines', 'Reference lines'),
      hint: t('panels:diagram.references.showReferenceLinesHint', 'The lines a step lines up against.'),
    },
  ];
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button size="sm" variant="ghost">
          {hidden > 0
            ? t('panels:diagram.references.showHidden', {
                count: hidden,
                defaultValue_one: 'Show · {{count}} hidden',
                defaultValue_other: 'Show · {{count}} hidden',
              })
            : t('panels:diagram.references.show', 'Show')}
          <ChevronDown size={13} aria-hidden="true" />
        </Button>
      </DropdownMenu.Trigger>
      <MenuContent side="bottom" align="end" sideOffset={6} collisionPadding={8}>
        {rows.map(({ mark, label, hint }) => (
          <MenuCheckboxItem
            key={mark}
            multiline
            checked={marks[mark]}
            // A switch, not a verb: the menu stays open for the other.
            onSelect={(event) => {
              event.preventDefault();
              onToggle(mark);
            }}
          >
            <MenuItemIcon>{marks[mark] && <Check size={12} />}</MenuItemIcon>
            <MenuItemLabel>
              <span className={styles.row}>
                <span>{label}</span>
                <span className={styles.hint}>{hint}</span>
              </span>
            </MenuItemLabel>
          </MenuCheckboxItem>
        ))}
      </MenuContent>
    </DropdownMenu.Root>
  );
}
