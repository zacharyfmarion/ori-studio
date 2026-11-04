/**
 * Where a host's saved paper points are, against the crease pattern it folds.
 *
 * A record names faces by points on the paper (`layerOrderRecord.ts`), and
 * each host keeps them in the frame that survives its own edits: Edit in the
 * crease pattern's coordinates, as it finds a figure's creases again; a
 * Diagram step about the centre of its folded paper's box, so a step whose
 * region moved keeps its points. The dialog and the engines work in the
 * crease pattern's coordinates, the frame of the segments they fold, and a
 * host maps its record through its frame at that seam, once.
 *
 * A frame is a translation, so a face's area is the same in both.
 */
import type { Point } from '../geometry';
import type { LayerOrderPoint, LayerOrderRecord } from './layerOrderRecord';

export interface PaperFrame {
  /** A saved point, in the crease pattern's coordinates. */
  toSource(point: LayerOrderPoint): Point;
  /** A point in the crease pattern's coordinates, as the host saves it. */
  fromSource(point: Point): LayerOrderPoint;
}

/** Edit's frame: the crease pattern's own coordinates. */
export const EDIT_PAPER_FRAME: PaperFrame = paperFrameAbout({ x: 0, y: 0 });

/** Crease-pattern units about `origin`: a Diagram step's frame, about the centre of its folded paper's box. */
export function paperFrameAbout(origin: Point): PaperFrame {
  return {
    toSource: ([x, y]) => ({ x: x + origin.x, y: y + origin.y }),
    fromSource: ({ x, y }) => [x - origin.x, y - origin.y],
  };
}

/** A saved record with its points in the crease pattern's coordinates, as the dialog takes it. */
export function layerOrderRecordToSource(record: LayerOrderRecord, frame: PaperFrame): LayerOrderRecord {
  return withPoints(record, (at) => {
    const { x, y } = frame.toSource(at);
    return [x, y];
  });
}

/** A record the dialog applied, with its points in the host's frame, as the host saves it. */
export function layerOrderRecordFromSource(record: LayerOrderRecord, frame: PaperFrame): LayerOrderRecord {
  return withPoints(record, ([x, y]) => frame.fromSource({ x, y }));
}

function withPoints(record: LayerOrderRecord, move: (at: LayerOrderPoint) => LayerOrderPoint): LayerOrderRecord {
  return { ...record, faces: record.faces.map((face) => ({ ...face, at: move(face.at) })) };
}
