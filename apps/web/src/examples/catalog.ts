import asymmetricAntler from '../../../../tests/fixtures/generated/asymmetric-antler-optimized.tmd5?raw';
import mirroredFork from '../../../../tests/fixtures/generated/mirrored-fork-optimized.tmd5?raw';
import triad from '../../../../tests/fixtures/generated/triad-optimized.tmd5?raw';
import bpStudioSessionSample from '../../../../tests/fixtures/bp-studio/v04.session.sample.json?raw';
import bpStretchWorkflowSample from '../../../../tests/fixtures/bp-studio/stretch-workflow.sample.json?raw';
import bpValidPackingSample from '../../../../tests/fixtures/bp-studio/valid-packing.sample.json?raw';

export interface ExampleProject {
  id: string;
  title: string;
  meta: string;
  filename: string;
  text: string;
}

export interface BoxPleatExampleProject {
  id: string;
  title: string;
  meta: string;
  filename: string;
  description: string;
  text: string;
}

export const EXAMPLE_PROJECTS: ExampleProject[] = [
  {
    id: 'triad',
    title: 'Three terminal flaps',
    meta: 'Optimized triad | Nodes 4',
    filename: 'triad-optimized.tmd5',
    text: triad,
  },
  {
    id: 'mirrored-fork',
    title: 'Mirrored fork',
    meta: 'Symmetry | Nodes 5',
    filename: 'mirrored-fork-optimized.tmd5',
    text: mirroredFork,
  },
  {
    id: 'asymmetric-antler',
    title: 'Asymmetric antler',
    meta: 'Branching | Nodes 10',
    filename: 'asymmetric-antler-optimized.tmd5',
    text: asymmetricAntler,
  },
];

export function getExampleProject(id: string): ExampleProject | undefined {
  return EXAMPLE_PROJECTS.find((example) => example.id === id);
}

export const BOX_PLEAT_EXAMPLE_PROJECTS: BoxPleatExampleProject[] = [
  {
    id: 'micrathena-sagittata',
    title: 'Micrathena sagittata',
    meta: 'BP Studio sample',
    filename: 'micrathena-sagittata.bps',
    description: 'A migrated Box Pleating Studio project with a full tree and packing.',
    text: bpStudioSessionSample,
  },
  {
    id: 'valid-packing',
    title: 'Valid packing',
    meta: 'BP Studio sample',
    filename: 'valid-packing.bps',
    description: 'A compact project with a valid flap packing.',
    text: bpValidPackingSample,
  },
  {
    id: 'stretch-workflow',
    title: 'Stretch workflow',
    meta: 'BP Studio sample',
    filename: 'stretch-workflow.bps',
    description: 'A layout for manual flap and stretch workflow checks.',
    text: bpStretchWorkflowSample,
  },
];

export function getBoxPleatExampleProject(id: string): BoxPleatExampleProject | undefined {
  return BOX_PLEAT_EXAMPLE_PROJECTS.find((example) => example.id === id);
}
