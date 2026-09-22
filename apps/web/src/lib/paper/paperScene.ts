/**
 * The picture format every paper surface produces on export: faces and lines
 * in painter's order, with nothing about pens or colours in it.
 *
 * The types live in the simulator package (`packages/origami-simulator/src/paperScene.ts`),
 * because the simulator and the 3D figure build their scenes in the worker and
 * the package cannot import the app. This module is the web's name for them;
 * the painter beside it (`paperSvg.ts`) is what turns a scene and a style into
 * a page.
 */
export type {
  PaperFaceItem,
  PaperItem,
  PaperLineItem,
  PaperLineRole,
  PaperLineWhole,
  PaperMarkupItem,
  PaperScene,
  PaperSide,
  SceneBounds,
  ScenePoint,
} from '@treemaker/origami-simulator';
