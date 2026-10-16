import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NATIVE_PROJECT_READER_VERSION, parseNativeProjectFile } from '../../lib/nativeProjectFile';
import { stepsOf } from '../document/diagramDocument';
import { readDiagram } from '../document/diagramFile';

/**
 * The example the empty Diagram opens, as this build reads it. A file saved by
 * a newer build would open read-only, or with steps locked, which is no way to
 * meet diagrams for the first time — so whoever replaces the file finds out
 * here, not from someone who pressed the button.
 */
const text = readFileSync(
  resolve(__dirname, '../../../public/examples/Crane.osf'),
  'utf8'
);

describe('the Diagram’s example', () => {
  const project = parseNativeProjectFile(text);
  const [diagram, ...others] = project.workspace.diagrams ?? [];

  it('is a crease pattern and one diagram this build reads', () => {
    expect(project.minimumReaderSchemaVersion).toBeLessThanOrEqual(NATIVE_PROJECT_READER_VERSION);
    // The project's name is its title, not its file's name: what the title bar says.
    expect(project.workspace.title).toBe('Crane');
    expect(project.workspace.creasePattern).not.toBeNull();
    expect(project.workspace.designs).toEqual([]);
    expect(diagram).toBeDefined();
    expect(others).toEqual([]);
  });

  it('opens editable, with nothing in it from a newer build', () => {
    const read = readDiagram(diagram);
    expect(read).not.toBeNull();
    expect(read?.readOnly).toBe(false);
    expect(read?.document.newer).toBeUndefined();
    expect(read?.document.steps.filter((entry) => 'unknown' in entry)).toEqual([]);
    expect(Object.values(read?.document.assets ?? {}).filter((asset) => 'unknown' in asset)).toEqual([]);
  });

  it('is a finished diagram: steps with words, on pages under a title block', () => {
    const document = readDiagram(diagram)?.document;
    const steps = document ? stepsOf(document) : [];
    expect(steps.length).toBeGreaterThan(20);
    expect(steps.every((step) => step.text.trim().length > 0)).toBe(true);
    expect(document?.title).toBe('Crane');
    expect(document?.page.titleBlock?.enabled).toBe(true);
    expect(document?.titleBlockContent?.subtitle).toBeTruthy();
  });
});
