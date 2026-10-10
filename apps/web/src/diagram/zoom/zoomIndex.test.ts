import { describe, expect, it } from 'vitest';
import {
  createDiagram,
  createTurn,
  insertSteps,
  moveStep,
  type DiagramEntry,
  type DiagramStep,
  type DiagramStepZoom,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { cpStep } from '../document/diagramSteps.fixtures';
import { zoomIndex } from './zoomIndex';

const area = (id: string): KnownDiagramAnnotation => ({ id, kind: 'zoom', from: [0.5, 0.5], to: [0.5, 0.5], radius: 0.1 });
const zoom = (from: string): DiagramStepZoom => ({ from, shape: 'circle', frame: { centre: [0.5, 0.5], radius: 0.1 } });
const withAreas = (id: string, ...ids: string[]): DiagramStep => ({ ...cpStep(id), annotations: ids.map(area) });
const enlarged = (id: string, from: string): DiagramStep => ({ ...cpStep(id), zoom: zoom(from) });
const diagramOf = (...entries: DiagramEntry[]) => insertSteps(createDiagram({ title: 'Index' }), entries, 0);

describe('the enlarged steps’ index', () => {
  it('lists each area’s enlarged steps by their provenance, wherever they sit', () => {
    const document = diagramOf(enlarged('s-0', 'a-1'), withAreas('s-1', 'a-1'), enlarged('s-2', 'a-1'), enlarged('s-3', 'a-2'));
    expect(zoomIndex(document).stepsByArea).toEqual(
      new Map([
        ['a-1', ['s-0', 's-2']],
        ['a-2', ['s-3']],
      ])
    );
  });

  it('puts an arrow before an enlarged step when the step before it, turns passed, holds an area: the one it came from, else the first', () => {
    const turn = createTurn({ kind: 'rotate', rotate: { amount: 'quarter', direction: 'cw' } }, () => 'turn-1');
    const document = diagramOf(
      withAreas('s-1', 'a-1', 'a-2'),
      turn,
      enlarged('s-2', 'a-2'),
      enlarged('s-3', 'a-2'),
      withAreas('s-4', 'a-3', 'a-4'),
      enlarged('s-5', 'a-elsewhere')
    );
    const { arrowFrom } = zoomIndex(document);
    expect(arrowFrom.get('s-2')).toEqual({ stepId: 's-1', areaId: 'a-2' });
    expect(arrowFrom.get('s-3')).toBeNull();
    expect(arrowFrom.get('s-5')).toEqual({ stepId: 's-4', areaId: 'a-3' });
    expect(arrowFrom.has('s-1')).toBe(false);
  });

  it('reads the order as it is: moved away from its area, a step loses its arrow, and moved back has it again', () => {
    const document = diagramOf(withAreas('s-1', 'a-1'), enlarged('s-2', 'a-1'), cpStep('s-3'));
    expect(zoomIndex(document).arrowFrom.get('s-2')).not.toBeNull();
    const away = moveStep(document, 's-2', 2);
    expect(zoomIndex(away).arrowFrom.get('s-2')).toBeNull();
    expect(zoomIndex(moveStep(away, 's-2', 1)).arrowFrom.get('s-2')).toEqual({ stepId: 's-1', areaId: 'a-1' });
    // Worked out once per order.
    expect(zoomIndex(document)).toBe(zoomIndex(document));
  });
});
