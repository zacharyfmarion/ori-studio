import { describe, expect, it } from 'vitest';
import { folded3dSceneStyleKey } from '../../cp-workspace/folded/folded3dScene';
import { createStep, type DiagramStep, type DiagramStyle } from '../document/diagramDocument';
import { cpSource, scenePicture } from '../document/diagramSteps.fixtures';
import { simulatorSceneStyleKey } from '../../simulator/simulatorExportTarget';
import { diagramPaperStyle, diagramStyleKey } from './diagramPaperStyle';
import { capturedStyleChange, lightingChanged } from './lighting';

const DIAGRAM: DiagramStyle = { preset: 'diagram' };
const style = diagramPaperStyle(DIAGRAM);
const RELIT: DiagramStyle = { style: { ...style, light: { ...style.light, azimuth: style.light.azimuth + 60 } } };
const REPENNED: DiagramStyle = { style: { ...style, edges: { ...style.edges, width: style.edges.width * 2 } } };

const step = (picture: DiagramStep['picture']): DiagramStep => ({ ...createStep(() => 'step-1'), picture });

describe('capturedStyleChange', () => {
  it('says a 3D scene’s light is not the diagram’s', () => {
    const lit = step({ ...scenePicture(), styleKey: folded3dSceneStyleKey(style) });
    expect(capturedStyleChange(lit, DIAGRAM)).toBeNull();
    expect(capturedStyleChange(lit, RELIT)).toBe('light');
    expect(lightingChanged(lit, RELIT)).toBe(true);
    // A flat scene keeps no light, and is re-inked whatever the style.
    expect(capturedStyleChange(step(scenePicture()), RELIT)).toBeNull();
  });

  it('says nothing of a newer build’s step, which is never captured again here', () => {
    const lit = step({ ...scenePicture(), styleKey: folded3dSceneStyleKey(style) });
    expect(capturedStyleChange({ ...lit, unknown: { id: 'step-1' } }, RELIT)).toBeNull();
  });

  it('compares a simulated scene with the simulator’s light, not the folded figure’s', () => {
    const simulated: DiagramStep = {
      ...step({ ...scenePicture(), styleKey: simulatorSceneStyleKey(style) }),
      source: cpSource({ mode: 'simulated', foldPercent: 0, view: { yaw: 0, pitch: 0, zoom: 1 } }),
    };
    expect(capturedStyleChange(simulated, DIAGRAM)).toBeNull();
    expect(capturedStyleChange(simulated, RELIT)).toBe('light');
  });

  it('says a capture kept as a bitmap was drawn in another style, pens and all', () => {
    const bitmap = step({ kind: 'asset', assetId: 'asset-raster-1', paperScale: 2, styleKey: diagramStyleKey(DIAGRAM), key: 'raster-1' });
    expect(capturedStyleChange(bitmap, DIAGRAM)).toBeNull();
    expect(capturedStyleChange(bitmap, REPENNED)).toBe('style');
    // An upload is drawn as it came, whatever the style.
    const upload = step({ kind: 'asset', assetId: 'asset-up', paperScale: null, key: 'asset:asset-up' });
    expect(capturedStyleChange(upload, REPENNED)).toBeNull();
  });
});
