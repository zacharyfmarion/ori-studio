/**
 * A Layer order source and the kernels' fold source, one into the other.
 *
 * The CP kernel answers what a figure was folded from as
 * `OristudioCpFoldSource` (`folded_figure_source`, `fold_source_of_selection`),
 * snake_case as the bridges cross; the dialog takes it as a
 * {@link LayerOrderSource}, with the model the host folds with. Both bridges
 * take the kernel's shape back: the Fold bridge's `layer_open` and the CP
 * bridge's `folded_figure_fold_with_order`. Nothing is recomputed either way,
 * so the digest still names the same faces.
 */
import type {
  OristudioCpFoldedFigureModel,
  OristudioCpFoldSource,
} from '../../engine/oristudioCpTypes';
import type { LayerOrderSource } from './layerOrderRequest';

/** What the kernel folded, with the model the host folds it with. */
export function layerOrderSourceOf(source: OristudioCpFoldSource, model: OristudioCpFoldedFigureModel): LayerOrderSource {
  return {
    segments: source.segments,
    startingFaceId: source.starting_face_id,
    auxSegments: source.aux_segments,
    model,
    digest: source.digest,
  };
}

/** The source as the kernels take it; the model stays with the caller, which passes it where a call draws. */
export function kernelFoldSourceOf(source: LayerOrderSource): OristudioCpFoldSource {
  return {
    segments: [...source.segments],
    starting_face_id: source.startingFaceId,
    aux_segments: [...source.auxSegments],
    digest: source.digest,
  };
}
