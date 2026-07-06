import type { PlotRect, Point } from './geometry';
import {
  CP_PAPER_RECT,
  ORIEDITA_PAPER_MIN,
  ORIEDITA_PAPER_SIZE,
} from './creasePatternViewport';

const ORI_CAMERA_KEY = 'oriedita:ori:creasePatternCamera';
const ORIEDITA_DEGREES_TO_RADIANS = 3.14159265 / 180;
const DEFAULT_DISPLAY_POSITION = 350;

export interface OrieditaCamera {
  cameraPositionX: number;
  cameraPositionY: number;
  cameraAngle: number;
  cameraMirror: number;
  cameraZoomX: number;
  cameraZoomY: number;
  displayPositionX: number;
  displayPositionY: number;
}

export const DEFAULT_ORIEDITA_CAMERA: OrieditaCamera = {
  cameraPositionX: 0,
  cameraPositionY: 0,
  cameraAngle: 0,
  cameraMirror: 1,
  cameraZoomX: 1,
  cameraZoomY: 1,
  displayPositionX: DEFAULT_DISPLAY_POSITION,
  displayPositionY: DEFAULT_DISPLAY_POSITION,
};

export function orieditaCameraFromMetadata(
  metadata: Record<string, unknown> | null | undefined
): OrieditaCamera | null {
  const value = metadata?.[ORI_CAMERA_KEY];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return orieditaCameraFromValue(value as Record<string, unknown>);
}

export function orieditaCameraFromValue(value: Record<string, unknown>): OrieditaCamera {
  const cameraPosition = pointString(value.cameraPosition);
  return {
    cameraPositionX:
      finiteNumber(value.cameraPositionX) ??
      finiteNumber(value.camera_position_x) ??
      cameraPosition?.x ??
      DEFAULT_ORIEDITA_CAMERA.cameraPositionX,
    cameraPositionY:
      finiteNumber(value.cameraPositionY) ??
      finiteNumber(value.camera_position_y) ??
      cameraPosition?.y ??
      DEFAULT_ORIEDITA_CAMERA.cameraPositionY,
    cameraAngle:
      finiteNumber(value.cameraAngle) ??
      finiteNumber(value.camera_angle) ??
      DEFAULT_ORIEDITA_CAMERA.cameraAngle,
    cameraMirror:
      finiteNumber(value.cameraMirror) ??
      finiteNumber(value.camera_mirror) ??
      DEFAULT_ORIEDITA_CAMERA.cameraMirror,
    cameraZoomX:
      nonZeroFiniteNumber(value.cameraZoomX) ??
      nonZeroFiniteNumber(value.camera_zoom_x) ??
      DEFAULT_ORIEDITA_CAMERA.cameraZoomX,
    cameraZoomY:
      nonZeroFiniteNumber(value.cameraZoomY) ??
      nonZeroFiniteNumber(value.camera_zoom_y) ??
      DEFAULT_ORIEDITA_CAMERA.cameraZoomY,
    displayPositionX:
      finiteNumber(value.displayPositionX) ??
      finiteNumber(value.display_position_x) ??
      DEFAULT_ORIEDITA_CAMERA.displayPositionX,
    displayPositionY:
      finiteNumber(value.displayPositionY) ??
      finiteNumber(value.display_position_y) ??
      DEFAULT_ORIEDITA_CAMERA.displayPositionY,
  };
}

export function orieditaObjectToTv(point: Point, camera: OrieditaCamera): Point {
  const { sin, cos } = cameraTrig(camera);
  const x1 = point.x - camera.cameraPositionX;
  const y1 = point.y - camera.cameraPositionY;
  let x2 = cos * x1 + sin * y1;
  let y2 = -sin * x1 + cos * y1;

  x2 *= camera.cameraMirror;
  x2 *= camera.cameraZoomX;
  y2 *= camera.cameraZoomY;

  return {
    x: x2 + camera.displayPositionX,
    y: y2 + camera.displayPositionY,
  };
}

export function orieditaTvToObject(point: Point, camera: OrieditaCamera): Point {
  const { sin, cos } = cameraTrig(camera);
  let x1 = point.x - camera.displayPositionX;
  let y1 = point.y - camera.displayPositionY;

  x1 /= camera.cameraZoomX;
  y1 /= camera.cameraZoomY;
  x1 *= camera.cameraMirror;

  return {
    x: cos * x1 - sin * y1 + camera.cameraPositionX,
    y: sin * x1 + cos * y1 + camera.cameraPositionY,
  };
}

export function orieditaTvToSvg(
  point: Point,
  rect: PlotRect = CP_PAPER_RECT
): Point {
  const tvMin = DEFAULT_DISPLAY_POSITION + ORIEDITA_PAPER_MIN;
  return {
    x: rect.x + ((point.x - tvMin) / ORIEDITA_PAPER_SIZE) * rect.width,
    y: rect.y + ((point.y - tvMin) / ORIEDITA_PAPER_SIZE) * rect.height,
  };
}

export function orieditaSvgToTv(
  point: Point,
  rect: PlotRect = CP_PAPER_RECT
): Point {
  const tvMin = DEFAULT_DISPLAY_POSITION + ORIEDITA_PAPER_MIN;
  return {
    x: tvMin + ((point.x - rect.x) / rect.width) * ORIEDITA_PAPER_SIZE,
    y: tvMin + ((point.y - rect.y) / rect.height) * ORIEDITA_PAPER_SIZE,
  };
}

export function orieditaObjectToSvg(
  point: Point,
  camera: OrieditaCamera,
  rect: PlotRect = CP_PAPER_RECT
): Point {
  return orieditaTvToSvg(orieditaObjectToTv(point, camera), rect);
}

export function orieditaSvgToObject(
  point: Point,
  camera: OrieditaCamera,
  rect: PlotRect = CP_PAPER_RECT
): Point {
  return orieditaTvToObject(orieditaSvgToTv(point, rect), camera);
}

export function orieditaCameraSvgScale(
  camera: OrieditaCamera,
  rect: PlotRect = CP_PAPER_RECT
): { x: number; y: number } {
  return {
    x: (Math.abs(camera.cameraZoomX) * rect.width) / ORIEDITA_PAPER_SIZE,
    y: (Math.abs(camera.cameraZoomY) * rect.height) / ORIEDITA_PAPER_SIZE,
  };
}

export function isDefaultOrieditaCamera(camera: OrieditaCamera | null | undefined): boolean {
  if (!camera) return true;
  return (
    nearlyEqual(camera.cameraPositionX, DEFAULT_ORIEDITA_CAMERA.cameraPositionX) &&
    nearlyEqual(camera.cameraPositionY, DEFAULT_ORIEDITA_CAMERA.cameraPositionY) &&
    nearlyEqual(camera.cameraAngle, DEFAULT_ORIEDITA_CAMERA.cameraAngle) &&
    nearlyEqual(camera.cameraMirror, DEFAULT_ORIEDITA_CAMERA.cameraMirror) &&
    nearlyEqual(camera.cameraZoomX, DEFAULT_ORIEDITA_CAMERA.cameraZoomX) &&
    nearlyEqual(camera.cameraZoomY, DEFAULT_ORIEDITA_CAMERA.cameraZoomY) &&
    nearlyEqual(camera.displayPositionX, DEFAULT_ORIEDITA_CAMERA.displayPositionX) &&
    nearlyEqual(camera.displayPositionY, DEFAULT_ORIEDITA_CAMERA.displayPositionY)
  );
}

function cameraTrig(camera: OrieditaCamera): { sin: number; cos: number } {
  const radians = camera.cameraAngle * ORIEDITA_DEGREES_TO_RADIANS;
  return {
    sin: Math.sin(radians),
    cos: Math.cos(radians),
  };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function nonZeroFiniteNumber(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && Math.abs(number) > 1e-12 ? number : null;
}

function pointString(value: unknown): Point | null {
  if (typeof value !== 'string') return null;
  const [x, y] = value.split(',').map((part) => Number(part.trim()));
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 1e-9;
}
