import type { ConnectedDrawing } from '../../layer-spread/connectedScene';
import { connectedVisibility, hasConnectedDrawing } from '../../layer-spread/connectedScene';
import { spreadGeometry } from '../../layer-spread/spreadGeometry';
import { FOLD_USER_PER_UNIT } from './foldCanvasGeometry';
import { foldPaneSpreadMap } from './foldPaneSpreadMap';
import { foldedPaneScene } from './foldPaneScenes';
import { foldPickIndex, hydrateFoldPick, panePickData } from './foldPicking';
import { prepareFoldSheetBindings } from './foldPickPreparation';
import type { FoldRenderFrame, FoldRenderPayload, FoldRenderSource } from './foldRenderProtocol';

/** Recreate the pick mesh from the very vertices drawn, never a second projection. */
export function foldPickDrawing(source: FoldRenderSource, positions: FoldRenderPayload['positions']): ConnectedDrawing {
  const { input } = source.prepared.source;
  return { mesh: { positions, triangles: input.triangles, triangleFaces: input.triangleFaces,
    visibility: connectedVisibility(source.prepared.source) },
  rings: input.faces, front: source.scene.faces.map(face => face.front_up), ink: [] };
}

/** Host adapter: exact Fold placement, pens, precreases and picking provenance. */
export function prepareFoldRender(source: FoldRenderSource) {
  const base = hydrateFoldPick(source.scene, source.picking);
  const bindings = prepareFoldSheetBindings(source.scene, source.landmarks, source.prepared);
  let first = true;
  return (frame: FoldRenderFrame) => {
    const scene = foldedPaneScene(source.scene, frame.display, frame.offset, frame.spread, source.prepared);
    if (!hasConnectedDrawing(scene)) throw new Error('Fold spread geometry unavailable');
    const positions: FoldRenderPayload['positions'] = scene.connected.mesh.positions.map(([x, y, z]) =>
      [x / FOLD_USER_PER_UNIT - frame.offset.x, y / FOLD_USER_PER_UNIT + frame.offset.y, z / FOLD_USER_PER_UNIT]);
    const drawing = foldPickDrawing(source, positions);
    const map = foldPaneSpreadMap(source.scene, frame.spread, source.prepared, bindings, drawing);
    const index = foldPickIndex(source.scene, source.landmarks, source.marks, map, base);
    const payload: FoldRenderPayload = { bounds: scene.bounds, positions, folded: panePickData(index.folded), ...(first ? { bindings } : {}) };
    first = false;
    return { geometry: spreadGeometry(scene, frame.style, frame.ink), payload };
  };
}
