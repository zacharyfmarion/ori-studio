import { useFoldOrderInspection } from '../../../fold/orders/useFoldOrderInspection';
import { foldRegionTint } from '../../../fold/canvas/foldPaneOverlays';
import { useFoldImportOrderUi } from '../../../fold/orders/foldImportOrderUi';
import { foldOrderChoiceKey } from '../../../fold/io/foldImportFlow';
import { FoldImportOrderChooser } from '../orders/FoldImportOrderChooser';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { CpSurfaceControls } from '../../../cp-workspace/surface/useCpSurface';
import { ToolOptionLayer } from '../../../cp-workspace/toolOptions/ToolOptionLayer';
import type { CpToolOptionWindow } from '../../../cp-workspace/toolOptions/toolOptionWindow';
import { altModifierLabel } from '../../../lib/platform';
import { useFoldPaperStyle } from '../../../fold/sequence/useFoldPaperStyle';
import { useIsCoarsePointerSurface } from '../../../platform/pointerSurface';
import { useIsPhoneLayout } from '../../../platform/phoneLayout';
import { useSettingsStore } from '../../../store/settingsStore';
import { useThemeStore } from '../../../store/themeStore';
import { useFoldSession } from '../../../fold/session/useFoldSession';
import { foldTools, useFoldTools } from '../../../fold/tools/foldToolState';
import { foldToolWindow } from '../../../fold/tools/foldToolWindow';
import { useFoldShortcutLabels } from '../../../fold/tools/useFoldShortcutLabels';
import { foldToolKindControl, registerFoldCanvasVerbs } from '../../../fold/canvas/foldCanvasCommands';
import { registerFoldKindControl } from '../../../fold/sequence/foldCommands';
import {
  chooserBounds,
  chooserKeys,
  foldAlongOverlay,
  foldChoiceNote,
  foldCrimpWindowView,
  foldFreeLineStart,
  foldLocatedLines,
  foldReverseWindowView,
  foldShownPicks,
  foldSinkWindowView,
  foldTuckWindowView,
  foldVertexWindowView,
  foldWindowPreview,
  takenLinesPending,
} from '../../../fold/canvas/foldCanvasModel';
import { useFoldFanMarks } from '../../../fold/canvas/vertex/useFoldFanMarks';
import { useFoldPetalMarks } from '../../../fold/canvas/vertex/useFoldPetalMarks';
import { useFoldSquashMarks } from '../../../fold/canvas/vertex/useFoldSquashMarks';
import { useFoldSwivelMarks } from '../../../fold/canvas/vertex/useFoldSwivelMarks';
import { useFoldVertexMarks } from '../../../fold/canvas/vertex/useFoldVertexMarks';
import { swivelMeetingMarks } from '../../../fold/canvas/vertex/swivelMeeting';
import { foldHoverEcho, foldPaneOverlay, joinFills } from '../../../fold/canvas/foldPaneOverlays';
import { setFoldPaneDisplay, useFoldPaneDisplay } from '../../../fold/canvas/foldPaneDisplay';
import type { FoldHit, FoldPaneId, FoldPick } from '../../../fold/canvas/foldPicking';
import { useFoldPhonePane } from '../../../fold/canvas/foldPhonePane';
import { useFoldCanvasInks } from '../../../fold/canvas/useFoldCanvasInks';
import { restingSpread, useFoldCanvasPaint } from '../../../fold/canvas/useFoldCanvasPaint';
import { useFoldCreasePatternStrokes } from '../../../fold/canvas/useFoldCreasePatternStrokes';
import { useFoldCreasePatternView } from '../../../fold/canvas/useFoldCreasePatternView';
import { foldCanvasChoice, marksMadeAt, useFoldCanvasVerbs } from '../../../fold/canvas/useFoldCanvasVerbs';
import { useFoldCanvasShortcuts } from '../../../fold/canvas/useFoldCanvasShortcuts';
import { useFoldReadOnly } from '../../../fold/canvas/useFoldRailGroups';
import { useFoldPaneSpread } from '../../../fold/canvas/useFoldPaneSpread';
import { useFoldStateView } from '../../../fold/canvas/useFoldStateView';
import { useFoldToolPreview } from '../../../fold/canvas/useFoldToolPreview';
import { foldShownPreview } from '../../../fold/canvas/foldHeldPreview';
import { useFoldStepLetters } from '../../../fold/canvas/useFoldStepLetters';
import { useFoldWindowInset } from '../../../fold/canvas/useFoldWindowInset';
import { useFoldWovenInterval } from '../../../fold/canvas/useFoldWovenInterval';
import { useFoldRepeatCreases } from '../../../fold/repeat/useFoldRepeatCreases';
import { useFoldRepeatMarks } from '../../../fold/repeat/useFoldRepeatMarks';
import { isSequenceTool } from '../../../fold/tools/foldToolCatalog';
import { useWorkspaceStore } from '../../../store/workspaceStore';
import { shownFoldSequence } from '../../../store/workspaceStore/foldState';
import { FoldToolWindow } from '../FoldToolWindow';
import { FoldActionLayer } from './FoldActionLayer';
import { FoldPane } from './FoldPane';
import { useFoldPhoneBarGroups } from './useFoldPhoneBarGroups';
import { FoldViewportToolbar } from './FoldViewportToolbar';
import { useFoldStepSpread, useFoldStepSpreadShown } from '../../../fold/sequence/useFoldStepSpread';
import styles from './FoldCanvas.module.css';

/**
 * The Fold workspace's canvas (plan D11, D13, D14): the folded form on the
 * left, painted through the shared paper painter in the user's paper style,
 * and its crease pattern on the right, drawn as Edit's canvas draws one
 * (`useFoldCreasePatternStrokes`) — each a `FoldPane` on `useCpSurface`;
 * the tool window over the viewport's corner; the viewport
 * toolbar along the bottom. Moving to another step shows it, with no
 * transition. The tool rail
 * is the panel's, down its whole side (`FoldWorkspaceRail`). A crease pattern
 * dropped on it is the panel's to import (`useFoldDrop`, in `FoldPanel`). On
 * a phone, one pane at a time: the starred tools and the pane switch on the
 * bar (`useFoldPhoneBarGroups`), the rest in the header's sheet; the tool window
 * starts as its title bar, so the paper stays in view while points are
 * picked (`FoldToolWindow`).
 *
 * A composition site: what the tools do is `fold/tools` (the state, the
 * registry, the step builder) and `fold/canvas` (picking, the pipeline to the
 * session, the verbs, the keys); this mounts them and hands each surface its
 * part. `sendToEdit` is the toolbar's slot for that verb, which the panel
 * supplies.
 */
export function FoldCanvas({ sendToEdit }: { sendToEdit?: ReactNode }) {
  const { t } = useTranslation();
  // The composition site holds the engine: while the canvas is up, the worker runs and the sequence replays.
  const session = useFoldSession();
  const view = useFoldStateView();
  const tools = foldTools();
  const toolState = useFoldTools((state) => state);
  // While a new seed's step is on its way, the last answer stays on show: nothing goes and comes back under a click.
  const preview = foldShownPreview(useFoldToolPreview(session, view, toolState));
  // The folded form's layers spread as the step on screen says, its switch on
  // the bar — at rest: flat once a tool picks, or locates a fold, and while a
  // sequence tool shows another state than the step's. Spread, the paper is
  // picked, hovered and lettered where it is drawn.
  const picking = toolState.picks.length > 0 || isSequenceTool(toolState.tool);
  const stepSpread = useFoldStepSpreadShown(view.cursorId);
  const importChoice = useFoldImportOrderUi((s) => s.choosing);
  const importPreview = importChoice?.previews.get(foldOrderChoiceKey(importChoice.choice));
  const resolvingOrder = !!importChoice || preview.orderResolution?.active === true;
  const orderScene = importChoice ? (importPreview?.status === 'ready' ? importPreview.scene : importChoice.displayed ?? null) : resolvingOrder ? preview.landed?.scene ?? null : null;
  const inspection = useFoldOrderInspection(importChoice ? `import:${importChoice.opened.import}` : resolvingOrder ? preview.orderResolution?.key ?? null : null, orderScene);
  const importSpread = useFoldImportOrderUi((s) => s.spread);
  const shownSpread = importChoice && view.cursorId === null ? importSpread : resolvingOrder ? stepSpread : restingSpread(stepSpread, preview, picking);
  const paneSpread = useFoldPaneSpread(view, shownSpread);
  const { verbs, queued } = useFoldCanvasVerbs(session, tools, view, preview, paneSpread.index);
  useEffect(() => registerFoldCanvasVerbs(verbs), [verbs]);
  // The menus' and the step cards' Valley / Mountain / Precrease arm the tools' fold.
  useEffect(() => registerFoldKindControl(foldToolKindControl(tools)), [tools]);

  const phone = useIsPhoneLayout();
  const phoneGroups = useFoldPhoneBarGroups(phone);
  const coarse = useIsCoarsePointerSurface();
  const phonePane = useFoldPhonePane();
  const readOnly = useFoldReadOnly();
  // The sequence's own paper style (its Paper tab's), the Diagram style for a new sequence.
  const style = useFoldPaperStyle();
  const wheelGesture = useSettingsStore((state) => state.cpWheelGesture);
  const snapRadius = useSettingsStore((state) => state.cpSnapRadius);
  const { keyLabel } = useFoldShortcutLabels();
  const theme = useThemeStore((state) => state.currentTheme);
  const [viewport, setViewport] = useState<HTMLDivElement | null>(null);
  const [toolWindowFrame, setToolWindowFrame] = useState<HTMLElement | null>(null);
  // A phone's tool window spans the pane: the paper is fitted above it.
  const inset = useFoldWindowInset(viewport, toolWindowFrame, phone);
  const inks = useFoldCanvasInks(viewport, theme.name);
  // Shared with the step strip, whose cards are the folded pane's pictures.
  const display = useFoldPaneDisplay();
  const [zoomPercent, setZoomPercent] = useState(100);

  // --- The camera verbs of both panes: the toolbar and the zoom keys drive them together.
  const folded = useRef<CpSurfaceControls | null>(null);
  const creases = useRef<CpSurfaceControls | null>(null);
  const eachPane = useCallback((run: (controls: CpSurfaceControls) => void) => {
    for (const controls of [folded.current, creases.current]) if (controls) run(controls);
  }, []);
  const zoomIn = useCallback(() => eachPane((controls) => controls.zoomIn()), [eachPane]);
  const zoomOut = useCallback(() => eachPane((controls) => controls.zoomOut()), [eachPane]);
  const fit = useCallback(() => eachPane((controls) => controls.fit()), [eachPane]);
  const setZoom = useCallback((percent: number) => eachPane((controls) => controls.setZoomPercent(percent)), [eachPane]);
  const camera = useMemo(
    () => ({ zoomIn, zoomOut, fit, actualSize: () => setZoom(100), setZoomPercent: setZoom }),
    [zoomIn, zoomOut, fit, setZoom]
  );
  useFoldCanvasShortcuts(camera);

  // --- What each pane paints, and frames: the camera fits on a new sequence or sheet; on a new step it
  // keeps the view it had while the step still shows there, and fits again where the step would
  // arrive off screen — a view the user panned, zoomed or turned included (`useCpSurface`).
  const summary = view.summary;
  const spread = useFoldStepSpread(view.cursorId, 'canvas_bar');
  // A rabbit ear's given creases, and the regions its paper that stays is picked among, from its clicks;
  // a petal fold's hinge, and the flaps below it the pointer finds.
  const fanMarks = useFoldFanMarks(view.index, toolState);
  const petalMarks = useFoldPetalMarks(session, view.index, toolState);
  // A swivel's edges that can swing, then the lines its edge lands on, and the swivel under the pointer.
  const swivelMarks = useFoldSwivelMarks(view.index, toolState, preview.vertex?.reach ?? null, inks);
  // Repeat's preview: the creases it adds, where its folded result puts them.
  const repeatCreases = useFoldRepeatCreases(toolState.tool === 'repeat' ? preview.landed : null);
  // A swivel by its valley and mountain's lines in their pens, until its fold draws its own; a squash's drawn hinge.
  const takenLines = useMemo(
    () => takenLinesPending(view.index, toolState, preview.locatedLine ?? null),
    [view.index, toolState, preview.locatedLine]
  );
  // A squash's flap under the pointer, before it is clicked.
  const squashMarks = useFoldSquashMarks(session, view.index, toolState);
  const pending = fanMarks?.pending ?? petalMarks.pending ?? swivelMarks.pending ?? takenLines ?? repeatCreases;
  const regions = fanMarks?.regions ?? petalMarks.regions ?? squashMarks.regions;
  const paint = useFoldCanvasPaint(view, preview, display, toolState.hoveredFlap, inks, shownSpread, pending, orderScene);
  const componentPairs = importChoice?.opened.components[importChoice.component]?.pairs ?? [];
  const orderTint = inks && resolvingOrder && !shownSpread ? foldRegionTint({
    polygons: [inspection.rows.filter((row) => inspection.selected === null ? row.changed || componentPairs.some(([a, b]) => row.faces_top_to_bottom.includes(a) && row.faces_top_to_bottom.includes(b)) : row.index === inspection.selected).map((row) => row.polygon)],
    picked: 0, at: () => null,
  }, null, inks.accent) : null;
  const foldedTint = resolvingOrder ? orderTint : joinFills(paint.folded.tint, swivelMarks.tint);
  // The CP's own viewing side, independent of the folded form's Turn over step.
  const cpView = useFoldCreasePatternView(summary?.sheet, style);
  const cpStrokes = useFoldCreasePatternStrokes(paint.creasePattern.lines, style, cpView.side);
  const sequenceId = useWorkspaceStore((state) => shownFoldSequence(state)?.document.id ?? 'blank');
  const sheetKey = summary ? summary.sheet.map(([x, y]) => `${x},${y}`).join(';') : 'none';
  const framingKey = `${sequenceId}:${sheetKey}`;

  // --- The tool's feedback on each pane: a crimp's first line while its
  // second is located; a vertex fold's vertex and choices on the folded one
  // (its creases are paper, `useFoldCanvasPaint`).
  const freeFrom = foldFreeLineStart(toolState);
  const crimpLines = preview.crimp?.lines ?? preview.pleatLines ?? null;
  const located = useMemo(
    () => foldLocatedLines(toolState.tool, preview.action !== null, crimpLines),
    [toolState.tool, preview.action, crimpLines]
  );
  const previewMarks = useFoldVertexMarks(view.index, preview.vertex, toolState.compound.squashTarget, inks?.overlay ?? null);
  // Repeat's axes on both panes, the one under the pointer previewed, and a line drawn that is none.
  const repeatMarks = useFoldRepeatMarks(view.index, view.summary?.sheet ?? null, preview.repeat, inks?.overlay ?? null);
  const drawnMarks = repeatMarks.overlay;
  // Where a swivel's valley meets a folded edge, while its mountain is located from there.
  const meetingMarks = useMemo(
    () => swivelMeetingMarks(paneSpread.index, toolState, inks?.overlay ?? null),
    [paneSpread.index, toolState, inks]
  );
  const vertexMarks = drawnMarks?.folded ?? previewMarks ?? swivelMarks.marks ?? meetingMarks;
  const swivelOffered = swivelMarks.offered;
  // A partial precrease's line on each pane, and its points along it.
  const along = useMemo(
    () => foldAlongOverlay(preview.extent, toolState.extent, toolState.extentPicks),
    [preview.extent, toolState.extent, toolState.extentPicks]
  );
  // A swivel's pivot once its vertex is drawn in its place.
  const shownPicks = foldShownPicks(toolState, preview, swivelMarks.hovered !== null);
  // The point a click on the folded pane would take, marked on the crease pattern before the click.
  const [foldedEcho, setFoldedEcho] = useState<FoldPick | null>(null);
  const overlayFor = useCallback(
    (pane: FoldPaneId, echo: FoldPick | null = null) => (hovered: FoldHit | null) =>
      inks
        ? foldPaneOverlay({
            pane,
            scene: view.scene,
            picks: shownPicks,
            hovered: hovered?.pane === pane ? hovered : null,
            echo,
            freeFrom,
            located,
            marks: view.marks,
            inks: inks.overlay,
            tool: pane === 'folded' ? vertexMarks : (drawnMarks?.creasePattern ?? null),
            spread: paneSpread.map,
            along: along?.[pane] ?? null,
            regions: regions?.[pane] ?? null,
            offered: swivelOffered?.[pane] ?? null,
          })
        : { points: null, strokes: null },
    [inks, view.scene, view.marks, shownPicks, freeFrom, located, vertexMarks, drawnMarks, paneSpread.map, along, regions, swivelOffered]
  );
  const foldedOverlay = useMemo(() => overlayFor('folded'), [overlayFor]);
  const creaseOverlay = useMemo(() => overlayFor('crease-pattern', foldedEcho), [overlayFor, foldedEcho]);

  // --- The letters the step's sentence names its references by, on the folded pane.
  const letters = useFoldStepLetters(session, view, preview, picking, paneSpread.map);

  // --- The tool window, and the root chooser over the folded pane.
  const sequence = useWorkspaceStore((state) => shownFoldSequence(state)?.document ?? null);
  const marksHere = marksMadeAt(sequence, session.cursorId).length;
  const woven = useFoldWovenInterval(preview.section);
  // The folded pane's hover: a woven section's stack, a petal fold's flap, a
  // swivel's line; the crease pattern's, the flap and the line.
  const { onHover: onWovenHover } = woven;
  const { onHover: onPetalHover } = petalMarks;
  const { onHover: onSwivelHover } = swivelMarks;
  const { onHover: onSquashHover } = squashMarks;
  const { onFoldedHover: onRepeatFoldedHover, onCreaseHover: onRepeatCreaseHover } = repeatMarks;
  const onFoldedHover = useCallback(
    (hit: FoldHit | null) => {
      onWovenHover(hit);
      onPetalHover(hit);
      onSwivelHover(hit);
      onSquashHover(hit);
      setFoldedEcho((was) => foldHoverEcho(hit, was));
      onRepeatFoldedHover(hit);
    },
    [onWovenHover, onPetalHover, onSwivelHover, onSquashHover, onRepeatFoldedHover]
  );
  const onCreaseHover = useCallback(
    (hit: FoldHit | null) => {
      onPetalHover(hit);
      onSwivelHover(hit);
      onRepeatCreaseHover(hit);
    },
    [onPetalHover, onSwivelHover, onRepeatCreaseHover]
  );
  const reverseView = foldReverseWindowView(toolState, preview);
  const crimpView = foldCrimpWindowView(toolState, preview);
  const tuckView = foldTuckWindowView(toolState, preview);
  const vertexView = foldVertexWindowView(toolState, preview);
  const sinkView = foldSinkWindowView(toolState, preview, view.scene?.view.flipped ?? false);
  const windowModel = foldToolWindow(
    t,
    {
      tool: toolState.tool,
      lineMode: toolState.lineMode,
      freeLineSnap: toolState.freeLineSnap,
      readOnly,
      picks: toolState.picks.length,
      preview: foldWindowPreview(toolState, preview, woven.interval, queued),
      divide: { settings: toolState.divide, marks: marksHere },
      ...(reverseView ? { reverse: reverseView } : {}),
      secondLineMode: toolState.secondLineMode,
      ...(crimpView ? { crimp: crimpView } : {}),
      ...(tuckView ? { tuck: tuckView } : {}),
      ...(vertexView ? { vertex: vertexView } : {}),
      ...(sinkView ? { sink: sinkView } : {}),
      extent: { mode: toolState.extent, picked: toolState.extentPicks.length },
      rotate: { rotation: toolState.rotation },
      ...(preview.unfold ? { unfold: preview.unfold.view } : {}),
      ...(preview.repeat ? { repeat: preview.repeat.view } : {}),
    },
    {
      ...verbs,
      setDivide: tools.setDivide,
      otherKind: verbs.setReverseKind,
      tuckTarget: verbs.tuckTarget,
      setRotation: tools.setRotation,
      ...(preview.unfold ? { unfold: preview.unfold.verbs } : {}),
      ...(preview.repeat ? { repeat: preview.repeat.verbs } : {}),
    },
    { coarse, alt: altModifierLabel(), keyLabel }
  );
  // The chooser over the folded pane: the deepest choice with more than one answer.
  const choice = foldCanvasChoice(preview, toolState);
  const bounds = chooserBounds(preview, view.scene);
  const chooser: CpToolOptionWindow | null =
    choice && bounds && !resolvingOrder
      ? {
          bounds,
          index: choice.index,
          count: choice.count,
          note: foldChoiceNote(t, choice.kind, chooserKeys(keyLabel, coarse)),
          onStep: (delta) => verbs.stepChoice(delta),
          onApply: () => verbs.commit(),
          onCancel: () => verbs.cancel(),
        }
      : null;

  const showFolded = !phone || phonePane === 'folded';
  const showCreases = !phone || phonePane === 'crease-pattern';
  const paneProps = {
    style,
    framingKey,
    inset,
    wheelGesture,
    snapRadius,
    inkKey: theme.name,
    onPick: resolvingOrder ? () => {} : verbs.pick,
  };

  return (
    <div className={styles.root} data-fold-canvas="">
      <div className={styles.viewport} ref={setViewport}>
        <div className={styles.panes} data-split={showFolded && showCreases ? '' : undefined}>
          {showFolded && (
            <FoldPane
              ref={folded}
              pane="folded"
              scene={paint.folded.scene}
              ink={paint.folded.ink}
              tint={foldedTint}
              offset={paint.folded.offset}
              contentBounds={paint.folded.contentBounds}
              keepInViewKey={paint.folded.keepInView}
              keepInViewBounds={paint.folded.formBounds}
              hitTest={(at, radii) => verbs.hitTest('folded', at, radii)}
              overlay={resolvingOrder ? () => ({ points: null, strokes: null }) : foldedOverlay}
              onHover={onFoldedHover}
              onZoomPercentChange={setZoomPercent}
              layers={(camera) => (
                <>
                  {inks && (
                    <FoldActionLayer
                      action={resolvingOrder ? null : preview.action}
                      letters={letters}
                      view={camera}
                      style={style}
                      outline={view.scene?.subfaces.flatMap((cell) => cell.polygon) ?? []}
                      ground={inks.ground}
                    />
                  )}
                  {/* A phone's pane is narrow and the tool window covers its bottom: the chooser stays in view. */}
                  <ToolOptionLayer
                    option={chooser}
                    view={camera}
                    keepInView={phone ? { coveredBottom: inset?.bottom ?? 0 } : undefined}
                  />
                </>
              )}
              ariaLabel={t(
                'panels:fold.canvas.foldedLabel',
                'The folded form. Click its points and creases to locate a fold; drag to pan, scroll to zoom.'
              )}
              {...paneProps}
            />
          )}
          {showCreases && (
            <FoldPane
              ref={creases}
              pane="crease-pattern"
              scene={null}
              creases={cpStrokes}
              sheetFill={cpView.sheetFill}
              modelToUser={cpView.modelToUser}
              contentBounds={paint.creasePattern.contentBounds}
              keepInViewKey={paint.creasePattern.keepInView}
              hitTest={(at, radii) => verbs.hitTest('crease-pattern', at, radii)}
              overlay={creaseOverlay}
              onHover={onCreaseHover}
              onZoomPercentChange={showFolded ? undefined : setZoomPercent}
              ariaLabel={cpView.side === 'back' ? t(
                'panels:fold.canvas.creasePatternBackLabel',
                'The crease pattern so far, back up. Mountain and valley creases are reversed. Click its points and creases to locate a fold.'
              ) : t(
                'panels:fold.canvas.creasePatternLabel',
                'The crease pattern so far, front up. Click its points and creases to locate a fold.'
              )}
              {...paneProps}
            />
          )}
        </div>
        <FoldViewportToolbar
          zoomPercent={zoomPercent}
          camera={camera}
          display={display}
          onDisplay={setFoldPaneDisplay}
          cpSide={cpView.side}
          onTurnCpOver={cpView.turnOver}
          spread={spread?.toggle ?? null}
          phoneGroups={phoneGroups}
          sendToEdit={sendToEdit}
        />
      </div>
      {importChoice ? <FoldImportOrderChooser container={viewport} inspection={inspection} onFrame={setToolWindowFrame} /> : <FoldToolWindow inspection={inspection} resolution={preview.orderResolution} acceptOrder={verbs.acceptOrder} orderReady={!!preview.step && !!preview.landed && !preview.landing && !preview.refused && !session.readOnly} container={viewport} model={windowModel} tool={toolState.tool} keyLabel={keyLabel} onFrame={setToolWindowFrame} />}
    </div>
  );
}
