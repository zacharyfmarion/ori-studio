/**
 * The Export crease pattern dialog's and the Share modal's folded figure with
 * its layers spread (`implementation-plans/spread-and-layer-order-in-edit-export-share.md`,
 * §2 and "Preview behaviour"): the spread setting, settled into the picture the
 * page paints (`CreaseExportContent.foldedFigureSpread`).
 *
 * - **Prepared once per fold.** A Default spread holds one solve lease on the
 *   fold the preview shows (`prepareConnected`, priority 1), by its paper
 *   scene's identity: a new fold — a side, a layer order — is a new lease, and
 *   nothing else is.
 * - **Captured when a setting commits.** The setting is the dialog's committed
 *   one; a slider or pad mid-drag changes only the rows, so the last settled
 *   picture stays up until the gesture ends, and one capture runs then
 *   (`settledSpreadPicture`). Affine and Depth need no capture: they are
 *   their picture at once.
 * - **Colours repaint.** A scene is painted in the colours the page pins; only
 *   a bitmap holds its colours, and a colour edit draws that bitmap again from
 *   the scene it kept, with no new solve or capture.
 * - **Busy, not blank.** While a solve, a capture or a bitmap is being made,
 *   the last settled picture stays, and `busy` dims it (aria-busy). No status
 *   text.
 * - **Failures turn it off.** A spread that cannot be prepared, solved or
 *   drawn turns the setting off (`turnOff`), and `failed` says so beside the
 *   switch until it is turned on again, so the preview and the file agree.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import type { PreparedConnectedSpread } from '../../layer-spread/connectedScene';
import { prepareConnected } from '../../layer-spread/prepareConnected';
import {
  rasterSpreadScene,
  settledSpreadPicture,
  type SettledSpreadPicture,
  type SpreadRasterPens,
} from '../../layer-spread/settledSpreadPicture';
import {
  creaseExportSpreadFrame,
  creaseExportSpreadPicture,
  creaseExportSpreadRasterMm,
  creaseExportSpreadScene,
  type CreaseExportSpreadFrame,
  type CreaseExportSpreadPicture,
} from '../../lib/creaseExportSpread';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import type { LayerSpreadOptions } from '../folded/foldedLayerSpread';
import type { FoldedFigurePreview } from '../folded/useFoldedFigurePreview';

export interface ExportFoldedSpreadOptions {
  /** Whether the figure is drawn: folding is on, and this pattern folds. */
  readonly enabled: boolean;
  /** The fold the preview shows: its paper scene, and whether it found a layer order. */
  readonly preview: Pick<FoldedFigurePreview, 'scene' | 'ordered'>;
  /** The spread setting, committed: the dialog's, null for none. */
  readonly setting: LayerSpreadOptions | null;
  /** Turn the setting off: its layers could not be spread. */
  readonly turnOff: () => void;
  /** The figure's turn on the page, clockwise in degrees (the Layer order dialog's Rotate). */
  readonly turnDeg: number;
  /** The style the figure is painted in, its colours pinned (`creaseExportPaperStyle`): what a bitmap is drawn in. */
  readonly style: PaperStyle;
}

export interface ExportFoldedSpread {
  /** What the page paints for the figure: its spread picture, or null to draw it unspread. */
  readonly picture: CreaseExportSpreadPicture | null;
  /** A solve, a capture or a bitmap is being made: the preview keeps its last picture, dimmed. */
  readonly busy: boolean;
  /** Whether this fold has layers to spread: a flat fold with a layer order. */
  readonly spreadable: boolean;
  /** The last spread could not be spread, and was turned off. */
  readonly failed: boolean;
}

/** A settled Default spread, with what it was settled from, so a stale one is never shown as current. */
interface Captured {
  readonly scene: OristudioCpFoldedPaperScene;
  readonly spread: LayerSpreadOptions;
  readonly frame: CreaseExportSpreadFrame;
  /** The style a bitmap was drawn in; a scene's is the page's. */
  readonly style: PaperStyle;
  readonly settled: Exclude<SettledSpreadPicture, { kind: 'flat' }>;
  readonly picture: CreaseExportSpreadPicture;
}

/** The solve of one fold: its heights, or none when it failed. */
interface Solve {
  readonly scene: OristudioCpFoldedPaperScene;
  readonly prepared: PreparedConnectedSpread | null;
}

/** A bitmap's pens: the figure's style read as the flat figure's, at the size the page draws it. */
function rasterPens(style: PaperStyle, frame: CreaseExportSpreadFrame): SpreadRasterPens {
  return { style, policy: 'folded-flat', mm: (scene) => creaseExportSpreadRasterMm(frame.flat, scene.bounds) };
}

export function useExportFoldedSpread(options: ExportFoldedSpreadOptions): ExportFoldedSpread {
  const { enabled, preview, setting, turnOff, turnDeg, style } = options;
  const scene = enabled ? preview.scene : null;
  const spreadable = scene !== null && scene.faces.length > 0 && preview.ordered !== false;
  const spread = spreadable ? setting : null;
  const connected = spread?.kind === 'connected';
  const frame = useMemo(() => (scene ? creaseExportSpreadFrame(scene, turnDeg) : null), [scene, turnDeg]);

  // Read when a capture starts and when a failure lands, not followed: a new
  // style redraws a bitmap below, and a new caller's arrow re-runs nothing.
  const styleRef = useRef(style);
  const turnOffRef = useRef(turnOff);
  useEffect(() => {
    styleRef.current = style;
    turnOffRef.current = turnOff;
  }, [style, turnOff]);

  // A spread that could not be spread turns itself off, and says so until it
  // is turned on again. The clearing is declared first, so a setting that
  // fails as it is made still says so.
  const [failedOn, setFailedOn] = useState<OristudioCpFoldedPaperScene | null>(null);
  useEffect(() => {
    if (setting) setFailedOn(null);
  }, [setting]);
  const fail = useCallback((on: OristudioCpFoldedPaperScene) => {
    setFailedOn(on);
    turnOffRef.current();
  }, []);

  // The solve: one lease per fold, while it is spread by Default.
  const [solve, setSolve] = useState<Solve | null>(null);
  useEffect(() => {
    if (!scene || !connected) return undefined;
    // A solve that failed is tried again; one that landed stays good for its fold.
    setSolve((last) => (last?.scene === scene && last.prepared === null ? null : last));
    const lease = prepareConnected(scene, false, 1);
    let live = true;
    lease.promise.then(
      (prepared) => {
        if (live) setSolve({ scene, prepared });
      },
      () => {
        if (!live) return;
        setSolve({ scene, prepared: null });
        fail(scene);
      }
    );
    return () => {
      live = false;
      lease.release();
    };
  }, [scene, connected, fail]);
  const prepared = solve?.scene === scene ? solve.prepared : null;

  // Affine and Depth: their picture at once, every layer kept.
  const immediate = useMemo((): { picture: CreaseExportSpreadPicture | null } | null => {
    if (!scene || !frame || !spread || spread.kind === 'connected') return null;
    try {
      return {
        picture: creaseExportSpreadPicture(
          { kind: 'scene', scene: creaseExportSpreadScene(scene, spread, frame, null) },
          spread,
          frame
        ),
      };
    } catch {
      return { picture: null };
    }
  }, [scene, frame, spread]);
  useEffect(() => {
    if (scene && immediate && immediate.picture === null) fail(scene);
  }, [scene, immediate, fail]);

  // Default: one capture per committed setting, fold and frame.
  const [captured, setCaptured] = useState<Captured | null>(null);
  useEffect(() => {
    if (!scene || !frame || !spread || spread.kind !== 'connected' || !prepared) return undefined;
    const controller = new AbortController();
    const drawn = styleRef.current;
    settledSpreadPicture(scene, spread, {
      prepared,
      live: (solution) => creaseExportSpreadScene(scene, spread, frame, solution),
      raster: rasterPens(drawn, frame),
      signal: controller.signal,
    }).then(
      (settled) => {
        const picture = creaseExportSpreadPicture(settled, spread, frame);
        if (settled.kind === 'flat' || !picture) fail(scene);
        else setCaptured({ scene, spread, frame, style: drawn, settled, picture });
      },
      // Aborted: a newer setting, fold or frame took its place.
      () => {}
    );
    return () => controller.abort();
  }, [scene, frame, spread, prepared, fail]);
  const capturedNow =
    captured && captured.scene === scene && captured.spread === spread && captured.frame === frame ? captured : null;

  // A bitmap drawn again in a new style, from the scene it kept: no solve, no capture.
  const [redrawing, setRedrawing] = useState(false);
  useEffect(() => {
    if (!capturedNow || capturedNow.settled.kind !== 'raster' || capturedNow.style === style) return undefined;
    const controller = new AbortController();
    const kept = capturedNow;
    const unresolved = capturedNow.settled.scene;
    setRedrawing(true);
    rasterSpreadScene(unresolved, rasterPens(style, kept.frame), controller.signal).then(
      (settled) => {
        setRedrawing(false);
        const picture = creaseExportSpreadPicture(settled, kept.spread, kept.frame);
        if (picture) setCaptured({ ...kept, style, settled, picture });
      },
      () => {
        if (controller.signal.aborted) return;
        setRedrawing(false);
        fail(kept.scene);
      }
    );
    return () => {
      controller.abort();
      setRedrawing(false);
    };
  }, [capturedNow, style, fail]);

  // What the setting settled to now: null for none, undefined while it settles.
  const current: CreaseExportSpreadPicture | null | undefined = !spread
    ? null
    : spread.kind !== 'connected'
      ? (immediate?.picture ?? null)
      : (capturedNow?.picture ?? undefined);

  // The last picture settled, shown while the next is made.
  const [lastSettled, setLastSettled] = useState<CreaseExportSpreadPicture | null>(null);
  useEffect(() => {
    if (current !== undefined) setLastSettled(current);
  }, [current]);

  return {
    picture: current !== undefined ? current : lastSettled,
    busy: current === undefined || redrawing,
    spreadable,
    failed: failedOn !== null && failedOn === scene,
  };
}
