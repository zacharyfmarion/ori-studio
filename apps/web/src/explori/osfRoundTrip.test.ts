import { describe, expect, it } from 'vitest';
import {
  createNativeProjectFile,
  parseNativeProjectFile,
  serializeNativeProjectFile,
} from '../lib/nativeProjectFile';
import { createExploriDocument, serializeExploriDocument } from './document';

/**
 * How an ExplOri design survives a `.osf` file — including a file read by a
 * build that has never heard of the kind.
 *
 * The second case is the one worth testing rather than assuming. `validateV8`
 * matches a design's `payload.kind` against the **design-kind registry**, so an
 * older build meets an ExplOri design as an unknown kind. If that dropped it,
 * opening and re-saving a project on an older version would silently delete a
 * design; the machinery to carry it through exists, and this is the check that
 * it actually does.
 */

function exploriProject(text: string) {
  return createNativeProjectFile({
    designs: [{ id: 'design-1', title: 'Search', kind: 'explori', text, format: 'explori-json' }],
    workspaceTitle: 'Untitled',
    filename: 'project.osf',
    path: null,
    creasePattern: null,
    appVersion: '0.0.0-test',
    now: new Date('2026-08-06T00:00:00.000Z'),
  });
}

describe('an ExplOri design in a .osf file', () => {
  it('round-trips its document text unchanged', () => {
    const text = serializeExploriDocument({
      ...createExploriDocument(),
      nodes: [
        { id: 0, loc: { x: 0, y: 0 }, name: '' },
        { id: 1, loc: { x: 0, y: 2.5 }, name: 'head' },
      ],
      edges: [{ id: 1, vertices: [0, 1], length: 2.5 }],
    });
    const reopened = parseNativeProjectFile(serializeNativeProjectFile(exploriProject(text)));
    expect(reopened.workspace.designs).toHaveLength(1);
    expect(reopened.workspace.designs[0].payload.kind).toBe('explori');
    expect(reopened.workspace.designs[0].payload.text).toBe(text);
  });

  it('needs no new reader floor, because one design still reads as one design', () => {
    // `minimumReaderSchemaVersion` is what refuses a file to an older build. A
    // single ExplOri design does not need that: an older build carries it
    // through as an unknown kind (below), which is better than a refusal.
    expect(exploriProject('{}').minimumReaderSchemaVersion).toBe(1);
  });
});

describe('a build that has never heard of the kind', () => {
  /**
   * The registry is a module-level constant, so "an older build" is simulated by
   * writing a design whose kind no build has — which is exactly the position an
   * older build is in with respect to `explori`.
   */
  const written = serializeNativeProjectFile(
    createNativeProjectFile({
      designs: [
        { id: 'design-1', title: 'Known', kind: 'treemaker', text: 'tmd5-text', format: 'tmd5' },
      ],
      workspaceTitle: 'Untitled',
      filename: 'project.osf',
      path: null,
      unknownDesigns: [
        {
          id: 'design-2',
          title: 'From a newer build',
          payload: { kind: 'some-future-kind', text: 'opaque', format: 'future' },
          viewState: {},
          extensions: {},
        },
      ],
      creasePattern: null,
      appVersion: '0.0.0-test',
      now: new Date('2026-08-06T00:00:00.000Z'),
    }),
  );

  it('opens the file and keeps the designs it understands', () => {
    const reopened = parseNativeProjectFile(written);
    expect(reopened.workspace.designs).toHaveLength(1);
    expect(reopened.workspace.designs[0].payload.kind).toBe('treemaker');
  });

  it('carries the unrecognized design through verbatim', () => {
    const reopened = parseNativeProjectFile(written);
    expect(reopened.workspace.unknownDesigns).toHaveLength(1);
    expect(reopened.workspace.unknownDesigns[0]).toMatchObject({
      id: 'design-2',
      payload: { kind: 'some-future-kind', text: 'opaque' },
    });
  });

  it('re-emits it on save, so a round trip through that build loses nothing', () => {
    const reopened = parseNativeProjectFile(written);
    const resaved = parseNativeProjectFile(
      serializeNativeProjectFile(
        createNativeProjectFile({
          designs: reopened.workspace.designs.map((design) => ({
            id: design.id,
            title: design.title,
            kind: design.payload.kind,
            text: design.payload.text,
            format: design.payload.format,
          })),
          unknownDesigns: reopened.workspace.unknownDesigns,
          workspaceTitle: 'Untitled',
          filename: 'project.osf',
          path: null,
          creasePattern: null,
          appVersion: '0.0.0-test',
          now: new Date('2026-08-06T00:00:00.000Z'),
        }),
      ),
    );
    expect(resaved.workspace.unknownDesigns).toEqual(reopened.workspace.unknownDesigns);
    // And the file says so: a project carrying a design this build cannot read
    // is not one an *older* build may quietly rewrite.
    expect(resaved.minimumReaderSchemaVersion).toBe(8);
  });
});
