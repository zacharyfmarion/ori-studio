import { describe, expect, it } from 'vitest';
import type { FoldDocument } from '../engine/types';
import {
  AUX_LINES_ARE_FACETS_KEY,
  chosenAuxLinesAreFacets,
  documentAuxLinesAreFacets,
  foldAuxLinesAreFacets,
  foldTextStatingAuxLines,
  SIMULATION_EXTENSION_KEY,
  withChosenAuxLinesAreFacets,
} from './simulationAuxLines';

const fold = (extra: Partial<FoldDocument> & Record<string, unknown> = {}): FoldDocument => ({
  vertices_coords: [],
  edges_vertices: [],
  faces_vertices: [],
  ...extra,
});

describe('foldAuxLinesAreFacets', () => {
  it('reads facets into Origami Simulator files and svg-to-fold output', () => {
    expect(
      foldAuxLinesAreFacets(
        fold({ file_creator: 'Origami Simulator: http://git.amandaghassaei.com/OrigamiSimulator/' })
      )
    ).toBe(true);
    expect(foldAuxLinesAreFacets(fold({ file_creator: 'Ori Studio svg-to-fold' }))).toBe(true);
  });

  it('reads reference lines into everything else, unknown creators included', () => {
    expect(foldAuxLinesAreFacets(fold({ file_creator: 'oriedita' }))).toBe(false);
    expect(foldAuxLinesAreFacets(fold({ file_creator: 'Box Pleating Studio' }))).toBe(false);
    expect(foldAuxLinesAreFacets(fold())).toBe(false);
    expect(foldAuxLinesAreFacets(null)).toBe(false);
  });

  it('takes the stated key over the creator', () => {
    expect(
      foldAuxLinesAreFacets(fold({ file_creator: 'oriedita', [AUX_LINES_ARE_FACETS_KEY]: true }))
    ).toBe(true);
    expect(
      foldAuxLinesAreFacets(
        fold({ file_creator: 'Origami Simulator', [AUX_LINES_ARE_FACETS_KEY]: false })
      )
    ).toBe(false);
  });
});

describe('the document choice', () => {
  it('follows the source FOLD until the user chooses', () => {
    const facetFile = fold({ file_creator: 'Origami Simulator' });
    expect(chosenAuxLinesAreFacets({})).toBeNull();
    expect(documentAuxLinesAreFacets({}, facetFile)).toBe(true);

    const chosen = withChosenAuxLinesAreFacets({}, false);
    expect(chosenAuxLinesAreFacets(chosen)).toBe(false);
    expect(documentAuxLinesAreFacets(chosen, facetFile)).toBe(false);
  });

  it('keeps the other extensions and any other simulation choice', () => {
    const extensions = {
      'oristudio.foldedFigureSpreads': { a: 1 },
      [SIMULATION_EXTENSION_KEY]: { later: 'kept' },
    };
    expect(withChosenAuxLinesAreFacets(extensions, true)).toEqual({
      'oristudio.foldedFigureSpreads': { a: 1 },
      [SIMULATION_EXTENSION_KEY]: { later: 'kept', auxLinesAreFacets: true },
    });
  });

  it('ignores a malformed saved value', () => {
    expect(chosenAuxLinesAreFacets({ [SIMULATION_EXTENSION_KEY]: 'yes' })).toBeNull();
    expect(chosenAuxLinesAreFacets({ [SIMULATION_EXTENSION_KEY]: { auxLinesAreFacets: 1 } })).toBeNull();
  });
});

describe('foldTextStatingAuxLines', () => {
  it('leaves a file that already says the same exactly as it was', () => {
    const text = JSON.stringify(fold({ file_creator: 'oriedita' }));
    expect(foldTextStatingAuxLines(text, false)).toBe(text);
  });

  it('states a choice the file would otherwise contradict, so a round trip keeps it', () => {
    const facets = foldTextStatingAuxLines(JSON.stringify(fold({ file_creator: 'oriedita' })), true);
    expect(foldAuxLinesAreFacets(JSON.parse(facets) as FoldDocument)).toBe(true);

    const drawn = foldTextStatingAuxLines(
      JSON.stringify(fold({ file_creator: 'Origami Simulator' })),
      false
    );
    expect(foldAuxLinesAreFacets(JSON.parse(drawn) as FoldDocument)).toBe(false);
  });
});
