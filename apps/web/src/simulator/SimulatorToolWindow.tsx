import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';
import { ToggleRow } from '../components/ui/fieldRows/ToggleRow';
import { ToolHintWindow } from '../components/ui/tools/ToolHintWindow';
import { STORAGE_KEYS } from '../lib/storage';
import type { SimulatorToolWindowModel } from './tools/actions';
import styles from './SimulatorToolWindow.module.css';

/**
 * The Simulate canvas's tool window: Edit's window chrome, with whatever the
 * tool in hand has to say inside it — how to use it, its options, Clear while
 * there are pins, and the simulation's notices about them.
 *
 * One renderer for every tool. What a tool shows is its model, built in
 * `tools/actions.ts`; nothing here knows which tool it is drawing.
 *
 * Mounted outside `.simulator-panel__body` in the React tree. The window is
 * portaled, and portal events still bubble through React: inside the body a
 * right click on the window would open the viewport's context menu.
 */
export function SimulatorToolWindow({
  container,
  model,
}: {
  /** The viewport cell the window anchors to. */
  container: HTMLElement | null;
  model: SimulatorToolWindowModel | null;
}) {
  const { t } = useTranslation();
  if (!model) return null;
  return (
    <ToolHintWindow
      container={container}
      collapseKey={STORAGE_KEYS.simulatorToolHintCollapsed}
      title={model.title}
      meta={model.meta}
      ariaLabel={t('panels:simulator.tools.windowLabel', 'Simulator tool options')}
    >
      {model.instructions.length > 0 && (
        <div className={styles.section}>
          <div className={styles.heading}>
            {t('panels:simulator.tools.instructions', 'Instructions')}
          </div>
          <ul className={styles.instructions}>
            {model.instructions.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}
      {model.toggles.length > 0 && (
        <div className={styles.section}>
          {model.toggles.map((toggle) => (
            <ToggleRow
              key={toggle.id}
              label={toggle.label}
              checked={toggle.checked}
              onChange={toggle.set}
            />
          ))}
        </div>
      )}
      {model.pins && (
        <div className={styles.section}>
          <Button size="sm" variant="secondary" className={styles.clear} onClick={model.pins.clear}>
            {model.pins.clearLabel}
          </Button>
        </div>
      )}
      {model.notices.length > 0 && (
        <div className={styles.section} role="status">
          {model.notices.map((notice) => (
            <p key={notice} className={styles.notice}>
              {notice}
            </p>
          ))}
        </div>
      )}
    </ToolHintWindow>
  );
}
