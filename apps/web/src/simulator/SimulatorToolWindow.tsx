import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/Button';
import { ToggleRow } from '../components/ui/fieldRows/ToggleRow';
import { ToolHintInstructions } from '../components/ui/tools/ToolHintInstructions';
import { ToolHintWindow } from '../components/ui/tools/ToolHintWindow';
import { STORAGE_KEYS } from '../lib/storage';
import type { SimulatorToolWindowModel } from './tools/actions';
import styles from './SimulatorToolWindow.module.css';

/**
 * The Simulate canvas's tool window: Edit's window chrome, with whatever the
 * tool in hand has to say inside it — what it needs first, how to use it, its
 * options, Clear while there are pins, Spring back while the paper holds a pose,
 * and the simulation's notices about them.
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
      {model.needsPins && (
        <div className={styles.section}>
          <p className={styles.notice}>{model.needsPins.text}</p>
          <Button size="sm" variant="secondary" className={styles.action} onClick={model.needsPins.pin}>
            {model.needsPins.pinLabel}
          </Button>
        </div>
      )}
      {model.instructions.length > 0 && (
        <div className={styles.section}>
          <ToolHintInstructions
            heading={t('panels:simulator.tools.instructions', 'Instructions')}
            items={model.instructions}
          />
        </div>
      )}
      {/* No divider: the window divides its own sections, so a rule under the
          last option would separate it from nothing. */}
      {model.toggles.length > 0 && (
        <div className={styles.section}>
          {model.toggles.map((toggle) => (
            <ToggleRow
              key={toggle.id}
              label={toggle.label}
              checked={toggle.checked}
              divider={false}
              onChange={toggle.set}
            />
          ))}
        </div>
      )}
      {model.pins && (
        <div className={styles.section}>
          <Button size="sm" variant="secondary" className={styles.action} onClick={model.pins.clear}>
            {model.pins.clearLabel}
          </Button>
        </div>
      )}
      {model.pose && (
        <div className={styles.section}>
          <Button size="sm" variant="secondary" className={styles.action} onClick={model.pose.springBack}>
            {model.pose.springBackLabel}
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
