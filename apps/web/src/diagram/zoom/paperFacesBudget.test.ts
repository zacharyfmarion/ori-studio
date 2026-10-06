import { describe, expect, it } from 'vitest';
import { createDiagram, insertSteps } from '../document/diagramDocument';
import { writeDiagram } from '../document/diagramFile';
import imprints from './__fixtures__/zoomImprint.json';
import { craneStep } from './zoom.fixtures';

/**
 * What a flat capture's faces cost in the file (Revision 2, "The budget").
 *
 * Zach's decision (2026-10-06): every flat step keeps its faces, and the
 * budget is the whole file's — with every flat step refreshed, the `.osf`
 * grows by at most 1% — in place of a cap per step. The whole file is weighed
 * on his diagrams by `artifacts/revision-2/16c/paperFacesBudget.mjs`, which
 * refolds every flat step in the app and writes the file as the app does:
 * crane +0.84%, heart +0.67%, chipmunk +0.18%, Reference Diagrams +0.26%.
 * Those diagrams are not committed, so no test here can open them.
 *
 * What this holds, over 16.0's captures of the crane, is what that budget
 * rests on: a step's faces add to the file their compact string and nothing
 * more (written as a value, pretty-printed, they would be a line per number:
 * 126 kB on the crane instead of 20.6), and they cost the same however the
 * picture is spread, so a file grows by its folds, not by its pictures. It
 * keeps reporting the measure the per-step cap was — each capture's faces
 * against its scene — which passes 1 with no spread (the stored scene drops
 * the faces it hides; the faces keep every one), as the whole-file budget
 * allows.
 */
const captures = imprints.captures as Record<string, { sceneJson: string; paperFaces: string; spread: unknown }>;
const keys = Object.keys(captures);

/** Bytes as the project file writes a string: JSON-escaped, UTF-8. */
const inFile = (text: string) => new TextEncoder().encode(JSON.stringify(text)).length;

/** A diagram of every capture, written as the app writes a project file: pretty-printed. */
const written = (faces: boolean) => {
  const steps = keys.map((key) => craneStep(key, { faces }));
  const diagram = insertSteps(createDiagram({ title: 'Crane' }), steps, 0);
  return new TextEncoder().encode(JSON.stringify({ workspace: { diagram: writeDiagram(diagram) } }, null, 2)).length;
};

describe('the faces’ size budget: the file grows by its faces’ compact strings, one per flat step', () => {
  it('adds each step’s faces as one string — its bytes and one line — never a value written a number to a line', () => {
    const faces = keys.reduce((sum, key) => sum + inFile(captures[key]!.paperFaces), 0);
    const grown = written(true) - written(false);
    expect(grown).toBeGreaterThanOrEqual(faces);
    // The key, its indent and a comma per step.
    expect(grown - faces).toBeLessThanOrEqual(64 * keys.length);
  });

  it('costs the same however the picture is spread: the faces are the fold’s', () => {
    for (const fold of ['S', 'C', 'R21']) {
      const sizes = ['none', 'affine', 'depth'].map((spread) => inFile(captures[`${fold}.${spread}`]!.paperFaces));
      expect(new Set(sizes).size, fold).toBe(1);
    }
  });

  it('reports each capture’s faces against its scene, as the file writes them (16c: 0.24–0.26 spread, 1.35–1.45 not)', () => {
    const rows = keys.map((key) => {
      const { sceneJson, paperFaces, spread } = captures[key]!;
      return { key, spread: spread !== null, faces: inFile(paperFaces), scene: inFile(sceneJson), ratio: inFile(paperFaces) / inFile(sceneJson) };
    });
    console.log(
      `paperFaces / sceneJson, as the file writes them: ${rows.map((row) => `${row.key} ${row.faces}/${row.scene} = ${row.ratio.toFixed(3)}`).join('; ')}`
    );
    expect(rows.filter((row) => row.spread).length).toBeGreaterThanOrEqual(6);
    expect(rows.filter((row) => !row.spread).length).toBeGreaterThanOrEqual(3);
    for (const row of rows) expect(row.ratio, row.key).toBeGreaterThan(0);
  });
});
