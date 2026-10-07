import { ANALYTICS_EVENTS, DIAGRAM_ENLARGE_SIZE_BUCKETS, bucketCount } from './events';
import type {
  DiagramEnlargeShape,
  DiagramEnlargementOn,
  DiagramEnlargementSetting,
  DiagramEnlargementValue,
  DiagramPictureKind,
  DiagramStepEnlargedAnchor,
  DiagramStepEnlargedPlaced,
  DiagramStepEnlargedVia,
} from './events';
import { track } from './runtime';

/**
 * A frame placed on an enlarged step by a capture (Revision 2): one event per
 * step placed — Pose's Enlarged turned on (`toggle`), a seeded step's first
 * picture landing its frame (`seeded`), or each step Update Enlarged Steps
 * places (`update`) — with how the frame was placed (through an anchor face,
 * through a crease pattern's sheet, or copied in picture units), by which
 * anchor, its shape, and what the step's picture is. Whether enlarged steps
 * are made, how often their frames anchor to the paper, and whether a picked
 * anchor is ever needed. Enums only: never where the frame is, nor its size.
 */
export function trackDiagramStepEnlarged(
  via: DiagramStepEnlargedVia,
  placed: DiagramStepEnlargedPlaced,
  anchor: DiagramStepEnlargedAnchor,
  shape: DiagramEnlargeShape,
  picture: DiagramPictureKind
): void {
  track(ANALYTICS_EVENTS.diagramStepEnlarged, { via, placed, anchor, shape, picture });
}

/**
 * An enlarge area or an enlarged step's frame changed (Revision 2), once per
 * drop or commit: moved or resized by hand, its Shape, Size, Edge or Anchor,
 * or an area deleted — and what it became; a fixed Size bucketed. Which of
 * the controls are used, and whether the automatic placement needs a hand.
 * Never a size or a place.
 */
export function trackDiagramEnlargementChanged(
  on: DiagramEnlargementOn,
  setting: DiagramEnlargementSetting,
  value?: DiagramEnlargementValue,
  size?: number
): void {
  track(ANALYTICS_EVENTS.diagramEnlargementChanged, {
    on,
    setting,
    ...(value === undefined ? {} : { value }),
    ...(size === undefined ? {} : { size_bucket: bucketCount(size, DIAGRAM_ENLARGE_SIZE_BUCKETS) }),
  });
}
