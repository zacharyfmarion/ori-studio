import type { Point } from '../lib/geometry';
import type {
  OristudioCpOperationId,
  OristudioCpOperationStatus,
} from '../lib/oristudioCpCommands';

export type OristudioCpOperationCategory =
  | 'Kernel'
  | 'Io'
  | 'KernelIntent'
  | 'KernelPreview'
  | 'UiPreviewOnly'
  | 'OutOfScopeUi';

export interface OristudioCpOperationDescriptor {
  id: OristudioCpOperationId;
  upstream: string;
  target: string;
  category: OristudioCpOperationCategory;
  stage: number;
  status: OristudioCpOperationStatus;
}

export interface OristudioCpRgbColor {
  red: number;
  green: number;
  blue: number;
}

export interface OristudioCpRgbaColor extends OristudioCpRgbColor {
  alpha: number;
}

export interface OristudioCpLineSegment {
  a: Point;
  b: Point;
  active: string;
  color: string;
  selected: number;
  customized: number;
  customized_color: OristudioCpRgbColor;
}

export interface OristudioCpCircle {
  x: number;
  y: number;
  r: number;
  color: string;
  customized: number;
  customized_color: OristudioCpRgbColor;
}

export interface OristudioCpTextElement {
  x: number | { 0: number };
  y: number | { 0: number };
  text: string;
}

export interface OristudioCpGridMetadata {
  interval_grid_size: number;
  grid_size: number;
  grid_xa: number;
  grid_xb: number;
  grid_xc: number;
  grid_ya: number;
  grid_yb: number;
  grid_yc: number;
  grid_angle: number;
  base_state: string;
  vertical_scale_position: number;
  horizontal_scale_position: number;
  draw_diagonal_gridlines: boolean;
}

export interface OristudioCpModel {
  line_segments: OristudioCpLineSegment[];
  circles: OristudioCpCircle[];
  points: Point[];
  aux_line_segments: OristudioCpLineSegment[];
  texts: OristudioCpTextElement[];
  grid: OristudioCpGridMetadata;
}

export interface OristudioCpOperationFrame {
  active: boolean;
  points: [Point, Point, Point, Point];
}

export interface OristudioCpDocumentSnapshot {
  title?: string | null;
  crease_pattern: OristudioCpModel;
  operation_frame?: OristudioCpOperationFrame;
  metadata: Record<string, unknown>;
}

export interface OristudioCpDocumentSummary {
  title?: string | null;
  line_segments: number;
  circles: number;
  points: number;
  aux_line_segments: number;
  texts: number;
  can_save_as_cp: boolean;
  is_empty: boolean;
}

export interface OristudioCpCommandResult {
  operation: OristudioCpOperationId;
  status: OristudioCpOperationStatus;
  diagnostics: string[];
  diagnostic_entries?: OristudioCpDiagnosticEntry[];
}

export interface OristudioCpDiagnosticEntry {
  id: string;
  kind: string;
  severity: string;
  message: string;
  point?: Point | null;
  segments?: OristudioCpLineSegment[];
  rule?: string | null;
  violation_color?: string | null;
  little_big_little?: OristudioCpDiagnosticLittleBigLittleSegment[];
}

export interface OristudioCpDiagnosticLittleBigLittleSegment {
  segment: OristudioCpLineSegment;
  violating: boolean;
}

export interface OristudioCpCommandPreview {
  segments: OristudioCpLineSegment[];
  circles: OristudioCpCircle[];
  points: Point[];
  diagnostics: string[];
}

export type OristudioCpEstimationOrder =
  | 'Order0'
  | 'Order1'
  | 'Order2'
  | 'Order3'
  | 'Order4'
  | 'Order5'
  | 'Order6'
  | 'Order51';

export type OristudioCpEstimationStep =
  | 'Step0'
  | 'Step1'
  | 'Step2'
  | 'Step3'
  | 'Step4'
  | 'Step5'
  | 'Step10';

export type OristudioCpFoldedFigureDisplayStyle =
  | 'None0'
  | 'Development1'
  | 'Wire2'
  | 'Transparent3'
  | 'Development4'
  | 'Paper5';

export type OristudioCpFoldedFigureState = 'Front0' | 'Back1' | 'Both2' | 'Transparent3';

export interface OristudioCpFoldedFigureModel {
  front_color: OristudioCpRgbColor;
  back_color: OristudioCpRgbColor;
  line_color: OristudioCpRgbColor;
  scale: number;
  rotation: number;
  anti_alias: boolean;
  display_shadows: boolean;
  state: OristudioCpFoldedFigureState;
  folded_cases: number;
  transparent_transparency: number;
  transparency_color: boolean;
}

export interface OristudioCpFoldedWireframeLine {
  begin: number;
  end: number;
  color: OristudioCpLineColor;
}

export interface OristudioCpFoldedWireframe {
  points: Point[];
  lines: OristudioCpFoldedWireframeLine[];
  faces: number[][];
  starting_face: number;
  face_positions: number[];
  next_faces: Array<number | null>;
  associated_lines: Array<number | null>;
}

export interface OristudioCpFoldedFigureRenderOptions {
  display_mark?: boolean;
  selected?: boolean;
  index?: number;
  display_numbers?: boolean;
  selected_flat_point_indices?: number[];
  selected_folded_point_indices?: number[];
  custom_constraints?: OristudioCpCustomConstraint[];
}

export interface OristudioCpCustomConstraint {
  face_order: 'normal' | 'flipped';
  constraint_type: 'color_back' | 'color_front' | 'custom';
  position: Point;
}

export type OristudioCpFoldedRenderPrimitiveKind =
  | 'fill_path'
  | 'stroke_path'
  | 'stroke_segment'
  | 'fill_polygon'
  | 'stroke_polygon'
  | 'fill_rect'
  | 'stroke_rect'
  | 'fill_ellipse'
  | 'stroke_ellipse'
  | 'text';

export type OristudioCpFoldedRenderAntialias = 'on' | 'off' | 'default';

export type OristudioCpFoldedRenderPaint =
  | { kind: 'none' }
  | { kind: 'color'; color: OristudioCpRgbaColor }
  | {
      kind: 'gradient';
      from: Point;
      from_color: OristudioCpRgbaColor;
      to: Point;
      to_color: OristudioCpRgbaColor;
      cyclic: boolean;
    }
  | { kind: 'texture' }
  | { kind: 'other'; class_name: string };

export type OristudioCpFoldedRenderStroke =
  | { kind: 'none' }
  | {
      kind: 'basic';
      width: number;
      end_cap: number;
      line_join: number;
      miter_limit: number;
    }
  | { kind: 'other'; class_name: string };

export interface OristudioCpFoldedRenderStyle {
  paint: OristudioCpFoldedRenderPaint;
  stroke: OristudioCpFoldedRenderStroke;
  antialias: OristudioCpFoldedRenderAntialias;
}

export type OristudioCpFoldedRenderPathCommand =
  | { command: 'move_to'; point: Point }
  | { command: 'line_to'; point: Point }
  | { command: 'quad_to'; control: Point; point: Point }
  | { command: 'cubic_to'; control_1: Point; control_2: Point; point: Point }
  | { command: 'close' };

export type OristudioCpFoldedRenderGeometry =
  | { kind: 'path'; commands: OristudioCpFoldedRenderPathCommand[] }
  | { kind: 'segment'; from: Point; to: Point }
  | { kind: 'polygon'; points: Point[] }
  | { kind: 'rect'; x: number; y: number; width: number; height: number }
  | { kind: 'ellipse'; x: number; y: number; width: number; height: number }
  | { kind: 'text'; value: string; position: Point };

export interface OristudioCpFoldedRenderPrimitive {
  sequence: number;
  kind: OristudioCpFoldedRenderPrimitiveKind;
  style: OristudioCpFoldedRenderStyle;
  geometry: OristudioCpFoldedRenderGeometry;
}

export interface OristudioCpFoldedRenderSnapshot {
  schema_version: number;
  fixture: string | null;
  pass: string | null;
  primitives: OristudioCpFoldedRenderPrimitive[];
}

export interface OristudioCpFoldedFigureSnapshot {
  model: OristudioCpFoldedFigureModel;
  estimation_step: OristudioCpEstimationStep;
  display_style: OristudioCpFoldedFigureDisplayStyle;
  discovered_fold_cases: number;
  find_another_overlap_valid: boolean;
  text_result: string;
  wireframe: OristudioCpFoldedWireframe | null;
}

export interface OristudioCpFoldedFigureResult {
  handle: number;
  snapshot: OristudioCpFoldedFigureSnapshot;
}

export interface OristudioCpFoldedFigureBatchResult {
  snapshot: OristudioCpFoldedFigureSnapshot;
  discovered_case_numbers: number[];
}

export type OristudioCpFoldedFigureStatus = 'ready' | 'stale' | 'loading' | 'error' | 'unsupported';

export type OristudioCpFoldedFigureSourceKind =
  | 'generated-from-current-cp'
  | 'imported-folded-form'
  | 'imported-preserved-frame';

export interface OristudioCpFoldedFigureEntry {
  id: string;
  title: string;
  handle: number | null;
  sourceKind: OristudioCpFoldedFigureSourceKind;
  sourceCpRevision: number | null;
  startingFaceId: number | null;
  displayStyle: OristudioCpFoldedFigureDisplayStyle;
  status: OristudioCpFoldedFigureStatus;
  snapshot: OristudioCpFoldedFigureSnapshot | null;
  renderSnapshot: OristudioCpFoldedRenderSnapshot | null;
  displayOffset?: Point;
  error: string | null;
}

export interface OristudioCpCommandPayload {
  line_ids?: number[];
  line_segments?: OristudioCpLineSegment[];
  circle_ids?: number[];
  text_ids?: number[];
  points?: Point[];
  line_color?: OristudioCpLineColor;
  selection_distance?: number;
  replace_selection?: boolean;
  grid_width?: number;
  angle_system_divider?: number;
  angles?: [number, number, number, number, number, number];
  candidate_index?: number;
  division_count?: number;
  ratio_s?: number;
  ratio_t?: number;
  width?: number;
  custom_from_line_type?: OristudioCpCustomLineType;
  custom_to_line_type?: OristudioCpCustomLineType;
  custom_line_type?: OristudioCpCustomLineType;
  fix_precision?: number;
  fix_precision_use_bp?: boolean;
  fix_precision_use_22_5?: boolean;
  polygon_corners?: number;
  custom_circle_color?: OristudioCpRgbColor;
  text_action?: OristudioCpTextCommandAction;
  text_content?: string;
}

export type OristudioCpTextCommandAction =
  | 'Create'
  | 'Move'
  | 'SetContent'
  | 'DeleteSelected'
  | 'DeleteAt'
  | 'DeleteBox';

export type OristudioCpLineColor =
  | 'Angle'
  | 'None'
  | 'Black0'
  | 'Red1'
  | 'Blue2'
  | 'Cyan3'
  | 'Orange4'
  | 'Magenta5'
  | 'Green6'
  | 'Yellow7'
  | 'Purple8'
  | 'Other9'
  | 'Grey10';

export type OristudioCpCustomLineType =
  | 'Any'
  | 'Edge'
  | 'MountainAndValley'
  | 'Mountain'
  | 'Valley'
  | 'Aux';

export interface OristudioCpDocumentState {
  handle: number;
  /**
   * Monotonic identifier for the genuine document load that produced this
   * state. Stable across edits, undo/redo, and in-place restores; only advances
   * when a fresh kernel handle is allocated for a new load. The CP panel keys
   * its viewport auto-fit on this rather than the kernel handle.
   */
  loadSerial: number;
  document: OristudioCpDocumentSnapshot;
  summary: OristudioCpDocumentSummary;
  source: {
    format: 'cp' | 'fold' | 'ori' | 'orh' | 'osf';
    filename: string;
    path: string | null;
  };
  operationDescriptors: OristudioCpOperationDescriptor[];
  lastCommandResult: OristudioCpCommandResult | null;
}
