import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ArrowRight, Copy, Trash2, type LucideIcon } from 'lucide-react';
import {
  diagramStepCommand,
  type DiagramStepAction,
  type DiagramStepActionId,
} from '../../diagram/actions/diagramActions';
import { IconButton } from '../ui/IconButton';
import styles from './DiagramStepHeader.module.css';

const ICONS: Partial<Record<DiagramStepActionId, LucideIcon>> = {
  'move-earlier': ArrowLeft,
  'move-later': ArrowRight,
  duplicate: Copy,
  delete: Trash2,
};

/** The verbs the Step pane's header shows, in this order; the rest are in the card's menu. */
const HEADER_VERBS: readonly DiagramStepActionId[] = ['move-earlier', 'move-later', 'duplicate', 'delete'];

/**
 * "Step [N] of M" and the step's verbs, at the top of the Step pane.
 *
 * N is a field: typing a position moves the step there. It commits on blur or
 * Enter, and Escape (or anything that is not a position) puts the number back.
 */
export function DiagramStepHeader({
  number,
  count,
  readOnly,
  actions,
  onMoveTo,
}: {
  /** 1-based. */
  number: number;
  count: number;
  readOnly: boolean;
  actions: readonly DiagramStepAction[];
  /** Move the step to a 1-based position. */
  onMoveTo: (position: number) => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(String(number));
  const discarding = useRef(false);
  useEffect(() => {
    setDraft(String(number));
  }, [number]);

  const commit = () => {
    const position = Number(draft.trim());
    if (Number.isInteger(position) && position >= 1 && position <= count && position !== number) {
      onMoveTo(position);
    } else {
      setDraft(String(number));
    }
  };

  return (
    <div className={styles.header}>
      <div className={styles.position}>
        <span>{t('panels:diagram.stepPane.step', 'Step')}</span>
        <input
          className={styles.field}
          type="text"
          inputMode="numeric"
          value={draft}
          disabled={readOnly || count < 2}
          aria-label={t('panels:diagram.stepPane.positionLabel', 'Step position')}
          size={Math.max(2, String(count).length + 1)}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            if (discarding.current) {
              discarding.current = false;
              return;
            }
            commit();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.currentTarget.blur();
            } else if (event.key === 'Escape') {
              discarding.current = true;
              setDraft(String(number));
              event.currentTarget.blur();
            }
          }}
        />
        <span>{t('panels:diagram.stepPane.ofTotal', 'of {{total}}', { total: count })}</span>
      </div>
      <div className={styles.verbs}>
        {HEADER_VERBS.map((id) => {
          const command = diagramStepCommand(actions, id);
          const Icon = ICONS[id];
          if (!command || !Icon) return null;
          return (
            <IconButton
              key={id}
              size="sm"
              title={command.disabled && command.hint ? command.hint : command.label}
              aria-label={command.label}
              disabled={command.disabled}
              onClick={command.run}
            >
              <Icon size={15} />
            </IconButton>
          );
        })}
      </div>
    </div>
  );
}
