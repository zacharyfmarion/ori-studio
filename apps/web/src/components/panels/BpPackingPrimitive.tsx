import { type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
  OristudioBpDocumentState,
  OristudioBpGraphicPrimitive,
} from '../../engine/oristudioBpTypes';
import type { OristudioBpLinkedSelection } from '../../lib/oristudioBpSelection';
import { bpPackingPointToSvg, bpPackingUnitToSvg } from '../../lib/bpPackingViewport';
import { bpRiverIdFromGraphicsId } from '../../lib/bpPackingRivers';
import { bpDefaultFlapLabel } from '../../lib/bpFlapLabel';
import { type Point } from '../../lib/geometry';

/**
 * One graphic the engine drew — a crease, a contour, a gadget, a dot, a label.
 *
 * The engine emits every drawable as an untyped primitive keyed by the tag of
 * whatever produced it (`f5:ridge:0`, `re0,2:contour:0`, `s24,26.0:contour:0`),
 * so working out what a primitive *is* — which flap, river or device owns it,
 * what to call it, what selects it — is parsing its id. That parsing, the
 * selection rules that read it, and the SVG each kind draws are one concern, and
 * this file is it. The panel composes these; it does not know the id grammar.
 *
 * The pieces the panel's own pointer handlers need in order to route a press
 * back to a flap, river or device are exported; the rest stay private.
 */
export function BpPackingPrimitive({
  primitive,
  document,
  linkedSelection,
  selectionShade,
  paperRect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  primitive: OristudioBpGraphicPrimitive;
  document: OristudioBpDocumentState;
  linkedSelection: OristudioBpLinkedSelection;
  /** Whether the selection-shade layer is on (the device wash follows it). */
  selectionShade: boolean;
  paperRect: { x: number; y: number; width: number; height: number };
  onPointerDown: (event: PointerEvent<SVGGElement>, primitive: OristudioBpGraphicPrimitive) => void;
  onPointerMove: (event: PointerEvent<SVGGElement>, primitive: OristudioBpGraphicPrimitive) => void;
  onPointerUp: (event: PointerEvent<SVGGElement>, primitive: OristudioBpGraphicPrimitive) => void;
}) {
  const { t } = useTranslation();
  const sheet = document.snapshot.packing.sheet;
  const active =
    primitiveSelectedByFlap(primitive.id, linkedSelection) ||
    primitiveSelectedByRiver(primitive.id, document, linkedSelection) ||
    primitiveSelectedByDevice(primitive.id, document, linkedSelection);
  const className = [
    'bp-packing-primitive',
    `bp-packing-primitive--${primitive.layer}`,
    active ? 'bp-packing-primitive--selected' : '',
  ].join(' ');
  const ariaLabel = primitiveAriaLabel(primitive, document, t);
  // Labelled but not focusable — see the flap shade rects. A focus ring here
  // would sit over the very geometry the user is trying to grab.
  const labelProps = ariaLabel
    ? {
        'aria-label': ariaLabel,
        'data-bp-select': primitiveSelectToken(primitive, document),
      }
    : {};
  if (primitive.kind === 'line') {
    const [a, b] = primitive.points.map((point) => bpPackingPointToSvg(point, sheet, paperRect));
    return (
      <g
        className={className}
        {...labelProps}
        onPointerDown={(event) => onPointerDown(event, primitive)}
        onPointerMove={(event) => onPointerMove(event, primitive)}
        onPointerUp={(event) => onPointerUp(event, primitive)}
        onPointerCancel={(event) => onPointerUp(event, primitive)}
      >
        <line className="bp-packing-primitive-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
        <line className="bp-packing-primitive-hit-line" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      </g>
    );
  }
  if (primitive.kind === 'polyline') {
    const points = primitive.points.map((point) => bpPackingPointToSvg(point, sheet, paperRect));
    const Element = primitive.closed ? 'polygon' : 'polyline';
    return (
      <g
        className={className}
        {...labelProps}
        onPointerDown={(event) => onPointerDown(event, primitive)}
        onPointerMove={(event) => onPointerMove(event, primitive)}
        onPointerUp={(event) => onPointerUp(event, primitive)}
        onPointerCancel={(event) => onPointerUp(event, primitive)}
      >
        <Element className="bp-packing-primitive-polyline" points={pointsAttr(points)} />
        <Element
          className={
            primitive.closed && primitive.layer === 'device'
              ? deviceShadeClassName(active && selectionShade)
              : 'bp-packing-primitive-hit-polyline'
          }
          points={pointsAttr(points)}
        />
      </g>
    );
  }
  if (primitive.kind === 'polygon') {
    const points = primitive.points.map((point) => bpPackingPointToSvg(point, sheet, paperRect));
    return (
      <g
        className={className}
        {...labelProps}
        onPointerDown={(event) => onPointerDown(event, primitive)}
        onPointerMove={(event) => onPointerMove(event, primitive)}
        onPointerUp={(event) => onPointerUp(event, primitive)}
        onPointerCancel={(event) => onPointerUp(event, primitive)}
      >
        <polygon className="bp-packing-primitive-polygon" points={pointsAttr(points)} />
      </g>
    );
  }
  if (primitive.kind === 'circle') {
    const center = bpPackingPointToSvg(primitive.center, sheet, paperRect);
    const radius = primitive.radius * bpPackingUnitToSvg(sheet, paperRect);
    return (
      <g
        className={className}
        {...labelProps}
        onPointerDown={(event) => onPointerDown(event, primitive)}
        onPointerMove={(event) => onPointerMove(event, primitive)}
        onPointerUp={(event) => onPointerUp(event, primitive)}
        onPointerCancel={(event) => onPointerUp(event, primitive)}
      >
        <circle className="bp-packing-primitive-circle" cx={center.x} cy={center.y} r={radius} />
      </g>
    );
  }
  const loc = bpPackingPointToSvg(primitive.loc, sheet, paperRect);
  return (
    <g
      className={className}
      {...labelProps}
      onPointerDown={(event) => onPointerDown(event, primitive)}
      onPointerMove={(event) => onPointerMove(event, primitive)}
      onPointerUp={(event) => onPointerUp(event, primitive)}
      onPointerCancel={(event) => onPointerUp(event, primitive)}
    >
      <text className="bp-packing-label" x={loc.x} y={loc.y}>
        {primitive.text}
      </text>
    </g>
  );
}

/**
 * The classes for a device's shade — its gadget interior, which is also its
 * click target. Only a device is grabbed by its whole interior, and upstream
 * hits on the very `Graphics` it fills (`Device` constructor:
 * `$setupHit(this._shade)`). A closed hinge contour bounds a flap or a river
 * instead, and filling those made every ring a solid target: the outer one
 * swallowed presses meant for what it encloses, and an inner one — a hole —
 * swallowed presses meant for the child sitting in it. Those are the river band
 * layer's, which hit-tests the band with its holes punched out.
 *
 * The selected wash follows the selection-shade layer, as a flap's and a river's
 * do. Hover does not, and lives in CSS, because it is feedback about the pointer
 * rather than a layer of the drawing.
 */
function deviceShadeClassName(shadeSelected: boolean): string {
  return shadeSelected
    ? 'bp-packing-device-shade bp-packing-device-shade--selected'
    : 'bp-packing-device-shade';
}

function primitiveAriaLabel(
  primitive: OristudioBpGraphicPrimitive,
  document: OristudioBpDocumentState,
  t: TFunction
): string | undefined {
  const deviceInfo = deviceInfoFromPrimitiveId(primitive.id, document);
  if (deviceInfo) {
    const stretchId = deviceInfo.deviceId.split(':device:')[0] ?? deviceInfo.deviceId;
    return t('panels:bpPacking.selectDevice', 'Select BP device {{index}} for stretch {{stretchId}}', {
      index: deviceInfo.index + 1,
      stretchId,
    });
  }
  const flapId = flapIdFromPrimitiveId(primitive.id);
  if (flapId !== null) {
    return t('panels:bpPacking.selectFlap', 'Select BP flap {{id}}', {
      id: bpDefaultFlapLabel(flapId),
    });
  }
  const riverId = riverIdFromPrimitiveId(primitive.id, document);
  if (riverId !== null) return t('panels:bpPacking.selectRiverShort', 'Select BP river {{id}}', { id: riverId });
  return undefined;
}

/** The `data-bp-select` token for a crease primitive, used by click-cycling. */
function primitiveSelectToken(
  primitive: OristudioBpGraphicPrimitive,
  document: OristudioBpDocumentState
): string | undefined {
  const deviceInfo = deviceInfoFromPrimitiveId(primitive.id, document);
  if (deviceInfo) return `device:${deviceInfo.deviceId}`;
  const flapId = flapIdFromPrimitiveId(primitive.id);
  if (flapId !== null) return `flap:${flapId}`;
  const riverId = riverIdFromPrimitiveId(primitive.id, document);
  if (riverId !== null) return `river:${riverId}`;
  return undefined;
}

function pointsAttr(points: Point[]): string {
  return points.map((point) => `${point.x},${point.y}`).join(' ');
}

export function flapIdFromPrimitiveId(id: string): number | null {
  const match = /^f(\d+)(?::|$)/.exec(id);
  return match ? Number.parseInt(match[1], 10) : null;
}

export function riverIdFromPrimitiveId(
  id: string,
  document: OristudioBpDocumentState
): number | null {
  return bpRiverIdFromGraphicsId(id, document.snapshot.packing.rivers);
}

function deviceIdFromPrimitiveId(id: string, document: OristudioBpDocumentState): string | null {
  return deviceInfoFromPrimitiveId(id, document)?.deviceId ?? null;
}

export function deviceIndexFromId(id: string): number | null {
  const match = /:device:(\d+)$/.exec(id);
  if (!match) return null;
  const index = Number.parseInt(match[1], 10);
  return Number.isFinite(index) ? index : null;
}

export function deviceInfoFromPrimitiveId(
  id: string,
  document: OristudioBpDocumentState
): { deviceId: string; index: number } | null {
  const match = /^s(.+)\.(\d+)(?::|$)/.exec(id);
  if (!match) return null;
  const index = Number.parseInt(match[2], 10);
  const deviceId = `${match[1]}:device:${index}`;
  return document.snapshot.packing.devices.some((device) => device.id === deviceId)
    ? { deviceId, index }
    : null;
}

function primitiveSelectedByFlap(
  id: string,
  linkedSelection: OristudioBpLinkedSelection
): boolean {
  const flapId = flapIdFromPrimitiveId(id);
  return flapId !== null && linkedSelection.flaps.has(flapId);
}

function primitiveSelectedByRiver(
  id: string,
  document: OristudioBpDocumentState,
  linkedSelection: OristudioBpLinkedSelection
): boolean {
  const riverId = riverIdFromPrimitiveId(id, document);
  return riverId !== null && linkedSelection.rivers.has(riverId);
}

function primitiveSelectedByDevice(
  id: string,
  document: OristudioBpDocumentState,
  linkedSelection: OristudioBpLinkedSelection
): boolean {
  const deviceId = deviceIdFromPrimitiveId(id, document);
  return deviceId !== null && linkedSelection.devices.has(deviceId);
}
