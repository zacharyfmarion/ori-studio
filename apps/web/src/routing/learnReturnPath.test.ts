import { beforeEach, describe, expect, it } from 'vitest';
import {
  learnReturnPath,
  rememberLearnPath,
  resetLearnReturnPathForTest,
} from './learnReturnPath';
import { LEARN_PATH } from './paths';

/**
 * The Learn rail button returns to the lesson or course last open. Without it,
 * stepping out to the Edit workspace mid-lesson and pressing Learn again landed
 * on the catalog, throwing away where the reader was.
 */
describe('learn return path', () => {
  beforeEach(() => resetLearnReturnPathForTest());

  it('is the catalog before the tutorial has been visited', () => {
    expect(learnReturnPath()).toBe(LEARN_PATH);
  });

  it('remembers a lesson, a course, and the catalog itself', () => {
    rememberLearnPath('/learn/basics/first-crease');
    expect(learnReturnPath()).toBe('/learn/basics/first-crease');

    rememberLearnPath('/learn/basics');
    expect(learnReturnPath()).toBe('/learn/basics');

    // Going deliberately back to the catalog is also a place to return to —
    // otherwise the button would keep reopening a lesson the reader just left.
    rememberLearnPath(LEARN_PATH);
    expect(learnReturnPath()).toBe(LEARN_PATH);
  });

  /**
   * The recorder sees every route the app visits, so it has to ignore the ones
   * that are not the tutorial — otherwise pressing Learn would navigate to
   * whatever workspace the reader wandered through last.
   */
  it('ignores paths outside the tutorial', () => {
    rememberLearnPath('/learn/basics/first-crease');
    rememberLearnPath('/edit');
    rememberLearnPath('/design/treemaker');
    rememberLearnPath('/welcome');
    expect(learnReturnPath()).toBe('/learn/basics/first-crease');
  });

  /** `/learnt-something` starts with the same letters but is not a learn path. */
  it('does not mistake a path that merely shares the prefix', () => {
    rememberLearnPath('/learnt-something');
    expect(learnReturnPath()).toBe(LEARN_PATH);
  });
});
