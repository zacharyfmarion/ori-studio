import { useEffect, useMemo, useRef, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ArrowLeft, Compass } from 'lucide-react';
import { sheetThumbnail } from '../../cp-workspace/references/referencesSheets';
import type { DiagramStyle, ReferencesPlanSettings } from '../../diagram/document/diagramDocument';
import type { BrowserPattern } from '../../diagram/references/referencesBrowserPlans';
import { useReferencesBrowser, type ReferencesBrowser } from '../../diagram/references/useReferencesBrowser';
import { DIAGRAM_STEPS_ATTRIBUTE } from '../../diagram/actions/diagramShortcuts';
import { registerDiagramBrowserKeys } from '../../diagram/useDiagramShortcuts';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramReferencesBrowserState } from '../../store/workspaceStore/types';
import { Button } from '../ui/Button';
import { SegmentedControl } from '../ui/SegmentedControl';
import { DiagramReferencesCard } from './DiagramReferencesCard';
import { DiagramSheetThumbnail } from './DiagramSheetThumbnail';
import styles from './DiagramReferencesBrowser.module.css';

/**
 * The References browser, in the Diagram's centre (D20): References steps
 * are pulled from here, never pushed from References.
 *
 * Down the left, the patterns with a plan that fits them now, as References
 * numbers them; beside it the shown pattern's cards (or the Find answer
 * References has on screen), each the step it would become; under them what
 * is selected and the one verb, worded by where the browser was opened for —
 * after a step, at the end, into an empty step, or in place of a References
 * step's card. ← Steps and Escape close it.
 *
 * Takes focus as it opens, as the step detail does, so Escape and a screen
 * reader start here.
 */
export function DiagramReferencesBrowser({
  state,
  style,
  drawerSlot,
}: {
  state: DiagramReferencesBrowserState;
  style: DiagramStyle;
  /** Where the touch layer seats the Step pane's pill: this replaces the header that seats it. */
  drawerSlot: Ref<HTMLDivElement>;
}) {
  const { t } = useTranslation();
  const browser = useReferencesBrowser(state);
  const root = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, []);
  // The step keys walk the cards while the browser is open, the card they
  // land on taking focus (so Enter adds from it); read through a ref, so the
  // registration outlives the renders.
  const latest = useRef(browser);
  useEffect(() => {
    latest.current = browser;
  });
  useEffect(
    () =>
      registerDiagramBrowserKeys({
        move: (to) => {
          const index = latest.current.move(to);
          if (index === null) return;
          root.current?.querySelector<HTMLElement>(`[role="option"][data-card-index="${index}"]`)?.focus();
        },
        add: () => latest.current.add(),
      }),
    []
  );
  const title = browserTitle(browser, t);
  // The patterns down the left, once there are some to list: until then, and
  // in Find, the list's message has the room.
  const railShown =
    state.mode === 'sequence' && browser.patterns.status === 'ready' && browser.patterns.patterns.length > 0;

  return (
    <div ref={root} className={styles.browser} role="region" aria-label={title} tabIndex={-1}>
      <div className={`panel-toolbar ${styles.bar}`}>
        <div className="panel-toolbar__group">
          <Button size="sm" variant="ghost" onClick={browser.close}>
            <ArrowLeft size={14} aria-hidden="true" />
            {t('panels:diagram.detail.back', 'Steps')}
          </Button>
          <span className={styles.title}>{title}</span>
        </div>
        <SegmentedControl<'sequence' | 'find'>
          size="sm"
          aria-label={t('panels:diagram.references.list', 'List')}
          value={state.mode}
          options={[
            { value: 'sequence', label: t('panels:diagram.references.sequence', 'Sequence') },
            { value: 'find', label: t('panels:diagram.references.find', 'Find') },
          ]}
          onChange={browser.setMode}
        />
        <div className="panel-toolbar__group">
          <Button size="sm" variant="ghost" onClick={browser.openReferences}>
            <Compass size={14} aria-hidden="true" />
            {t('panels:diagram.references.openReferences', 'Open References')}
          </Button>
          <div className="panel-toolbar__pills" ref={drawerSlot} />
        </div>
      </div>
      <div className={styles.body} data-rail={railShown || undefined}>
        {railShown && <PatternRail browser={browser} />}
        <div className={styles.main}>
          {state.mode === 'sequence' && browser.cards.status === 'ready' && browser.cards.settings && (
            <PlannedWith settings={browser.cards.settings} />
          )}
          <BrowserCards browser={browser} style={style} />
        </div>
      </div>
      <BrowserFooter browser={browser} />
    </div>
  );
}

const NO_PATTERNS: readonly BrowserPattern[] = [];

/** The patterns with a plan, and the way to plan more. */
function PatternRail({ browser }: { browser: ReferencesBrowser }) {
  const { t } = useTranslation();
  const geometry = useWorkspaceStore((store) => store.oristudioCpDocument?.geometry ?? null);
  const { patterns, pattern: shown } = browser;
  const listed = patterns.status === 'ready' ? patterns.patterns : NO_PATTERNS;
  const thumbnails = useMemo(
    () => new Map(listed.map((entry) => [entry.id, geometry ? sheetThumbnail(geometry, entry.component) : null])),
    [listed, geometry]
  );
  return (
    <nav className={styles.rail} aria-label={t('panels:diagram.references.patterns', 'Patterns')}>
      {listed.map((entry) => {
        const thumbnail = thumbnails.get(entry.id);
        const used = browser.patternUse.get(entry.id) ?? 0;
        return (
          <button
            key={entry.id}
            type="button"
            className={styles.pattern}
            aria-current={entry.id === shown?.id || undefined}
            onClick={() => browser.choosePattern(entry.id)}
          >
            <span className={styles.patternThumb}>{thumbnail && <DiagramSheetThumbnail thumbnail={thumbnail} />}</span>
            <span className={styles.patternText}>
              <span className={styles.patternName}>
                {t('panels:diagram.references.pattern', 'Pattern {{number}}', { number: entry.number })}
              </span>
              <span className={styles.patternNote}>
                {used > 0
                  ? t('panels:diagram.references.patternInDiagram', '{{count}} in diagram', { count: used })
                  : t('panels:diagram.references.patternPlanned', 'Planned')}
              </span>
            </span>
          </button>
        );
      })}
      <Button size="sm" variant="ghost" className={styles.planMore} onClick={browser.openReferences}>
        {t('panels:diagram.references.planMore', 'Plan more patterns in References')}
      </Button>
    </nav>
  );
}

/** The settings the shown plan was made with: what made its cards these cards. */
function PlannedWith({ settings }: { settings: ReferencesPlanSettings }) {
  const { t } = useTranslation();
  const used = [
    settings.precreaseGrid && t('panels:references.settings.precreaseGrid', 'Precrease grid'),
    settings.precreaseGrid && settings.gridWhereNeeded && t('panels:references.settings.gridWhereNeeded', 'Only where needed'),
    settings.allowDanglingFolds && t('panels:references.settings.allowDangling', 'Allow dangling folds'),
    settings.mergeSymmetricSteps && t('panels:references.settings.mergeSymmetric', 'Merge symmetric steps'),
  ].filter((label): label is string => typeof label === 'string');
  return (
    <p className={styles.settings}>
      <span>{t('panels:diagram.references.plannedWith', 'Planned with')}</span>
      {used.length > 0 ? (
        used.map((label) => (
          <span key={label} className={styles.setting}>
            {label}
          </span>
        ))
      ) : (
        <span className={styles.setting}>{t('panels:diagram.references.noOptions', 'No options')}</span>
      )}
    </p>
  );
}

/** The list's cards, or why there are none. */
function BrowserCards({ browser, style }: { browser: ReferencesBrowser; style: DiagramStyle }) {
  const { t } = useTranslation();
  const { patterns, cards, state } = browser;
  const message = (text: string, action?: { label: string; run: () => void }) => (
    <div className={styles.message}>
      <p>{text}</p>
      {action && (
        <Button size="sm" variant="secondary" onClick={action.run}>
          {action.label}
        </Button>
      )}
    </div>
  );
  const openReferences = {
    label: t('panels:diagram.references.openReferences', 'Open References'),
    run: browser.openReferences,
  };
  if (patterns.status === 'no-pattern') {
    return message(t('panels:diagram.references.noPattern', 'Open a crease pattern in Edit to take steps from References.'));
  }
  if (state.mode === 'sequence') {
    if (patterns.status === 'finding') return message(t('panels:diagram.references.finding', 'Finding the patterns…'));
    if (patterns.status === 'failed') {
      return message(t('panels:diagram.references.failed', 'The patterns couldn’t be found. Try again in a moment.'));
    }
    if (patterns.patterns.length === 0) {
      return message(
        t(
          'panels:diagram.references.nothingPlanned',
          'No pattern has a plan yet. Plan one in References, and its cards appear here.'
        ),
        openReferences
      );
    }
  }
  switch (cards.status) {
    case 'loading':
      return message(t('panels:diagram.references.loading', 'Reading the plan…'));
    case 'unreadable':
      return message(
        t('panels:diagram.references.unreadable', 'This plan can’t be read here. Plan it again in References.'),
        openReferences
      );
    case 'stale':
      return message(
        t('panels:diagram.references.findStale', 'The pattern changed since this target was picked. Pick it again in References’ Find.'),
        openReferences
      );
    case 'none':
      return message(
        state.mode === 'find'
          ? t('panels:diagram.references.findNone', 'Pick a target in References’ Find, and its steps appear here.')
          : t('panels:diagram.references.loading', 'Reading the plan…'),
        state.mode === 'find' ? openReferences : undefined
      );
    case 'ready':
      break;
  }
  const offered = browser.withTurnOver ? browser.turnOverBefore : null;
  // One Tab stop: the card last pressed, or the first that can be.
  const tabStop = browser.selection.pivot ?? cards.cards.find((card) => card.step)?.index ?? null;
  return (
    <div
      className={styles.grid}
      role="listbox"
      aria-multiselectable="true"
      aria-label={t('panels:diagram.references.cards', 'Cards')}
      {...{ [DIAGRAM_STEPS_ATTRIBUTE]: '' }}
    >
      {cards.cards.map((card) => (
        <DiagramReferencesCard
          key={card.index}
          card={card}
          style={style}
          selected={browser.selection.indices.has(card.index)}
          tabStop={card.index === tabStop}
          inDiagram={browser.inDiagram.get(card.index) ?? null}
          shownNow={browser.shownCard === card.index}
          offered={offered === card.index}
          onPress={(modifiers) => browser.press(card.index, modifiers)}
          onAdd={() => browser.addOne(card.index)}
        />
      ))}
    </div>
  );
}

/** What is selected, and the verb that adds it. */
function BrowserFooter({ browser }: { browser: ReferencesBrowser }) {
  const { t } = useTranslation();
  const selected = browser.selection.indices.size;
  const ready = browser.cards.status === 'ready';
  return (
    <div className={styles.footer}>
      <span className={styles.count}>
        {t('panels:diagram.references.selected', '{{count}} selected', { count: selected })}
      </span>
      <Button size="sm" variant="ghost" disabled={!ready} onClick={browser.selectAll}>
        {t('panels:diagram.references.selectAll', 'Select all')}
      </Button>
      <Button size="sm" variant="ghost" disabled={selected === 0} onClick={browser.clear}>
        {t('panels:diagram.references.clear', 'Clear')}
      </Button>
      {browser.turnOverBefore !== null && (
        <label className={styles.turnOver}>
          <input
            type="checkbox"
            checked={browser.withTurnOver}
            onChange={(event) => browser.setWithTurnOver(event.currentTarget.checked)}
          />
          {t('panels:diagram.references.withTurnOver', 'With the turn-over before it')}
        </label>
      )}
      <Button
        size="sm"
        variant="primary"
        className={styles.add}
        disabled={browser.pullable.length === 0 || browser.pulling}
        onClick={browser.add}
      >
        {browser.pulling ? t('panels:diagram.references.adding', 'Adding…') : addLabel(browser, t)}
      </Button>
    </div>
  );
}

/** The browser's title: where what it adds goes. */
function browserTitle(browser: ReferencesBrowser, t: TFunction): string {
  const { anchor } = browser.state;
  const number = browser.anchorNumber;
  if (number === null || anchor.kind === 'end') return t('panels:diagram.references.titleEnd', 'Add from References');
  if (anchor.kind === 'after' || !browser.anchorTakesFirst) {
    return t('panels:diagram.references.titleAfter', 'Add after step {{number}}', { number });
  }
  return anchor.kind === 'fill'
    ? t('panels:diagram.references.titleFill', 'Fill step {{number}}', { number })
    : t('panels:diagram.references.titleReplace', 'Replace step {{number}}’s card', { number });
}

/** The verb, as what it will do: how many steps, and where. */
function addLabel(browser: ReferencesBrowser, t: TFunction): string {
  const count = Math.max(1, browser.pullable.length);
  const { anchor } = browser.state;
  const number = browser.anchorNumber;
  if (number === null || anchor.kind === 'end') {
    return t('panels:diagram.references.addSteps', {
      count,
      defaultValue_one: 'Add step',
      defaultValue_other: 'Add {{count}} steps',
    });
  }
  if (anchor.kind === 'after' || !browser.anchorTakesFirst) {
    return t('panels:diagram.references.addAfter', {
      count,
      number,
      defaultValue_one: 'Add step after step {{number}}',
      defaultValue_other: 'Add {{count}} steps after step {{number}}',
    });
  }
  const rest = count - 1;
  if (anchor.kind === 'fill') {
    return rest === 0
      ? t('panels:diagram.references.fill', 'Fill step {{number}}', { number })
      : t('panels:diagram.references.fillAndAdd', {
          count: rest,
          number,
          defaultValue_one: 'Fill step {{number}} and add 1 after it',
          defaultValue_other: 'Fill step {{number}} and add {{count}} after it',
        });
  }
  return rest === 0
    ? t('panels:diagram.references.replace', 'Replace step {{number}}’s card', { number })
    : t('panels:diagram.references.replaceAndAdd', {
        count: rest,
        number,
        defaultValue_one: 'Replace step {{number}} and add 1 after it',
        defaultValue_other: 'Replace step {{number}} and add {{count}} after it',
      });
}
