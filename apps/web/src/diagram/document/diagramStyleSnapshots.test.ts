import { describe, expect, it } from 'vitest';
import { builtInPaperPreset } from '../../lib/paper/paperPresets';
import { DEFAULT_PAPER_STYLE, type PaperStyle } from '../../lib/paper/paperStyle';
import { chosenDiagramStyle, diagramStyleChoices } from '../pages/diagramStyleChoices';
import { diagramPaperStyle, diagramStyleKey } from '../pictures/diagramPaperStyle';
import { createDiagram, setDiagramStyle } from './diagramDocument';
import { readDiagram, writeDiagram } from './diagramFile';
import v1 from './__fixtures__/paper-presets-v1.json';

const snapshot: PaperStyle = {
  ...DEFAULT_PAPER_STYLE,
  paper: { front: '#123456', back: '#abcdef' },
  edges: { ...DEFAULT_PAPER_STYLE.edges, width: 1.5 },
};
const choices = () => diagramStyleChoices({ display: DEFAULT_PAPER_STYLE, export: null, presets: [] });

describe('saved preset values', () => {
  it.each(['default', 'diagram'] as const)('keeps the legacy %s preset frozen for id-only files', (preset) => {
    expect(builtInPaperPreset(preset).style).toEqual(v1[preset]);
    const file = { ...writeDiagram(createDiagram()), style: { preset } };
    const read = readDiagram(file)!;
    expect(diagramPaperStyle(read.document.style)).toEqual(v1[preset]);
    const written = writeDiagram(read.document);
    expect(written.style).toEqual({ preset, style: v1[preset] });
    expect(writeDiagram(readDiagram(written)!.document)).toEqual(written);
  });

  it.each(['diagram', 'future-preset'])('draws saved values ahead of the preset named %s', (preset) => {
    const file = { ...writeDiagram(createDiagram()), style: { preset, style: snapshot } };
    const { document, readOnly } = readDiagram(file)!;
    expect(readOnly).toBe(false);
    expect(document.newer).toBeUndefined();
    expect(diagramPaperStyle(document.style)).toEqual(snapshot);
    expect(diagramStyleKey(document.style)).toBe(diagramStyleKey({ style: snapshot }));
    expect(writeDiagram(document)).toEqual(file);
    expect(chosenDiagramStyle(document.style, choices())).toBeNull();
  });

  it('preserves unread style fields while drawing the readable snapshot', () => {
    const file = {
      ...writeDiagram(createDiagram()),
      style: { preset: 'future-preset', style: { ...snapshot, grain: 'washi' }, provenance: 'v2' },
    };
    const read = readDiagram(file)!;
    expect(read.readOnly).toBe(false);
    expect(diagramPaperStyle(read.document.style)).toEqual(snapshot);
    expect(writeDiagram(read.document)).toEqual(file);
  });

  it('explicitly reselecting a named preset replaces its saved values', () => {
    const document = { ...createDiagram(), style: { preset: 'diagram', style: snapshot } };
    const choice = choices()[0]!;
    const updated = setDiagramStyle(document, choice.style);
    expect(updated).not.toBe(document);
    expect(diagramPaperStyle(updated.style)).toEqual(v1.diagram);
    expect(setDiagramStyle(updated, choice.style)).toBe(updated);
    expect(chosenDiagramStyle(updated.style, choices())?.id).toBe('builtin:diagram');
  });
});
