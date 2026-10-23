import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { ArrowLeft, Compass, X } from 'lucide-react';
import { sheetThumbnail } from '../../cp-workspace/references/referencesSheets';
import {
  DEFAULT_DIAGRAM_STYLE,
  type DiagramPullAnchor,
  type DiagramStyle,
  type ReferencesPlanSettings,
} from '../../diagram/document/diagramDocument';
import type { BrowserPattern } from '../../diagram/references/referencesBrowserPlans';
import { selectable, type BrowserStep } from '../../diagram/references/referencesBrowserSelection';
import type { PullSelection } from '../../diagram/references/usePullSelection';
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
import { DiagramReferencesShowMenu } from './DiagramReferencesShowMenu';
import { PatternThumbnail } from '../ui/PatternThumbnail';
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
function stepCard(anchor: DiagramPullAnchor): HTMLElement | null {
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
 * A pull browser's list as its frame reads it, whatever it pulls from —
 * References' plans, or a Fold sequence (fold-workspace plan D17): what is
 * chosen, whether it can be added and the verbs that choose and add.
 */
export interface PullBrowserList
  extends Pick<PullSelection, 'selection' | 'move' | 'extend' | 'toggle' | 'selectAll' | 'clear'> {
  /** The list's cards are there to choose from. */
  ready: boolean;
  /** How many entries the selection adds. */
  pullableCount: number;
  /** A pull is under way: the verbs wait for it. */
  pulling: boolean;
  /** The turn just before the selection, offered with it. */
  turnOverBefore: number | null;
  withTurnOver: boolean;
  setWithTurnOver: (value: boolean) => void;
  /** Add the selection where the browser was opened for. */
  add: () => void;
  close: () => void;
}

/** A pull browser's dialog, opened for `anchor`: its refs, and the focus it keeps. */
export interface PullBrowserDialog {
  rootRef: ReturnType<typeof useModalDialog>['rootRef'];
  documentRef: ReturnType<typeof useModalDialog>['documentRef'];
  keepFocus: ReturnType<typeof useModalDialog>['keepFocus'];
}

/**
 * A pull browser's dialog (`useModalDialog`): it takes focus as it opens and
 * moves it to the cards once they are there; closed, focus goes back where
 * it was opened from — or, from a menu with nothing to go back to (a step's
 * context menu), to the card of the step it was opened for.
 */
export function usePullBrowserDialog(list: Pick<PullBrowserList, 'close' | 'ready'>, anchor: DiagramPullAnchor): PullBrowserDialog {
  const [returnFocus] = useState(() => dialogOpener() ?? stepCard(anchor));
  const { rootRef, documentRef, keepFocus } = useModalDialog(list.close, returnFocus);
  // Onto the cards the first time there are some, unless the reader has
  // already moved focus off the dialog's own surface: a tick on, once the
  // dialog has settled its own focus (`useModalDialog`).
  const { ready } = list;
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
  return { rootRef, documentRef, keepFocus };
}

/**
 * A pull browser's frame (D20): the dialog over the Diagram, its bar — what
 * leads it, its title, its tools, Close — its body — a rail, when it has one,
 * beside the list — and its footer: what is selected and the one verb,
 * `addLabel`. The References browser and the Fold browser are each this frame
 * and what they put in it.
 *
 * A dialog and a shortcut barrier: the keys are its own. Escape, Cancel, the
 * close button and a press on the backdrop close it; the list's keys are a
 * multi-select listbox's (`browserSelection`), and Enter adds — except on a
 * phone's screen of the rail (`screen: 'list'`), where the cards are off
 * screen.
 */
export function PullBrowserFrame({
  dialog,
  list,
  title,
  addLabel,
  turnLabel,
  screen,
  lead,
  tools,
  rail,
  children,
}: {
  dialog: PullBrowserDialog;
  list: PullBrowserList;
  title: string;
  addLabel: string;
  /** The footer's offer of the turn just before the selection; References' turn-over card's by default. */
  turnLabel?: string;
  /** The phone screen shown (`usePhoneListDetail`), or null on any other layout. */
  screen?: 'list' | 'detail' | null;
  /** Before the title in the bar: a phone's way back to the rail. */
  lead?: ReactNode;
  tools?: ReactNode;
  /** Down the left of the body; absent, the list has the room. */
  rail?: ReactNode;
  /** The list: its cards, or why there are none. */
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const { rootRef, documentRef, keepFocus } = dialog;
  const focusCard = (index: number | null) => {
    if (index === null) return;
    documentRef.current?.querySelector<HTMLElement>(`[role="option"][data-card-index="${index}"]`)?.focus();
  };
  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-shortcut-barrier=""
      className={styles.backdrop}
      onMouseDown={list.close}
    >
      <div
        ref={documentRef}
        role="document"
        tabIndex={-1}
        className={styles.browser}
        data-screen={screen ?? undefined}
        onMouseDown={(event) => event.stopPropagation()}
        onBlur={keepFocus}
        onKeyDown={(event) => {
          // The list's keys, from a card or from the dialog itself — where
          // focus rests until a card has it. Any other control keeps its own,
          // and on a phone's list of patterns the cards are off screen.
          if (event.defaultPrevented || screen === 'list') return;
          const target = event.target as HTMLElement;
          if (target !== documentRef.current && target.getAttribute('role') !== 'option') return;
          const plain = !event.altKey && !event.metaKey && !event.ctrlKey;
          const to = LIST_KEYS[event.key];
          if (to && plain) {
            event.preventDefault();
            focusCard(event.shiftKey ? list.extend(to) : list.move(to));
          } else if (event.key === ' ' && plain) {
            event.preventDefault();
            list.toggle();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            list.add();
          } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
            event.preventDefault();
            list.selectAll();
          }
        }}
      >
        <div className={styles.bar}>
          <div className={styles.lead}>
            {lead}
            <span className={styles.title}>{title}</span>
          </div>
          <div className={styles.tools}>{tools}</div>
          <IconButton
            size="sm"
            aria-label={t('dialogs:common.closeNamed', 'Close {{name}}', { name: title })}
            onClick={list.close}
          >
            <X size={15} />
          </IconButton>
        </div>
        <div className={styles.body} data-rail={rail ? true : undefined}>
          {rail}
          <div className={styles.main}>{children}</div>
        </div>
        <BrowserFooter list={list} addLabel={addLabel} turnLabel={turnLabel} />
      </div>
    </div>
  );
}

/** Why a pull browser's list has no cards, and the way to some: the frame's message. */
export function PullBrowserMessage({ text, action }: { text: string; action?: { label: string; run: () => void } }) {
  return (
    <div className={styles.message}>
      <p>{text}</p>
      {action && (
        <Button size="sm" variant="secondary" onClick={action.run}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

/** A pull browser's cards: a multi-select listbox, as the frame's keys walk it. */
export function PullBrowserGrid({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.grid} role="listbox" aria-multiselectable="true" aria-label={label}>
      {children}
    </div>
  );
}

/**
 * The References browser (D20). Down the left, the patterns with a plan that
 * fits them now, as References numbers them; beside it the shown pattern's
 * cards (or the Find answer References has on screen), each the step it
 * would become; under them what is selected and the one verb, worded by
 * where the browser was opened for — after a step, at the end, into an empty
 * step, or in place of a References step's card.
 */
export function DiagramReferencesBrowser({ state, style }: { state: DiagramReferencesBrowserState; style: DiagramStyle }) {
  const { t } = useTranslation();
  const browser = useReferencesBrowser(state);
  const list: PullBrowserList = {
    selection: browser.selection,
    ready: browser.cards.status === 'ready',
    pullableCount: browser.pullable.length,
    pulling: browser.pulling,
    turnOverBefore: browser.turnOverBefore,
    withTurnOver: browser.withTurnOver,
    setWithTurnOver: browser.setWithTurnOver,
    move: browser.move,
    extend: browser.extend,
    toggle: browser.toggle,
    selectAll: browser.selectAll,
    clear: browser.clear,
    add: browser.add,
    close: browser.close,
  };
  const dialog = usePullBrowserDialog(list, state.anchor);
  // On a phone, the patterns, then a pattern's cards, a screen each.
  const phone = useReferencesBrowserPhoneFlow(browser, dialog.documentRef);
  const title = browserTitle(browser, t);
  // The patterns down the left, once there are some to list: until then, and
  // in Find, the list's message has the room.
  const railShown =
    state.mode === 'sequence' && browser.patterns.status === 'ready' && browser.patterns.patterns.length > 0;

  return (
    <PullBrowserFrame
      dialog={dialog}
      list={list}
      title={title}
      addLabel={addLabel(browser, t)}
      screen={phone.screen}
      lead={
        phone.back && (
          <Button size="sm" variant="ghost" onClick={phone.back}>
            <ArrowLeft size={14} aria-hidden="true" />
            {t('panels:diagram.references.patterns', 'Patterns')}
          </Button>
        )
      }
      tools={
        <>
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
          <DiagramReferencesShowMenu marks={browser.marks} onToggle={browser.toggleMark} />
          <Button size="sm" variant="ghost" onClick={browser.openReferences}>
            <Compass size={14} aria-hidden="true" />
            {t('panels:diagram.references.openReferences', 'Open References')}
          </Button>
        </>
      }
      rail={railShown ? <PatternRail browser={browser} onOpen={phone.openPattern} /> : undefined}
    >
      {state.mode === 'sequence' && browser.cards.status === 'ready' && browser.cards.settings && (
        <PlannedWith settings={browser.cards.settings} />
      )}
      <BrowserCards browser={browser} style={style} />
    </PullBrowserFrame>
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
            <span className={styles.patternThumb}>{thumbnail && <PatternThumbnail thumbnail={thumbnail} />}</span>
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
    <PullBrowserMessage text={text} action={action} />
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
    <PullBrowserGrid label={t('panels:diagram.references.cards', 'Cards')}>
      {cards.cards.map((card) => (
        <DiagramReferencesCard
          key={card.index}
          card={card}
          style={style}
          marks={browser.marks}
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
    </PullBrowserGrid>
  );
}

/** What is selected, and the verb that adds it. */
function BrowserFooter({
  list,
  addLabel: label,
  turnLabel,
}: {
  list: PullBrowserList;
  addLabel: string;
  turnLabel?: string;
}) {
  const { t } = useTranslation();
  const selected = list.selection.indices.size;
  return (
    <div className={styles.footer}>
      <span className={styles.count}>
        {t('panels:diagram.references.selected', '{{count}} selected', { count: selected })}
      </span>
      <Button size="sm" variant="ghost" disabled={!list.ready} onClick={list.selectAll}>
        {t('panels:diagram.references.selectAll', 'Select all')}
      </Button>
      <Button size="sm" variant="ghost" disabled={selected === 0} onClick={list.clear}>
        {t('panels:diagram.references.clear', 'Clear')}
      </Button>
      {list.turnOverBefore !== null && (
        <label className={styles.turnOver}>
          <input
            type="checkbox"
            checked={list.withTurnOver}
            onChange={(event) => list.setWithTurnOver(event.currentTarget.checked)}
          />
          {turnLabel ?? t('panels:diagram.references.withTurnOver', 'With the turn-over before it')}
        </label>
      )}
      <Button size="sm" variant="ghost" className={styles.cancel} onClick={list.close}>
        {t('dialogs:common.cancel', 'Cancel')}
      </Button>
      <Button size="sm" variant="primary" disabled={list.pullableCount === 0 || list.pulling} onClick={list.add}>
        {list.pulling ? t('panels:diagram.references.adding', 'Adding…') : label}
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
