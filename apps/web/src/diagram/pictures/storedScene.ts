/**
 * A step's captured scene as the file stores it, and as a picture paints it.
 *
 * Pure: no DOM, no store.
 */
import { withLinesDrawnLate, type PaperScene } from '@treemaker/origami-simulator';
import { readPaperScene } from '../../lib/paper/paperSceneValidate';
import type { DiagramScenePicture } from '../document/diagramDocument';

const scenes = new WeakMap<DiagramScenePicture, PaperScene | null>();
const simulatedScenes = new WeakMap<DiagramScenePicture, PaperScene | null>();

/** A stored scene, read once per picture object; null for one that does not read. */
export function storedScene(picture: DiagramScenePicture): PaperScene | null {
  if (scenes.has(picture)) return scenes.get(picture)!;
  let scene: PaperScene | null;
  try {
    scene = readPaperScene(JSON.parse(picture.sceneJson));
  } catch {
    scene = null;
  }
  scenes.set(picture, scene);
  return scene;
}

/**
 * The scene a picture is painted from: its stored scene, and for a simulated
 * capture, that scene with its lines drawn as late as nothing covers them
 * (`withLinesDrawnLate`), as a capture made now draws them — so a step posed
 * before the simulator's scenes did loses the faces painted over its creases
 * where they only touch them. Order is all that changes: its bounds and items
 * are the stored scene's. Read once per picture object.
 */
export function paintedScene(picture: DiagramScenePicture, simulated: boolean): PaperScene | null {
  if (!simulated) return storedScene(picture);
  if (simulatedScenes.has(picture)) return simulatedScenes.get(picture)!;
  const stored = storedScene(picture);
  const scene = stored ? withLinesDrawnLate(stored) : null;
  simulatedScenes.set(picture, scene);
  return scene;
}
