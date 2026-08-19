import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { TransformComponent, TransformWrapper } from 'react-zoom-pan-pinch';
import { clientPointToDesignWorld } from '../lib/designViewport';
import { hasPassedDragThreshold } from '../lib/pointerGesture';
import { type Point } from '../lib/geometry';
import { reflectPointAcrossSymmetryAxis, snapPointToSymmetryAxis } from '../lib/symmetryGeometry';
import { setActiveShortcutViewportSurface } from '../keyboard/shortcutRuntime';
import { useEventCallback } from '../hooks/useEventCallback';
import {
  useViewportSurface,
  VIEWPORT_PINCH_ZOOM,
  VIEWPORT_WHEEL_ZOOM,
} from '../hooks/useViewportSurface';
import { BpNameEditor } from '../components/panels/BpNameEditor';
import { isViewportInteractiveTarget } from '../components/panels/ViewportToolbar';
import {
  applyTreeChromeScale,
  applyTreeEdgeLabel,
  applyTreeGhost,
  applyTreeScenePositions,
  collectAllTreeSceneTargets,
  collectTreeChromeTargets,
  type TreeChromeTarget,
  type TreeGhostGeometry,
  type TreeSceneTarget,
} from './sceneDom';
import { startTreeDrag, type TreeDragSession } from './dragController';
import { edgeLengthRepositions, leafLocationAt } from './dragRule';
import { subtreeIds, treeTopology } from './model';
import { clampLength } from './lengths';
import { SYMMETRY_LANE_PX, TreeScene } from './TreeScene';
import { TreeEditorToolbar } from './TreeEditorToolbar';
import { TreeEdgeLengthEditor } from './TreeEdgeLengthEditor';
import { selectedEdge as findSelectedEdge, type TreeEditorHost } from './host';

/** SVG units per screen pixel at a whole-percent zoom, floored so it stays sane. */
function cameraScale(zoomPercent: number): number {
  return Math.max(0.02, zoomPercent / 100);
}

/**
 * A tree-drawing canvas, driven entirely by its {@link TreeEditorHost}.
 *
 * Extracted from the box-pleat tree pane, which had this whole surface welded to
 * one engine: the model type, the sheet the coordinates were measured against,
 * eight store actions, a selection union, and a settings slice. None of that was
 * wrong; all of it was box-pleat. What is left here is the part that is about
 * *drawing a tree* — hit-testing, the camera, the drag preview, the mirror
 * ghost, the contextual editors — and the surface answers the rest.
 */
export function TreeEditor({ host }: { host: TreeEditorHost }) {
  const { tree, frame, lengths, copy, symmetry, classPrefix } = host;
  const svgRef = useRef<SVGSVGElement | null>(null);
  // The live drag is deliberately not React state: a pointer sample must not
  // re-render the drawing. The session writes the moving elements itself.
  const dragRef = useRef<TreeDragSession | null>(null);
  const paperDownRef = useRef<{ clientX: number; clientY: number; point: Point } | null>(null);
  // Where the ghost is drawn follows the cursor and so must not be React state.
  // Whether it exists at all changes only on selection and pointer enter/leave,
  // which is rare enough to render.
  const [ghostArmed, setGhostArmed] = useState(false);
  const ghostFrameRef = useRef<number | null>(null);
  const ghostGeometryRef = useRef<TreeGhostGeometry | null>(null);
  // Cached scene lookups, dropped whenever React redraws the canvas.
  const sceneTargetsRef = useRef<{
    chrome: TreeChromeTarget[];
    positions: TreeSceneTarget[];
  } | null>(null);
  /**
   * The canvas's box on screen, cached.
   *
   * `getBoundingClientRect` forces a layout of the whole canvas, and a gesture
   * asks for it on every pointer sample — which is a layout of a thousand
   * elements per sample, for a box that cannot have moved. The cache is dropped
   * whenever it genuinely can: React redrew the canvas, the camera moved, the
   * pane resized, or something scrolled.
   */
  const svgRectRef = useRef<DOMRect | null>(null);
  const mirrorRef = useRef<HTMLDivElement | null>(null);
  // The shortcut executor is registered before `dismissSelection` is declared,
  // so it reaches it through a ref rather than closing over it.
  const dismissSelectionRef = useRef<() => void>(() => {});
  /** Whether Escape has anything to do here — read by the shortcut executor. */
  const hasDismissableSelection = useRef<() => boolean>(() => false);
  const forgetSvgRect = useEventCallback(() => {
    svgRectRef.current = null;
  });
  const svgRect = useEventCallback((): DOMRect | null => {
    const cached = svgRectRef.current;
    if (cached) return cached;
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    svgRectRef.current = rect;
    return rect;
  });

  const selectedVertex = host.selection.vertexId;
  const selectedEdge = findSelectedEdge(host);
  // The selected nameable vertex — drives the name editor. On box-pleat only
  // leaves qualify: internal vertices are rivers, which aren't worth labeling.
  const selectedNameableVertex = useMemo(() => {
    if (selectedVertex === null) return null;
    const vertex = tree.vertices.find((v) => v.id === selectedVertex) ?? null;
    return vertex && host.isNameable(vertex) ? vertex : null;
  }, [selectedVertex, tree.vertices, host]);

  // Parent/children maps rooted at the tree root, for subtree-carrying drags.
  const topology = useMemo(() => treeTopology(tree), [tree]);

  // Vertices by id. Everything that resolves one goes through this rather than
  // scanning the list: an edge lookup inside a render over every edge is where
  // an O(n) scan quietly becomes O(n²).
  const vertexById = useMemo(
    () => new Map(tree.vertices.map((vertex) => [vertex.id, vertex] as const)),
    [tree.vertices],
  );
  /** Just the locations, which is the shape the drag rule works from. */
  const vertexLocationsById = useMemo(
    () => new Map([...vertexById].map(([id, vertex]) => [id, vertex.loc] as const)),
    [vertexById],
  );

  const subtreeOf = useCallback((id: number) => subtreeIds(topology, id), [topology]);

  /**
   * The partners a drag of these vertices would also move, and where to.
   *
   * The commit mirrors the move itself, so this exists only to show it happening
   * — without it the partner sat still through the gesture and jumped on
   * release. Written here rather than in either surface's host: which vertex
   * pairs with which is per-surface and already answered by `resolveMirrorOf`,
   * but *reflecting across the axis* is the same arithmetic on both.
   *
   * A vertex that is its own mirror, or whose partner is being dragged anyway,
   * contributes nothing: it is already in the moved set.
   */
  const mirrorPreviewFor = useCallback(
    (movedIds: readonly number[]) => {
      if (!symmetry?.enabled) return { ids: [] as number[], reflect: null };
      const moved = new Set(movedIds);
      const pairs = movedIds.flatMap((id) => {
        const partner = symmetry.resolveMirrorOf(id);
        return partner === null || partner === id || moved.has(partner)
          ? []
          : [[id, partner] as const];
      });
      if (pairs.length === 0) return { ids: [] as number[], reflect: null };
      return {
        ids: pairs.map(([, partner]) => partner),
        reflect: (updates: ReadonlyMap<number, Point>) => {
          const out = new Map<number, Point>();
          for (const [id, partner] of pairs) {
            const loc = updates.get(id);
            if (loc) out.set(partner, reflectPointAcrossSymmetryAxis(loc, symmetry.axis));
          }
          return out;
        },
      };
    },
    [symmetry],
  );
  // The vertex a canvas click attaches a new leaf to. This is exactly the
  // selected vertex — with no fallback to the root, so a tree opens inert and
  // clearing the selection disarms adding, and the hover ghost and the click
  // can't disagree about where the leaf would land.
  const addAnchorId = selectedVertex;

  const {
    containerRef,
    transformRef,
    zoomPercent,
    spacePressed,
    zoomIn,
    zoomOut,
    fitToView,
    setZoomLevel,
    onInit,
    onTransformed,
  } = useViewportSurface({
    surface: host.surface,
    // Escape means "nothing selected" here, which also disarms adding. Claimed
    // through the shortcut registry rather than a `keydown` on the container:
    // that listener only fired while focus was inside the pane, so Escape did
    // nothing the moment a name field, the toolbar or a neighbouring pane had it
    // — the focus dependence AGENTS.md forbids of any shortcut.
    onViewportShortcut: (id) => {
      if (id !== 'viewport.cancel') return false;
      // Declined when there is nothing to dismiss. This executor is registered
      // under the surface id every tree canvas shares, and the runtime is now
      // asked before anything else — so claiming Escape unconditionally meant a
      // keyboard user anywhere in the workspace (a result card, the query bar)
      // pressed Escape and was teleported into this canvas.
      if (!hasDismissableSelection.current()) return false;
      dismissSelectionRef.current();
      return true;
    },
    worldRect: frame.worldRect,
    fitKey: host.fitKey,
    fitRect: host.fitRect,
    maxFitScale: host.maxFitScale,
  });

  // Convert a target screen-pixel size into SVG units at the current zoom, so
  // dots/labels keep a constant on-screen size regardless of zoom.
  //
  // Read through a ref rather than closed over, so `chromePx` keeps one identity
  // for the life of the pane. A zoom step must not re-render the canvas: it
  // changes how thick the drawing is, not what is drawn, and rendering that was
  // costing a full redraw per wheel tick.
  const scaleRef = useRef(cameraScale(zoomPercent));
  const chromePx = useCallback((px: number) => px / scaleRef.current, []);
  // Half the visible snap band, in tree units. A tip landing inside it snaps onto
  // the axis — so this is derived from the band's *drawn* width, keeping what the
  // user sees and what the click does the same thing at every zoom.
  const symmetryAxisTolerance = SYMMETRY_LANE_PX / cameraScale(zoomPercent) / 2 / frame.unitSvg;

  const findVertex = useCallback((id: number) => vertexById.get(id), [vertexById]);

  /**
   * Where a click would put a new leaf: in the direction of the click, at the
   * length the click's *distance* quantizes to.
   *
   * The distance used to be discarded — every new leaf was one unit long and you
   * then went and edited the number. Clicking three units out now gives a flap
   * of three, which is also what makes the seeded position mean what it looks
   * like. A leaf that does not exist yet has no ceiling of its own, so only the
   * floor applies.
   */
  const newLeafLocation = useEventCallback((parent: Point, toward: Point): Point => {
    const distance = Math.hypot(toward.x - parent.x, toward.y - parent.y);
    return leafLocationAt(parent, toward, Math.max(lengths.min, lengths.quantize(distance)));
  });

  /** The edge joining a vertex to its parent — the one a drag of it resizes. */
  const parentEdgeOf = useCallback(
    (vertexId: number) => {
      const parentId = topology.parent.get(vertexId) ?? null;
      if (parentId === null) return null;
      return (
        tree.edges.find(
          (edge) =>
            (edge.vertices[0] === vertexId && edge.vertices[1] === parentId) ||
            (edge.vertices[1] === vertexId && edge.vertices[0] === parentId),
        ) ?? null
      );
    },
    [topology, tree.edges],
  );

  // Ghost preview of the leaf a click would add (and its mirror), mirroring what
  // the host's mirrored add will do: an on-axis tip is a single centred leaf;
  // otherwise it reflects onto the parent's mirror.
  //
  // Called from the pointer handler, not from render — the answer changes with
  // every sample, and re-rendering the pane for it is what used to make hovering
  // a large tree as expensive as dragging one.
  const ghostGeometryAt = useEventCallback((hoverPoint: Point): TreeGhostGeometry | null => {
    const parentId = addAnchorId;
    if (parentId === null) return null;
    const parent = findVertex(parentId);
    if (!parent) return null;
    const tip = frame.constrain(newLeafLocation(parent.loc, hoverPoint));

    // Without a mirror there is still a leaf to preview — where the click would
    // put it, and how long it would be. The ghost is about the *add*; the mirror
    // is only the second half of it.
    if (!symmetry?.enabled) {
      return {
        primary: { from: frame.toSvg(parent.loc), to: frame.toSvg(tip) },
        mirror: null,
        snapped: false,
        unresolved: false,
      };
    }

    const axis = symmetry.axis;
    const snap = snapPointToSymmetryAxis(tip, axis, symmetryAxisTolerance);
    const primaryTip = snap.point;
    let mirror: { from: Point; to: Point } | null = null;
    let unresolved = false;
    if (!snap.snapped) {
      const mirrorParentId = symmetry.resolveMirrorOf(parentId);
      const mirrorParent = mirrorParentId != null ? findVertex(mirrorParentId) : undefined;
      if (mirrorParent) {
        mirror = { from: mirrorParent.loc, to: reflectPointAcrossSymmetryAxis(primaryTip, axis) };
      } else {
        unresolved = true;
      }
    }
    return {
      primary: { from: frame.toSvg(parent.loc), to: frame.toSvg(primaryTip) },
      mirror: mirror && { from: frame.toSvg(mirror.from), to: frame.toSvg(mirror.to) },
      snapped: snap.snapped,
      unresolved,
    };
  });

  /** Where a vertex sits right now: mid-drag if one is running, else committed. */
  const svgPointOfVertex = useEventCallback((id: number): Point | undefined => {
    const loc = dragRef.current?.updates.get(id) ?? vertexLocationsById.get(id);
    return loc && frame.toSvg(loc);
  });

  // React redrew the canvas, so anything a gesture cached about it is stale.
  const onSceneRendered = useEventCallback(() => {
    sceneTargetsRef.current = null;
    svgRectRef.current = null;
  });

  /**
   * Rewrite the counter-scaled chrome for a new camera scale.
   *
   * The element lists are read once per rendered scene and reused: a zoom is a
   * burst of steps, and re-reading the markup on each one turned a zoom into
   * several passes over the whole canvas.
   */
  /**
   * Put the mirror line where the axis currently projects to, in pane pixels.
   *
   * Chrome rather than scene content, and it has to be: drawn inside the SVG it
   * was clipped to the SVG's own bounds, so panning slid its ends into view and
   * the line stopped reaching the edges of the pane. Its width is already a
   * screen-pixel constant — the snap band is a fixed number of pixels, which is
   * what `symmetryAxisTolerance` converts back into tree units — so nothing
   * about it wants to live in world space.
   */
  const publishMirrorLine = useEventCallback(() => {
    const element = mirrorRef.current;
    if (!element) return;
    const rect = svgRect();
    if (!rect || !symmetry?.enabled) {
      element.style.display = 'none';
      return;
    }
    const container = containerRef.current?.getBoundingClientRect();
    if (!container) return;
    // SVG x of the axis → a fraction of the drawn canvas → a pane offset.
    const axisSvgX = frame.toSvg({ x: symmetry.axis.loc.x, y: 0 }).x;
    const fraction = (axisSvgX - frame.worldRect.x) / frame.worldRect.width;
    element.style.display = '';
    element.style.left = `${rect.left - container.left + fraction * rect.width}px`;
  });

  const publishChromeScale = useEventCallback(() => {
    publishMirrorLine();
    const svg = svgRef.current;
    if (!svg) return;
    sceneTargetsRef.current ??= {
      chrome: collectTreeChromeTargets(svg),
      positions: collectAllTreeSceneTargets(svg),
    };
    applyTreeChromeScale(sceneTargetsRef.current.chrome, chromePx);
    // Label offsets counter-scale too, so they have to be re-placed even though
    // nothing moved.
    applyTreeScenePositions(sceneTargetsRef.current.positions, svgPointOfVertex, chromePx);
    applyTreeGhost(svg, ghostGeometryRef.current);
  });

  useEffect(() => {
    scaleRef.current = cameraScale(zoomPercent);
  }, [zoomPercent]);

  useEffect(() => {
    const container = containerRef.current;
    const observer =
      typeof ResizeObserver === 'undefined' || !container
        ? null
        : new ResizeObserver(forgetSvgRect);
    if (container) observer?.observe(container);
    window.addEventListener('scroll', forgetSvgRect, { capture: true, passive: true });
    window.addEventListener('resize', forgetSvgRect, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', forgetSvgRect, { capture: true });
      window.removeEventListener('resize', forgetSvgRect);
    };
  }, [forgetSvgRect, containerRef]);

  const onCameraTransformed = useEventCallback(
    (ref: Parameters<typeof onTransformed>[0], state: { scale: number }) => {
      // Rounded exactly as `zoomPercent` is, so the scale this writes and the
      // scale a later render reads back out of it cannot disagree.
      scaleRef.current = cameraScale(Math.round(state.scale * 100));
      forgetSvgRect();
      publishChromeScale();
      // The toolbar's readout still wants this, and rounding to whole percent
      // keeps a pan — which does not change scale — from touching React at all.
      onTransformed(ref, state);
    },
  );

  /** Show the ghost where the cursor last put it, coalesced to one frame. */
  const scheduleGhost = useEventCallback(() => {
    if (ghostFrameRef.current !== null) return;
    // See `startTreeDrag`: a scheduler that runs synchronously has already
    // cleared the slot by the time it hands back a handle, and storing it then
    // would drop every later sample.
    let ran = false;
    const handle = requestAnimationFrame(() => {
      ran = true;
      ghostFrameRef.current = null;
      const svg = svgRef.current;
      if (svg) applyTreeGhost(svg, ghostGeometryRef.current);
    });
    if (!ran) ghostFrameRef.current = handle;
  });

  const setGhost = useEventCallback((geometry: TreeGhostGeometry | null) => {
    if (geometry === null && ghostGeometryRef.current === null) return;
    ghostGeometryRef.current = geometry;
    // Arming renders the ghost's four elements; the frame below then places
    // them. Everything after that is writes.
    setGhostArmed(geometry !== null);
    scheduleGhost();
  });

  // The ghost is drawn only once armed, so its first placement has to wait for
  // that commit. Cheap enough to just re-place it after every one.
  useEffect(() => {
    const svg = svgRef.current;
    if (svg && ghostArmed) applyTreeGhost(svg, ghostGeometryRef.current);
  }, [ghostArmed]);

  // The mirror line is written, not rendered, so every commit that could move it
  // — a new tree, the toggle, a resize — has to re-place it.
  useEffect(publishMirrorLine);

  useEffect(
    () => () => {
      if (ghostFrameRef.current !== null) cancelAnimationFrame(ghostFrameRef.current);
    },
    [],
  );

  // One call → the host runs length + reposition as a single undo entry.
  const setEdgeLength = useEventCallback(async (edgeId: number, length: number) => {
    await host.setEdgeLength(
      [{ edgeId, length }],
      edgeLengthRepositions(tree, topology, edgeId, length),
    );
  });

  // Escape drops the selection and returns the keyboard to the canvas. Nothing in
  // the tree stays selected, so the contextual length/name editors close too.
  const dismissSelection = useEventCallback(() => {
    host.clearSelection();
    // Focus is only *returned* to the canvas, never taken to it: pulling it here
    // from a result card or the query bar would move the user somewhere they
    // were not.
    const container = containerRef.current;
    if (container && container.contains(document.activeElement)) container.focus();
  });

  // Assigned in an effect rather than during render: the executor is registered
  // before `dismissSelection` exists, and a render-time write to a ref is the
  // thing that makes a component unsafe to re-run.
  useEffect(() => {
    dismissSelectionRef.current = dismissSelection;
  }, [dismissSelection]);

  // The drawn selection, not the singular one: `vertexId`/`edgeId` are null for
  // a shift-click multi-select, so keying on them let Escape decline while two
  // nodes sat visibly selected, with no keyboard way to clear them.
  const selectionIsEmpty =
    host.selection.vertexId === null &&
    host.selection.edgeId === null &&
    host.selection.vertices.size === 0 &&
    host.selection.edges.size === 0;
  useEffect(() => {
    hasDismissableSelection.current = () => !selectionIsEmpty;
  }, [selectionIsEmpty]);

  const clientToTreePoint = useCallback(
    (client: Point): Point => {
      const rect = svgRect();
      if (!rect) return { x: 0, y: 0 };
      return frame.fromSvg(clientPointToDesignWorld(client, rect, frame.worldRect));
    },
    [frame, svgRect],
  );
  const eventToTreePoint = useCallback(
    (event: PointerEvent): Point => clientToTreePoint({ x: event.clientX, y: event.clientY }),
    [clientToTreePoint],
  );

  const onCanvasAddPointerDown = (event: PointerEvent<Element>) => {
    if (event.button !== 0 || spacePressed || isViewportInteractiveTarget(event.target)) {
      paperDownRef.current = null;
      return;
    }
    paperDownRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      point: frame.constrain(eventToTreePoint(event)),
    };
  };

  const onCanvasAddPointerUp = (event: PointerEvent<Element>) => {
    const down = paperDownRef.current;
    paperDownRef.current = null;
    if (!down || event.button !== 0 || spacePressed) return;
    const dragged = hasPassedDragThreshold(
      { x: down.clientX, y: down.clientY },
      { x: event.clientX, y: event.clientY },
    );
    if (dragged) return;
    // A plain click on the canvas adds a leaf to the selected vertex, pointing
    // toward the click. With nothing selected there's no anchor, so the click
    // just falls through.
    const parentId = addAnchorId;
    if (parentId === null) return;
    const parent = findVertex(parentId);
    if (!parent) return;
    const loc = frame.constrain(newLeafLocation(parent.loc, down.point));
    void host.addLeaf(parentId, loc, symmetryAxisTolerance);
  };

  const onEdgePointerDown = useEventCallback((event: PointerEvent<SVGGElement>, edgeId: number) => {
    if (event.button !== 0 || spacePressed) return;
    event.stopPropagation();
    // Clicking an edge selects it — cancel the pending canvas "add leaf" gesture
    // that the capture-phase handler armed (edges, unlike vertices, don't capture
    // the pointer, so pointerup would otherwise reach onCanvasAddPointerUp).
    paperDownRef.current = null;
    const target = { kind: 'edge' as const, id: edgeId };
    if (event.shiftKey || event.metaKey || event.ctrlKey) host.toggleSelection(target);
    else host.select(target);
    host.onLongPress?.(event);
  });

  const onVertexPointerDown = useEventCallback(
    (event: PointerEvent<SVGCircleElement>, vertexId: number) => {
      if (event.button !== 0 || spacePressed) return;
      event.stopPropagation();
      const target = { kind: 'vertex' as const, id: vertexId };
      if (event.shiftKey || event.metaKey || event.ctrlKey) {
        host.toggleSelection(target);
        return;
      }
      host.select(target);
      host.onLongPress?.(event);
      const vertex = findVertex(vertexId);
      if (!vertex) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      // The ghost previews where a *click* would put a leaf, which a drag is not.
      // Clearing it here also means the hover handler has nothing to undo when the
      // drag ends.
      setGhost(null);
      const svg = svgRef.current;
      if (!svg) return;
      const ids = subtreeOf(vertexId);
      const mirrorPreview = mirrorPreviewFor(ids);
      const parentEdge = parentEdgeOf(vertexId);
      const parentId = topology.parent.get(vertexId) ?? null;
      dragRef.current = startTreeDrag({
        root: svg,
        vertexId,
        parentId,
        vertices: vertexLocationsById,
        subtreeIds: ids,
        // A paired vertex may not cross the mirror: it and its partner would swap
        // sides, which reads as the drawing turning inside out.
        mirror: symmetry?.dragMirror(ids) ?? null,
        // A vertex *on* the mirror is its own reflection, so it slides along the
        // line rather than swinging off it. It used to be refused a drag for
        // this, which protected the invariant by making the vertex unusable.
        pinToAxis: symmetry?.isOnAxis(vertexId) ? symmetry.axis : null,
        reflect: mirrorPreview.reflect,
        reflectedIds: mirrorPreview.ids,
        // Stop the *gesture* at the surface's boundary rather than clamping each
        // vertex onto it, which would deform the subtree it is meant to move
        // rigidly.
        bounds: frame.contains,
        length: {
          current: parentEdge?.length ?? 1,
          min: lengths.min,
          max: parentEdge ? lengths.max(parentEdge) : null,
          step: lengths.step,
          quantize: (distance, state) => lengths.quantize(distance, state),
        },
        onLength: (length) => {
          if (host.showEdgeLengths === false) return;
          if (parentEdge && parentId !== null) {
            applyTreeEdgeLabel(svg, vertexId, parentId, lengths.format(length));
          }
        },
        clientStart: { x: event.clientX, y: event.clientY },
        toTreePoint: (client) => clientToTreePoint(client),
        toSvgPoint: (loc) => frame.toSvg(loc),
        chromePx,
      });
    },
  );

  /** Ends a drag if one is running. Answers whether it consumed the pointerup. */
  const finishDrag = (): boolean => {
    const session = dragRef.current;
    if (!session) return false;
    dragRef.current = null;
    session.end();
    // A press on a dot arms the canvas "add leaf" gesture in the capture phase.
    // Grabbing a dot means this pointerup ends a drag, not a click on the paper,
    // so disarm it — otherwise releasing without moving would add a leaf.
    paperDownRef.current = null;
    // `updates` is non-empty even when the rule found no admissible move: it
    // maps every subtree vertex to the place it already was. Committing that is
    // a store write and an undo entry for a gesture that changed nothing, so a
    // move that moves nothing is dropped here rather than recorded.
    const changed = [...session.updates].filter(([id, loc]) => {
      const origin = vertexLocationsById.get(id);
      return !origin || Math.abs(origin.x - loc.x) > 1e-9 || Math.abs(origin.y - loc.y) > 1e-9;
    });
    if (session.moved && changed.length > 0) {
      const updates = [...session.updates].map(([id, loc]) => ({ id, loc }));
      const edge = parentEdgeOf(session.vertexId);
      // A drag that changed the length commits both halves through one call, so
      // undo cannot leave a tree whose drawing disagrees with its numbers.
      if (edge && session.length !== edge.length) {
        void host.setEdgeLength([{ edgeId: edge.id, length: session.length }], updates);
      } else {
        void host.moveVertices(updates);
      }
    }
    return true;
  };

  // Pointer capture retargets the rest of the gesture to the grabbed dot, which
  // sits inside this container — so the drag listens here rather than on every
  // dot. One pair of listeners for the pane instead of two per vertex.
  const onCanvasPointerMove = (event: PointerEvent<Element>) => {
    const session = dragRef.current;
    if (session) {
      session.move({ x: event.clientX, y: event.clientY });
      return;
    }
    // Track hover across the whole clickable pane — clicks commit anywhere on the
    // canvas (via the container), not just over the content-sized SVG, so the mirror
    // ghost must follow the cursor there too. Skip the toolbar/editor chrome.
    if (isViewportInteractiveTarget(event.target)) {
      setGhost(null);
      return;
    }
    // Converting to tree space reads layout, so it must not happen for an answer
    // that is already known to be nothing.
    if (addAnchorId === null) {
      setGhost(null);
      return;
    }
    setGhost(ghostGeometryAt(eventToTreePoint(event)));
  };

  const onCanvasPointerUp = (event: PointerEvent<Element>) => {
    if (finishDrag()) return;
    onCanvasAddPointerUp(event);
  };

  return (
    <div
      ref={containerRef}
      className={`panel-body design-panel__body ${classPrefix}-panel__body`}
      data-space-pan={spacePressed || undefined}
      tabIndex={-1}
      onPointerDownCapture={(event) => {
        setActiveShortcutViewportSurface(host.surface);
        host.onSurfaceFocused?.();
        if (!isViewportInteractiveTarget(event.target)) containerRef.current?.focus();
        onCanvasAddPointerDown(event);
      }}
      onPointerMove={onCanvasPointerMove}
      onPointerLeave={() => setGhost(null)}
      onPointerUp={onCanvasPointerUp}
      onPointerCancel={() => finishDrag()}
    >
      <TransformWrapper
        ref={transformRef}
        initialScale={1}
        minScale={0.05}
        maxScale={30}
        centerOnInit
        limitToBounds={false}
        wheel={VIEWPORT_WHEEL_ZOOM}
        panning={{
          velocityDisabled: true,
          wheelPanning: true,
          allowMiddleClickPan: true,
          allowLeftClickPan: spacePressed,
        }}
        pinch={VIEWPORT_PINCH_ZOOM}
        doubleClick={{ disabled: true }}
        onInit={onInit}
        onTransformed={onCameraTransformed}
      >
        <TransformComponent
          wrapperStyle={{ width: '100%', height: '100%' }}
          contentStyle={{ width: 'fit-content', height: 'fit-content' }}
        >
          <TreeScene
            svgRef={svgRef}
            tree={tree}
            toSvg={frame.toSvg}
            worldRect={frame.worldRect}
            boundsRect={frame.boundsRect}
            layers={host.layers}
            selectedVertices={host.selection.vertices}
            selectedEdges={host.selection.edges}
            chromePx={chromePx}
            symmetryPairs={symmetry?.pairs ?? EMPTY_PAIRS}
            ghostArmed={ghostArmed}
            classPrefix={classPrefix}
            copy={copy}
            lengths={lengths}
            showEdgeLengths={host.showEdgeLengths ?? true}
            labelOf={host.labelOf}
            onRendered={onSceneRendered}
            onEdgePointerDown={onEdgePointerDown}
            onVertexPointerDown={onVertexPointerDown}
          />
        </TransformComponent>
      </TransformWrapper>
      {symmetry && (
        <div ref={mirrorRef} className="tree-editor-mirror" aria-hidden="true">
          <span className="symmetry-snap-lane" />
          <span className="symmetry-line" />
        </div>
      )}
      <TreeEditorToolbar
        copy={copy}
        zoomPercent={zoomPercent}
        layers={host.layers}
        onLayerChange={host.setLayer}
        symmetry={symmetry}
        canUnpair={
          selectedVertex !== null && (symmetry?.partnerOf(selectedVertex) ?? null) !== null
        }
        onUnpair={() => selectedVertex !== null && symmetry?.unpair(selectedVertex)}
        zoomIn={zoomIn}
        zoomOut={zoomOut}
        fitToView={() => fitToView()}
        setZoomLevel={setZoomLevel}
      />
      {selectedEdge && (
        <TreeEdgeLengthEditor
          edge={selectedEdge}
          rule={lengths}
          title={copy.edgeTitle(selectedEdge.vertices[0], selectedEdge.vertices[1])}
          label={copy.length}
          groupLabel={copy.edgeLengthGroup(selectedEdge.vertices[0], selectedEdge.vertices[1])}
          increaseLabel={copy.increaseLength}
          decreaseLabel={copy.decreaseLength}
          onSetLength={(length) =>
            void setEdgeLength(selectedEdge.id, clampLength(lengths, selectedEdge, length))
          }
          onEscape={dismissSelection}
        />
      )}
      {selectedNameableVertex && host.renameVertex && (
        <BpNameEditor
          key={selectedNameableVertex.id}
          title={copy.nameTitle(host.defaultLabelOf(selectedNameableVertex))}
          name={selectedNameableVertex.name}
          placeholder={host.defaultLabelOf(selectedNameableVertex)}
          ariaLabel={copy.nameAria(host.defaultLabelOf(selectedNameableVertex))}
          onRename={(name) => void host.renameVertex?.(selectedNameableVertex.id, name)}
          onEscape={dismissSelection}
        />
      )}
    </div>
  );
}

const EMPTY_PAIRS: readonly { v1: number; v2: number }[] = [];
