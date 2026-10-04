import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ArrowLeft, Compass, X } from 'lucide-react';
import { sheetThumbnail } from '../../cp-workspace/references/referencesSheets';
import { DEFAULT_DIAGRAM_STYLE, type DiagramStyle, type ReferencesPlanSettings } from '../../diagram/document/diagramDocument';
import type { BrowserPattern } from '../../diagram/references/referencesBrowserPlans';
import { selectable, type BrowserStep } from '../../diagram/references/referencesBrowserSelection';
import { useReferencesBrowser, type ReferencesBrowser } from '../../diagram/references/useReferencesBrowser';
import { useReferencesBrowserPhoneFlow } from '../../diagram/references/useReferencesBrowserPhoneFlow';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramReferencesBrowserState } from '../../store/workspaceStore/types';
import { Button } from '../ui/Button';
import { IconButton } from '../ui/IconButton';
import { SegmentedControl } from '../ui/SegmentedControl';
import { dialogOpener, useModalDialog } from '../ui/useModalDialog';
import { DiagramReferencesCard } from './DiagramReferencesCard';
import { DiagramSheetThumbnail } from './DiagramSheetThumbnail';
import styles from './DiagramReferencesBrowser.module.css';

/**
 * The References browser (D20): a modal over the Diagram, from which
 * References steps are pulled — never pushed from References. Mounted at the
 * App root while the Diagram is the workspace on screen and the store says it
 * is open; the step detail, if one is open, stays behind it.
 */
export function DiagramReferencesModal() {
  const state = useWorkspaceStore((store) => store.diagramReferencesBrowser);
  const style = useWorkspaceStore((store) => store.diagram?.style ?? DEFAULT_DIAGRAM_STYLE);
  const shown = useLayoutStore((store) => store.activeWorkspace === 'diagram');
  if (!state || !shown) return null;
  return <DiagramReferencesBrowser key={state.opening} state={state} style={style} />;
}

/** A step's card in the steps grid, for the anchors that name a step. */
function stepCard(anchor: DiagramReferencesBrowserState['anchor']): HTMLElement | null {
  if (!('stepId' in anchor)) return null;
  const cards = document.querySelectorAll<HTMLElement>('[role="option"][data-step-id]');
  return [...cards].find((card) => card.dataset.stepId === anchor.stepId) ?? null;
}

/** How the list's own keys move through its cards. */
const LIST_KEYS: Readonly<Record<string, BrowserStep>> = {
  ArrowLeft: 'previous',
  ArrowUp: 'previous',
  ArrowRight: 'next',
  ArrowDown: 'next',
  Home: 'first',
  End: 'last',
};

/**
 * The browser itself. Down the left, the patterns with a plan that fits them
 * now, as References numbers them; beside it the shown pattern's cards (or
 * the Find answer References has on screen), each the step it would become;
 * under them what is selected and the one verb, worded by where the browser
 * was opened for — after a step, at the end, into an empty step, or in place
 * of a References step's card.
 *
 * A dialog and a shortcut barrier (`useModalDialog`): the keys are its own.
 * Escape, Cancel, the close button and a press on the backdrop close it; the
 * list's keys are a multi-select listbox's (`browserSelection`), and Enter
 * adds. It takes focus as it opens and moves it to the cards once they are
 * there; closed, focus goes back where it was.
 */
export function DiagramReferencesBrowser({ state, style }: { state: DiagramReferencesBrowserState; style: DiagramStyle }) {
  const { t } = useTranslation();
  const browser = useReferencesBrowser(state);
  // Back where it was opened from — or, from a menu with nothing to go back
  // to (a step's context menu), to the card of the step it was opened for.
  const [returnFocus] = useState(() => dialogOpener() ?? stepCard(state.anchor));
  const { rootRef, documentRef, keepFocus } = useModalDialog(browser.close, returnFocus);
  const focusCard = (index: number | null) => {
    if (index === null) return;
    documentRef.current?.querySelector<HTMLElement>(`[role="option"][data-card-index="${index}"]`)?.focus();
  };
  // On a phone, the patterns, then a pattern's cards, a screen each.
  const phone = useReferencesBrowserPhoneFlow(browser, documentRef);
  // Onto the cards the first time there are some, unless the reader has
  // already moved focus off the dialog's own surface: a tick on, once the
  // dialog has settled its own focus (`useModalDialog`).
  const ready = browser.cards.status === 'ready';
  const onCards = useRef(false);
  useEffect(() => {
    if (onCards.current || !ready) return undefined;
    const timer = window.setTimeout(() => {
      onCards.current = true;
      if (document.activeElement === documentRef.current) {
        documentRef.current?.querySelector<HTMLElement>('[role="option"][tabindex="0"]')?.focus({ preventScroll: true });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [ready, documentRef]);
  const title = browserTitle(browser, t);
  // The patterns down the left, once there are some to list: until then, and
  // in Find, the list's message has the room.
  const railShown =
    state.mode === 'sequence' && browser.patterns.status === 'ready' && browser.patterns.patterns.length > 0;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-shortcut-barrier=""
      className={styles.backdrop}
      onMouseDown={browser.close}
    >
      <div
        ref={documentRef}
        role="document"
        tabIndex={-1}
        className={styles.browser}
        data-screen={phone.screen ?? undefined}
        onMouseDown={(event) => event.stopPropagation()}
        onBlur={keepFocus}
        onKeyDown={(event) => {
          // The list's keys, from a card or from the dialog itself — where
          // focus rests until a card has it. Any other control keeps its own,
          // and on a phone's list of patterns the cards are off screen.
          if (event.defaultPrevented || phone.screen === 'list') return;
          const target = event.target as HTMLElement;
          if (target !== documentRef.current && target.getAttribute('role') !== 'option') return;
          const plain = !event.altKey && !event.metaKey && !event.ctrlKey;
          const to = LIST_KEYS[event.key];
          if (to && plain) {
            event.preventDefault();
            focusCard(event.shiftKey ? browser.extend(to) : browser.move(to));
          } else if (event.key === ' ' && plain) {
            event.preventDefault();
            browser.toggle();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            browser.add();
          } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            browser.selectAll();
          }
        }}
      >
        <div className={styles.bar}>
          <div className={styles.lead}>
            {phone.back && (
              <Button size="sm" variant="ghost" onClick={phone.back}>
                <ArrowLeft size={14} aria-hidden="true" />
                {t('panels:diagram.references.patterns', 'Patterns')}
              </Button>
            )}
            <span className={styles.title}>{title}</span>
          </div>
          <div className={styles.tools}>
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
            <Button size="sm" variant="ghost" onClick={browser.openReferences}>
              <Compass size={14} aria-hidden="true" />
              {t('panels:diagram.references.openReferences', 'Open References')}
            </Button>
          </div>
          <IconButton
            size="sm"
            aria-label={t('dialogs:common.closeNamed', 'Close {{name}}', { name: title })}
            onClick={browser.close}
          >
            <X size={15} />
          </IconButton>
        </div>
        <div className={styles.body} data-rail={railShown || undefined}>
          {railShown && <PatternRail browser={browser} onOpen={phone.openPattern} />}
          <div className={styles.main}>
            {state.mode === 'sequence' && browser.cards.status === 'ready' && browser.cards.settings && (
              <PlannedWith settings={browser.cards.settings} />
            )}
            <BrowserCards browser={browser} style={style} />
          </div>
        </div>
        <BrowserFooter browser={browser} />
      </div>
    </div>
  );
}

const NO_PATTERNS: readonly BrowserPattern[] = [];

/** The patterns with a plan, and the way to plan more. */
function PatternRail({ browser, onOpen }: { browser: ReferencesBrowser; onOpen: (id: string) => void }) {
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
            onClick={() => onOpen(entry.id)}
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
      <button type="button" className={styles.planMore} onClick={browser.openReferences}>
        {t('panels:diagram.references.planMore', 'Plan more patterns in References')}
      </button>
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
  // Find needs the patterns too: an answer is added on the sheet it is for.
  if (patterns.status === 'finding') return message(t('panels:diagram.references.finding', 'Finding the patterns…'));
  if (patterns.status === 'failed') {
    return message(t('panels:diagram.references.failed', 'The patterns couldn’t be found. Try again in a moment.'));
  }
  if (state.mode === 'sequence') {
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
  // One Tab stop: where the keyboard is, or the first card that can be selected.
  const tabStop = browser.selection.focus ?? cards.cards.find((card) => card.step)?.index ?? null;
  return (
    <div
      className={styles.grid}
      role="listbox"
      aria-multiselectable="true"
      aria-label={t('panels:diagram.references.cards', 'Cards')}
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
          choosable={selectable(card, cards.finished)}
          onPress={(modifiers) => browser.press(card.index, modifiers)}
          onFocus={() => browser.focusOn(card.index)}
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
      <Button size="sm" variant="ghost" className={styles.cancel} onClick={browser.close}>
        {t('dialogs:common.cancel', 'Cancel')}
      </Button>
      <Button
        size="sm"
        variant="primary"
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

/** The verb, as what it will do: how many steps, and where. A turn-over card is no step (D22). */
function addLabel(browser: ReferencesBrowser, t: TFunction): string {
  const steps = browser.pullable.filter((pulled) => pulled.card.kind !== 'turn-over').length;
  if (steps === 0 && browser.pullable.length > 0) {
    return t('panels:diagram.references.addTurnOvers', {
      count: browser.pullable.length,
      defaultValue_one: 'Add turn-over',
      defaultValue_other: 'Add {{count}} turn-overs',
    });
  }
  const count = Math.max(1, steps);
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
