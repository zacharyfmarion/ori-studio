import { shadeColor, shadeFor } from '@treemaker/origami-simulator';
import { describe, expect, it } from 'vitest';
import { builtInPaperPreset } from './paperPresets';
import { DEFAULT_PAPER_STYLE, PT_TO_CSS_PX } from './paperStyle';
import { hexToUnitRgb, lightVector, unitRgbToHex } from './paperStyleResolve';
import { PAPER_THUMBNAIL_HEIGHT, PAPER_THUMBNAIL_WIDTH, paperThumbnail } from './paperThumbnail';

describe('paperThumbnail', () => {
  it('draws the sheet and its four creases with the style’s own pens', () => {
    const thumb = paperThumbnail(DEFAULT_PAPER_STYLE);
    expect([thumb.width, thumb.height]).toEqual([PAPER_THUMBNAIL_WIDTH, PAPER_THUMBNAIL_HEIGHT]);
    // The square is inset by the padding, and is as tall as the drawing allows.
    expect(thumb.sheet).toEqual({
      x: 9,
      y: 7,
      size: 60,
      fill: DEFAULT_PAPER_STYLE.paper.front,
      stroke: DEFAULT_PAPER_STYLE.edges.color,
      strokeWidth: 1.2,
    });
    // Two mountain diagonals, then two valley midlines.
    expect(thumb.lines.map((line) => line.stroke)).toEqual([
      DEFAULT_PAPER_STYLE.mountainFolds.color,
      DEFAULT_PAPER_STYLE.mountainFolds.color,
      DEFAULT_PAPER_STYLE.valleyFolds.color,
      DEFAULT_PAPER_STYLE.valleyFolds.color,
    ]);
    expect(thumb.lines[0]).toMatchObject({ x1: 9, y1: 7, x2: 69, y2: 67 });
    expect(thumb.lines[2]).toMatchObject({ x1: 39, y1: 7, x2: 39, y2: 67 });
    // The Default preset's folds are a crease pattern's: solid.
    expect(thumb.lines[0]?.dash ?? null).toBeNull();
    expect(thumb.lines[2]?.dash ?? null).toBeNull();
  });

  it('resolves a dash against the pen’s own width, as every other surface does', () => {
    // Diagram's folds given its diagram creases' dashed pens.
    const diagram = builtInPaperPreset('diagram').style;
    const thumb = paperThumbnail({
      ...diagram,
      mountainFolds: diagram.mountainDiagramCreases,
      valleyFolds: diagram.valleyDiagramCreases,
    });
    const mountain = diagram.mountainDiagramCreases;
    const width = mountain.width * PT_TO_CSS_PX;
    expect(thumb.lines[0]?.dash).toBe(
      mountain.dash?.map((run) => Math.round(run * width * 100) / 100).join(' ')
    );
    expect(thumb.lines[2]?.dash).toBe('4 2');
  });

  it('shades the figure with the app’s own formula and the style’s light', () => {
    const style = DEFAULT_PAPER_STYLE;
    const thumb = paperThumbnail(style);
    const light = lightVector(style.light.azimuth, style.light.elevation);
    expect(thumb.faces).toHaveLength(2);
    expect(thumb.faces[0]?.fill).toBe(
      unitRgbToHex(shadeColor(hexToUnitRgb(style.paper.front), shadeFor([-0.3, 0.5, 0.8], light)))
    );
    // The second face shows the back of the paper.
    expect(thumb.faces[1]?.fill).toBe(
      unitRgbToHex(shadeColor(hexToUnitRgb(style.paper.back), shadeFor([0.2, 0.8, 0.55], light)))
    );
    expect(thumb.faces[0]?.d.startsWith('M ')).toBe(true);
    expect(thumb.faces[0]?.d.endsWith(' Z')).toBe(true);
  });

  it('paints an unlit style’s faces in the paper colours themselves', () => {
    const diagram = builtInPaperPreset('diagram').style;
    const unlit = { ...diagram, light: { ...diagram.light, enabled: false } };
    const thumb = paperThumbnail(unlit);
    expect(thumb.faces.map((face) => face.fill)).toEqual([diagram.paper.front, diagram.paper.back]);
  });
});
