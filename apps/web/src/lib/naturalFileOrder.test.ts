import { describe, expect, it } from 'vitest';
import { naturalFileOrder } from './naturalFileOrder';

const named = (...names: string[]) => names.map((name) => ({ name }));
const names = (files: readonly { name: string }[]) => files.map((file) => file.name);

describe('naturalFileOrder', () => {
  it('reads the numbers in names as numbers: step-2 before step-10', () => {
    expect(names(naturalFileOrder(named('step-10.svg', 'step-2.svg', 'Step-1.svg')))).toEqual([
      'Step-1.svg',
      'step-2.svg',
      'step-10.svg',
    ]);
  });

  it('orders bare numbers, with or without leading zeros', () => {
    expect(names(naturalFileOrder(named('10.cp', '9.cp', '25.cp', '7.cp', '08.cp')))).toEqual([
      '7.cp',
      '08.cp',
      '9.cp',
      '10.cp',
      '25.cp',
    ]);
  });

  it('keeps repeated names in the order they came in, and leaves its input alone', () => {
    const files = [{ name: '10.cp' }, { name: '2.cp' }, { name: '2.cp' }, { name: '1.cp' }];
    expect(naturalFileOrder(files)).toEqual([files[3], files[1], files[2], files[0]]);
    expect(names(files)).toEqual(['10.cp', '2.cp', '2.cp', '1.cp']);
  });

  it('gives names that differ only in case one order, whichever came first', () => {
    expect(names(naturalFileOrder(named('crane.cp', 'Crane.cp')))).toEqual(
      names(naturalFileOrder(named('Crane.cp', 'crane.cp')))
    );
  });

  it('orders names without numbers alphabetically', () => {
    expect(names(naturalFileOrder(named('frog.fold', 'Crane.cp', 'base.ori')))).toEqual([
      'base.ori',
      'Crane.cp',
      'frog.fold',
    ]);
  });
});
