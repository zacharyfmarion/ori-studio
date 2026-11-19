/**
 * A step's captured scene as the file stores it.
 *
 * Pure: no DOM, no store.
 */
import type { PaperScene } from '@treemaker/origami-simulator';
import { readPaperScene } from '../../lib/paper/paperSceneValidate';
import type { DiagramScenePicture } from '../document/diagramDocument';

const scenes = new WeakMap<DiagramScenePicture, PaperScene | null>();

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
