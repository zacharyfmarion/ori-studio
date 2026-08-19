import type {
  OristudioCpDocumentSnapshot,
  OristudioCpGridMetadata,
  OristudioCpLineSegment,
} from '../engine/oristudioCpTypes';
import { ORIEDITA_PAPER_MAX, ORIEDITA_PAPER_MIN } from './creasePatternViewport';

const STARTER_BORDER_COLOR = 'Black0';
const DEFAULT_CUSTOM_COLOR = { red: 100, green: 200, blue: 200 };

export const STARTER_ORISTUDIO_CP_GRID: OristudioCpGridMetadata = {
  interval_grid_size: 2,
  grid_size: 8,
  grid_xa: 1,
  grid_xb: 0,
  grid_xc: 1,
  grid_ya: 1,
  grid_yb: 0,
  grid_yc: 1,
  grid_angle: 90,
  base_state: 'WithinPaper',
  vertical_scale_position: 0,
  horizontal_scale_position: 0,
  draw_diagonal_gridlines: false,
};

export function createStarterOristudioCpDocument(
  title = 'Untitled CP',
): OristudioCpDocumentSnapshot {
  return {
    title,
    crease_pattern: {
      line_segments: createStarterBorderSegments(),
      circles: [],
      points: [],
      aux_line_segments: [],
      texts: [],
      grid: { ...STARTER_ORISTUDIO_CP_GRID },
    },
    metadata: {},
  };
}

export function createStarterBorderSegments(): OristudioCpLineSegment[] {
  const min = ORIEDITA_PAPER_MIN;
  const max = ORIEDITA_PAPER_MAX;
  return [
    createBorderSegment({ x: min, y: max }, { x: max, y: max }),
    createBorderSegment({ x: max, y: max }, { x: max, y: min }),
    createBorderSegment({ x: max, y: min }, { x: min, y: min }),
    createBorderSegment({ x: min, y: min }, { x: min, y: max }),
  ];
}

function createBorderSegment(
  a: OristudioCpLineSegment['a'],
  b: OristudioCpLineSegment['b'],
): OristudioCpLineSegment {
  return {
    a,
    b,
    active: 'Inactive0',
    color: STARTER_BORDER_COLOR,
    selected: 0,
    customized: 0,
    customized_color: { ...DEFAULT_CUSTOM_COLOR },
  };
}
