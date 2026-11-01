/**
 * The Layer order dialog on the Export crease pattern dialog's and the Share
 * modal's folded figure
 * (`implementation-plans/spread-and-layer-order-in-edit-export-share.md`,
 * approach §1, decisions 3 and 4): the Layer order row's verbs and readout,
 * and the step aside while the dialog is open.
 *
 * - **Edit…** builds the request (`exportLayerOrderRequest`) from the fold the
 *   preview shows and opens the dialog through its gateway. While it is open
 *   the host dialog steps aside — it renders nothing (`ordering`), keeping its
 *   state and its fold cache — and comes back when the dialog closes, with
 *   focus on Edit….
 * - **Outcomes.** `applied` keeps the order for these creases (and the turn,
 *   if Rotate turned them), and the preview folds the figure in it;
 *   `unchanged` with a turn keeps only the turn; `cancelled`, `busy` and
 *   `unavailable` change nothing (the gateway has told the user about the
 *   last). Nothing reaches the document or its history (decision 3).
 * - **Withdrawn** when what it was asked from goes (`scope`): the export
 *   dialog closing or replaced, the share draft dismissed.
 * - **‹ ›** step the kernel's own order by its fold case, as Export's Fold
 *   case did; on a chosen order, through the solutions that fit it, on the
 *   hosts' cursor (`exportSolutionCursor.ts`, H6), made on the first press.
 *
 * Opening the dialog is the only engine work it starts; the dialog's code is
 * fetched ahead on intent (`prefetch`), which spawns nothing.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { TFunction } from 'i18next';
import {
  isLayerOrderDialogOpen,
  openLayerOrderDialog,
  prefetchLayerOrderDialog,
} from '../../layer-order/dialog/layerOrderDialogGateway';
import { solutionPlaceEnds } from '../../layer-order/host/solutionCursorTable';
import type { LayerOrderRowEntry } from '../../components/paper/LayerOrderRow';
import type { ControlVerb } from '../../lib/controlVerb';
import { creaseExportPinnedStyle, type CreaseExportFoldedFigureSettings } from '../../lib/creaseExport';
import type { CreaseExportLayerOrderHost } from '../../lib/creaseExportFold';
import type { CpSegment } from '../../lib/creasePatternSegmentation';
import { layerOrderCount, solutionPlaceCount } from '../../lib/layerOrderPlace';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import type { FoldedFigureOrder, FoldedFigurePreview } from '../folded/useFoldedFigurePreview';
import { exportLayerOrderRequest, type ExportLayerOrderSurface } from './exportLayerOrderRequest';
import {
  exportLayerOrderAfter,
  exportLayerOrderFor,
  rememberExportLayerOrder,
  useExportLayerOrders,
} from './exportLayerOrders';
import {
  dropExportSolutionCursor,
  exportSolutionCursorVersion,
  exportSolutionPlace,
  stepExportSolution,
  subscribeExportSolutionCursor,
  type ExportCursorFigure,
} from './exportSolutionCursor';

/**
 * The orders chosen this session, as the preview asks for them as a fold
 * lands (`useFoldedFigurePreview`'s `orderFor`): a new lookup whenever any
 * changes, so the preview refolds in a new one.
 */
export function useExportLayerOrderLookup(): (digest: string) => FoldedFigureOrder | null {
  const byDigest = useExportLayerOrders((state) => state.byDigest);
  return useCallback((digest: string) => byDigest[digest]?.chosen ?? null, [byDigest]);
}

export interface ExportLayerOrderOptions {
  readonly surface: ExportLayerOrderSurface;
  /** The workspace's side of the dialog; null when this export cannot fold. */
  readonly host: CreaseExportLayerOrderHost | null;
  /** The pattern the figure folds, as the host folds it. */
  readonly segment: CpSegment | null;
  /** The preview's figure: what its fold was made from, the scene it shows, where it stands. */
  readonly preview: FoldedFigurePreview;
  readonly settings: CreaseExportFoldedFigureSettings;
  /** The figure's export style, before the dialog's colours are pinned over it (`useCreaseExportPaper`). */
  readonly style: PaperStyle;
  /** What the Layer order dialog's title row calls the figure, and quieter, its credit. */
  readonly name: string;
  readonly byline?: string | null;
  /** Open with the hidden layers showing: when the figure is spread (D5). */
  readonly xray?: boolean;
  /** Step the kernel's own order to another fold case. */
  readonly setFoldCase: (foldCase: number) => void;
  /** Why the row can do nothing now, said under its label (Share once its link exists); null when it can. */
  readonly held?: string | null;
  /** What the host dialog is open on: when it changes, or the dialog goes, an open ask is withdrawn. */
  readonly scope: unknown;
  /**
   * The row's Edit… button (`LayerOrderRow`'s ref): focus comes back to it as the host
   * dialog does, since the button the dialog would give it back to went with its DOM.
   */
  readonly editRef: RefObject<HTMLButtonElement | null>;
  readonly t: TFunction;
}

/** The Layer order row, as `LayerOrderRow` draws it. */
export interface ExportLayerOrderRow {
  readonly previous: ControlVerb;
  readonly next: ControlVerb;
  /** Where the figure stands among its layer orders; null for a place kept unread (D11). */
  readonly readout: string | null;
  readonly edit: LayerOrderRowEntry;
  readonly disabled: boolean;
  readonly note: { readonly text: string; readonly kind: 'reason' | 'status' } | null;
}

export interface ExportLayerOrderState {
  /** The Layer order dialog is open on this figure: the host dialog renders nothing until it closes. */
  readonly ordering: boolean;
  /** The figure's turn, clockwise on screen in degrees, for the painter. */
  readonly turnDeg: number;
  /** The figure is drawn in a layer order chosen in the dialog, not the kernel's own. */
  readonly chosen: boolean;
  readonly row: ExportLayerOrderRow;
  /** Load the dialog's code ahead of a press. Spawns nothing. */
  readonly prefetch: () => void;
}

export function useExportLayerOrder(options: ExportLayerOrderOptions): ExportLayerOrderState {
  const {
    surface,
    host,
    segment,
    preview,
    settings,
    style,
    name,
    byline,
    xray = false,
    setFoldCase,
    held,
    scope,
    editRef,
    t,
  } = options;
  const [ordering, setOrdering] = useState(false);
  const [stepping, setStepping] = useState(false);
  const ask = useRef<AbortController | null>(null);
  const refocus = useRef(false);
  const source = preview.source;
  const digest = source?.digest ?? null;
  const kept = useExportLayerOrders((state) => (digest ? (state.byDigest[digest] ?? null) : null));
  const chosen = kept?.chosen ?? null;

  // The dialog never outlives what its Apply would land in: the host dialog
  // closing, or its scope replaced (the command store's one slot, a new draft).
  useEffect(
    () => () => {
      ask.current?.abort();
      ask.current = null;
    },
    [scope]
  );
  // The cursor's worker goes with the host dialog.
  useEffect(() => () => dropExportSolutionCursor(), []);
  // Back from the dialog: focus on Edit…, which the dialog's own return
  // focus cannot reach, since the button it held went with this dialog's DOM.
  useEffect(() => {
    if (ordering || !refocus.current) return;
    refocus.current = false;
    editRef.current?.focus({ preventScroll: true });
  }, [ordering, editRef]);

  useSyncExternalStore(subscribeExportSolutionCursor, exportSolutionCursorVersion, exportSolutionCursorVersion);
  const figure: ExportCursorFigure | null =
    digest && chosen ? { digest, orderKey: chosen.key, side: settings.side === 'Back1' ? 'back' : 'front', xray } : null;
  const place = figure ? exportSolutionPlace(figure) : null;

  const none = preview.ordered === false;
  const blocker = !host
    ? t('dialogs:export.foldedFigureNeedsCp', 'Open an editable crease pattern to fold it')
    : (held ??
      (none
        ? t('panels:cpProperties.folded.layerOrderUndetermined', 'Layer order couldn’t be determined for this figure.')
        : null));
  const busy = preview.folding || stepping;
  const waiting = blocker === null && (busy || !source);
  const waitingHint = t('panels:cpProperties.folded.layerOrderWaiting', 'Its layer order is being found');

  const open = () => {
    if (blocker !== null || waiting || ordering || ask.current || !host || !source) return;
    const controller = new AbortController();
    ask.current = controller;
    const keptNow = exportLayerOrderFor(source.digest);
    void (async () => {
      let aside = false;
      try {
        const region = await host.region(segment).catch(() => null);
        if (controller.signal.aborted) return;
        const request = exportLayerOrderRequest({
          surface,
          source,
          shown: preview.scene,
          region,
          record: keptNow?.chosen?.applied.record ?? null,
          style: creaseExportPinnedStyle(style, settings),
          side: settings.side,
          turnDeg: keptNow?.turnDeg ?? 0,
          xray,
          lineStyle: host.lineStyle,
          lineWidth: host.lineWidth,
          name,
          byline,
        });
        const outcome = openLayerOrderDialog(request, { signal: controller.signal });
        // Step aside only for a dialog that opened: `busy` and `unavailable` answer at once.
        aside = isLayerOrderDialogOpen();
        if (aside) setOrdering(true);
        const answer = await outcome;
        if (controller.signal.aborted) return;
        const next = exportLayerOrderAfter(keptNow, answer);
        if (next) rememberExportLayerOrder(source.digest, next);
      } finally {
        if (ask.current === controller) ask.current = null;
        if (aside) {
          refocus.current = !controller.signal.aborted;
          setOrdering(false);
        }
      }
    })();
  };

  const stepChosen = (direction: 'next' | 'previous') => {
    if (!figure || !chosen || busy) return;
    setStepping(true);
    void stepExportSolution(
      figure,
      direction,
      async () => ({ source: chosen.applied.source, record: chosen.applied.record }),
      (applied) => {
        const next = exportLayerOrderAfter(exportLayerOrderFor(figure.digest), { kind: 'applied', applied });
        if (!next?.chosen) return null;
        rememberExportLayerOrder(figure.digest, next);
        return next.chosen.key;
      }
    ).finally(() => setStepping(false));
  };

  const ends = place ? solutionPlaceEnds(place) : null;
  const atFirstCase = preview.currentCase <= 1;
  const atLastCase = !preview.hasNext && preview.currentCase >= preview.discoveredCases;
  const previous: ControlVerb = {
    label: t('panels:diagram.pose.previousSolution', 'Previous Layer Order'),
    disabled: blocker !== null || busy || !source || (chosen ? (ends?.first ?? false) : atFirstCase),
    run: () => {
      if (chosen) stepChosen('previous');
      else if (!busy && !atFirstCase) setFoldCase(preview.currentCase - 1);
    },
  };
  const next: ControlVerb = {
    label: t('panels:diagram.pose.nextLayerOrder', 'Next Layer Order'),
    disabled: blocker !== null || busy || !source || (chosen ? (ends?.last ?? false) : atLastCase),
    run: () => {
      if (chosen) stepChosen('next');
      else if (!busy && !atLastCase) setFoldCase(preview.currentCase + 1);
    },
  };

  const readout = chosen
    ? place
      ? solutionPlaceCount(place, t)
      : null
    : preview.ordered === null
      ? null
      : layerOrderCount(
          preview.currentCase,
          none
            ? { discovered: 0, hasNext: false, none: true }
            : { discovered: preview.discoveredCases, hasNext: preview.hasNext },
          t
        );

  const shownChosen = chosen !== null && preview.order !== null && !preview.orderRefused;
  const note: ExportLayerOrderRow['note'] =
    blocker !== null
      ? { text: blocker, kind: 'reason' }
      : preview.orderRefused
        ? { text: t('errors:cp.layerOrderNotFolded', 'Layer order couldn’t fold these creases in this order.'), kind: 'reason' }
        : chosen
          ? chosen.applied.record.constraints.length === 0
            ? { text: t('panels:diagram.layerOrder.chosenOrder', 'Chosen order'), kind: 'status' }
            : {
                text: t('panels:diagram.layerOrder.constraints', {
                  count: chosen.applied.record.constraints.length,
                  defaultValue_one: '{{count}} constraint',
                  defaultValue_other: '{{count}} constraints',
                }),
                kind: 'status',
              }
          : null;

  return {
    ordering,
    turnDeg: kept?.turnDeg ?? 0,
    chosen: shownChosen,
    row: {
      previous,
      next,
      readout,
      edit: {
        label: t('panels:diagram.layerOrder.edit', 'Edit…'),
        name: t('panels:diagram.layerOrder.editName', 'Edit Layer Order…'),
        disabled: blocker !== null,
        waiting,
        hint: blocker ?? (waiting ? waitingHint : undefined),
        run: open,
      },
      disabled: blocker !== null,
      note,
    },
    prefetch: prefetchLayerOrderDialog,
  };
}
