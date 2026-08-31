import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { OristudioCpDiagnosticEntry } from '../../engine/oristudioCpTypes';
import type { CanvasAnnotation } from '../annotations/annotation';
import {
  createCpSuppressionRegion,
  type CpSuppressionRegion,
} from '../annotations/suppressionRegion';
import { createTextAnnotation } from '../annotations/textAnnotation';
import { createCpImage, type CpImage } from '../images/cpImage';
import { cpRegionHiddenCounts, toggledCheckClasses, useCpRegions } from './useCpRegions';
import type { UseCpRegions } from './useCpRegions';

/**
 * The region hook: what each chip is told, and the undo protocol behind the
 * verbs it offers.
 */

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let entryId = 0;

/** A vertex finding at `point`, of the rule and colour a caller cares about. */
function finding(
  point: { x: number; y: number } | null,
  rule: string,
  violationColor?: string
): OristudioCpDiagnosticEntry {
  entryId += 1;
  return {
    id: `entry-${entryId}`,
    kind: 'vertex',
    severity: 'error',
    message: rule,
    point,
    rule,
    ...(violationColor === undefined ? {} : { violation_color: violationColor }),
  };
}

function boxAt(x: number, y: number, id: string, extra: Partial<CpSuppressionRegion> = {}) {
  return {
    ...createCpSuppressionRegion({ id, center: { x, y }, width: 2, height: 2 }),
    ...extra,
  };
}

describe('toggledCheckClasses', () => {
  it('adds a class in canonical order rather than at the end', () => {
    expect(toggledCheckClasses(['kawasaki', 'vertexClosure'], 'maekawa')).toEqual([
      'kawasaki',
      'maekawa',
      'vertexClosure',
    ]);
  });

  it('removes a class', () => {
    expect(toggledCheckClasses(['kawasaki', 'bigLittleBig'], 'kawasaki')).toEqual([
      'bigLittleBig',
    ]);
  });

  it('canonicalises whatever it was handed, so two equal sets stay equal arrays', () => {
    expect(toggledCheckClasses(['vertexClosure', 'kawasaki'], 'bigLittleBig')).toEqual([
      'kawasaki',
      'bigLittleBig',
      'vertexClosure',
    ]);
  });
});

describe('cpRegionHiddenCounts', () => {
  it('is empty for a document with no regions', () => {
    expect(cpRegionHiddenCounts([finding({ x: 0, y: 0 }, 'Angles')], null, []).size).toBe(0);
  });

  it('counts the findings inside a region and ignores the ones outside it', () => {
    const region = boxAt(0, 0, 'r1');
    const counts = cpRegionHiddenCounts(
      [
        finding({ x: 0.2, y: 0.2 }, 'Angles'),
        finding({ x: -0.5, y: 0.5 }, 'BigLittleBig'),
        finding({ x: 9, y: 9 }, 'Angles'),
      ],
      null,
      [region]
    );
    expect(counts.get('r1')).toBe(2);
  });

  it('charges the deciding region even where the document would have hidden it too', () => {
    const region = boxAt(0, 0, 'r1');
    const counts = cpRegionHiddenCounts(
      [finding({ x: 0.2, y: 0.2 }, 'Angles')],
      ['kawasaki', 'bigLittleBig'],
      [region]
    );
    // Deleting it would give nothing back, but the sentence on the chip is "this
    // many findings inside this box are hidden", and that is true.
    expect(counts.get('r1')).toBe(1);
  });

  it('charges an overlap to exactly one region — the one on top', () => {
    const under = boxAt(0, 0, 'under', { z: 0 });
    const over = boxAt(0, 0, 'over', { z: 5 });
    const counts = cpRegionHiddenCounts([finding({ x: 0.1, y: 0.1 }, 'Angles')], null, [
      under,
      over,
    ]);
    // The rule that decided, which is the last matching one. Charging both would
    // double the total; charging neither — "what comes back if you delete me",
    // which is zero for each here — would leave a hidden finding with no chip
    // reporting it at all, over a canvas quietly not being checked.
    expect(counts.get('over')).toBe(1);
    expect(counts.get('under')).toBe(0);
  });

  it('follows the z order, so the chip and a click at that point agree', () => {
    const a = boxAt(0, 0, 'a', { z: 9 });
    const b = boxAt(0, 0, 'b', { z: 1 });
    const counts = cpRegionHiddenCounts([finding({ x: 0.1, y: 0.1 }, 'Angles')], null, [a, b]);
    // Array order says `b` is last; `z` says `a` is on top, and `z` is what both
    // `cpCheckSuppressionRules` and `annotationAtModelPoint` sort by.
    expect(counts.get('a')).toBe(1);
    expect(counts.get('b')).toBe(0);
  });

  it('leaves a masked Maekawa fault visible, so it is never counted as hidden', () => {
    const region = boxAt(0, 0, 'r1');
    const counts = cpRegionHiddenCounts(
      [
        // One violation per vertex, rule overwritten by priority: this is a vertex
        // that failed Kawasaki *and* parity, and only the colour still says so.
        finding({ x: 0.1, y: 0.1 }, 'Angles', 'NotEnoughValley'),
        finding({ x: 0.2, y: 0.2 }, 'Angles', 'Correct'),
      ],
      null,
      [region]
    );
    expect(counts.get('r1')).toBe(1);
  });

  it('never charges a region for a finding with no position', () => {
    const region = boxAt(0, 0, 'r1');
    const counts = cpRegionHiddenCounts([finding(null, 'Angles')], null, [region]);
    expect(counts.get('r1')).toBe(0);
  });
});

describe('useCpRegions', () => {
  let host: HTMLDivElement;
  let root: Root;
  let api: UseCpRegions;

  function Probe() {
    api = useCpRegions();
    return null;
  }

  function seed(annotations: CanvasAnnotation[], entries: OristudioCpDiagnosticEntry[] = []): void {
    useWorkspaceStore.setState({
      // A document has to exist for the history stack to accept an entry; only
      // the fields these paths read are supplied.
      oristudioCpDocument: { document: { crease_pattern: {}, metadata: {} } },
      oristudioCpAnnotations: annotations,
      oristudioCpSelectedAnnotationId: null,
      oristudioCpHistoryPast: [],
      oristudioCpHistoryFuture: [],
      oristudioCpCamvResult: {
        operation: 'CheckCamv',
        diagnostics: [],
        diagnostic_entries: entries,
      },
    } as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
  }

  function historyLength(): number {
    return useWorkspaceStore.getState().oristudioCpHistoryPast.length;
  }

  function annotations(): readonly CanvasAnnotation[] {
    return useWorkspaceStore.getState().oristudioCpAnnotations;
  }

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function mount(): void {
    act(() => root.render(<Probe />));
  }

  it('reports only the regions, and flags Solve from the attachment alone', () => {
    seed([
      createTextAnnotation({ center: { x: 0, y: 0 } }),
      boxAt(0, 0, 'plain'),
      boxAt(4, 4, 'detected', { solveInput: { spans: [] } }),
    ]);
    mount();

    expect(api.regions.map((view) => view.region.id)).toEqual(['plain', 'detected']);
    expect(api.regions.map((view) => view.solvable)).toEqual([false, true]);
  });

  it('hands each chip its own hidden count', () => {
    seed(
      [boxAt(0, 0, 'r1'), boxAt(8, 8, 'r2')],
      [finding({ x: 0.1, y: 0.1 }, 'Angles'), finding({ x: 0.3, y: -0.3 }, 'BigLittleBig')]
    );
    mount();

    expect(api.regions.find((view) => view.region.id === 'r1')?.hiddenCount).toBe(2);
    expect(api.regions.find((view) => view.region.id === 'r2')?.hiddenCount).toBe(0);
  });

  it('adds a region under the whole annotation stack, as one undo entry', () => {
    seed([createTextAnnotation({ center: { x: 0, y: 0 }, z: 3 })]);
    mount();

    const added: CpSuppressionRegion[] = [];
    act(() => {
      added.push(api.addRegion({ center: { x: 1, y: 1 }, width: 2, height: 2 }));
    });

    // A backdrop: `annotationAtModelPoint` returns the topmost, so a full-paper
    // region on top would swallow every click meant for what is inside it.
    expect(added[0].z).toBe(-1);
    expect(annotations()).toHaveLength(2);
    expect(historyLength()).toBe(1);
  });

  it('writes a canonical class set and records exactly one entry per toggle', () => {
    seed([boxAt(0, 0, 'r1')]);
    mount();

    act(() => api.toggleRegionCheckClass('r1', 'maekawa'));
    expect((annotations()[0] as CpSuppressionRegion).suppress).toEqual([
      'kawasaki',
      'bigLittleBig',
      'maekawa',
    ]);
    expect(historyLength()).toBe(1);

    act(() => api.toggleRegionCheckClass('r1', 'kawasaki'));
    expect((annotations()[0] as CpSuppressionRegion).suppress).toEqual([
      'bigLittleBig',
      'maekawa',
    ]);
    expect(historyLength()).toBe(2);
  });

  it('leaves a non-region annotation alone when asked to toggle it', () => {
    const text = createTextAnnotation({ center: { x: 0, y: 0 } });
    seed([text]);
    mount();

    act(() => api.toggleRegionCheckClass(text.id, 'maekawa'));
    expect(historyLength()).toBe(0);
    expect(annotations()[0]).toBe(text);
  });

  it('records one entry for a delete', () => {
    seed([boxAt(0, 0, 'r1'), boxAt(4, 4, 'r2')]);
    mount();

    act(() => api.removeRegion('r1'));

    expect(annotations().map((annotation) => annotation.id)).toEqual(['r2']);
    expect(historyLength()).toBe(1);
  });

  describe('the reference image a region owns', () => {
    /** A region plus the locked underlay it owns, as detection builds them. */
    function seedOwned(patch: Partial<CpImage> = {}): CpImage {
      const image = createCpImage({
        id: 'img-1',
        src: 'data:image/png;base64,iVBORw0KGgo=',
        naturalWidth: 1024,
        naturalHeight: 1024,
        center: { x: 0, y: 0 },
        width: 4,
        height: 4,
        opacity: 0.5,
        locked: true,
        ...patch,
      });
      seed([image, boxAt(0, 0, 'r1', { imageId: 'img-1' })]);
      mount();
      return image;
    }

    it('resolves the link, and reports none for a region that owns no image', () => {
      seedOwned();
      expect(api.regions[0].image?.id).toBe('img-1');

      seed([boxAt(0, 0, 'r1')]);
      mount();
      expect(api.regions[0].image).toBeNull();
    });

    it('reports no image for a link that no longer resolves, rather than throwing', () => {
      // `validateCpImage` drops an image with a bad `src` while the region
      // survives its own validator, so this state reaches a real document. The
      // honest answer is a chip with no image control.
      seed([boxAt(0, 0, 'r1', { imageId: 'img-gone' })]);
      mount();
      expect(api.regions[0].image).toBeNull();
    });

    it('deletes the image with the region, because nothing else could reach it', () => {
      // The cascade is the point. The image is locked so it never takes a click
      // meant for the creases under repair, and no lock toggle or layers panel
      // exists — so a region deleted on its own would leave an underlay the user
      // can see and can never remove.
      seedOwned();
      act(() => api.removeRegion('r1'));

      expect(annotations()).toHaveLength(0);
      expect(historyLength()).toBe(1);
    });

    it('toggles the image hidden as one entry, and the region stays visible', () => {
      seedOwned();
      act(() => api.toggleRegionImageHidden('r1'));

      expect((annotations()[0] as CpImage).hidden).toBe(true);
      // The region itself may never be hidden — its chip is the safety
      // affordance — and `allowedAnnotationUpdate` enforces that by stripping
      // `hidden` from any patch aimed at one. The image's own `hidden` is a
      // different annotation's field, so it passes through untouched. Both
      // behaviours are pinned here because they sit one link apart.
      expect((annotations()[1] as CpSuppressionRegion).hidden).toBe(false);
      expect(historyLength()).toBe(1);
    });

    it('leaves the opacity drag unbracketed, so the slider can own the entry', () => {
      seedOwned();
      act(() => {
        api.setRegionImageOpacity('r1', 0.4);
        api.setRegionImageOpacity('r1', 0.3);
      });

      expect((annotations()[0] as CpImage).opacity).toBeCloseTo(0.3);
      expect(historyLength()).toBe(0);
    });

    it('drops the link when the image alone is deleted', () => {
      seedOwned();
      act(() => api.removeRegionImage('r1'));

      const remaining = annotations();
      expect(remaining).toHaveLength(1);
      // Or the chip would keep offering an image menu for an image that is gone.
      expect((remaining[0] as CpSuppressionRegion).imageId).toBeUndefined();
      expect(historyLength()).toBe(1);
    });

    it('does nothing for a region with no image, rather than deleting something else', () => {
      seed([boxAt(0, 0, 'r1')]);
      mount();
      act(() => {
        api.toggleRegionImageHidden('r1');
        api.removeRegionImage('r1');
      });

      expect(annotations()).toHaveLength(1);
      expect(historyLength()).toBe(0);
    });
  });

  it('collapses a whole chip drag into one undo entry', () => {
    seed([boxAt(0, 0, 'r1')]);
    mount();

    act(() => {
      api.beginGesture();
      api.moveRegion('r1', { x: 1, y: 0 });
      api.moveRegion('r1', { x: 2, y: 1 });
      api.moveRegion('r1', { x: 3, y: 2 });
      api.commitGesture('Move region');
    });

    // The move is the region's own gesture rather than the shared overlay's: a
    // region's body takes no pointer events, so the creases inside it stay
    // editable and the chip is the handle.
    expect((annotations()[0] as CpSuppressionRegion).center).toEqual({ x: 3, y: 2 });
    expect(historyLength()).toBe(1);
  });

  it('takes and releases the canvas-object selection', () => {
    seed([boxAt(0, 0, 'r1')]);
    mount();

    act(() => api.selectRegion('r1'));
    expect(useWorkspaceStore.getState().oristudioCpSelectedAnnotationId).toBe('r1');
    act(() => api.selectRegion(null));
    expect(useWorkspaceStore.getState().oristudioCpSelectedAnnotationId).toBeNull();
  });
});
