import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { LEARN_PATH } from './paths';

/**
 * Where the Learn rail button goes back to.
 *
 * The other rail buttons have one path each, except Design, which returns to its
 * active variant so an in-progress design is not bounced back to the method
 * chooser. Learn has the same problem one level deeper: leaving a lesson for the
 * Edit workspace and pressing Learn again would land on the catalog, throwing
 * away the lesson the reader was halfway through.
 *
 * Module state rather than the tutorial store, and deliberately not persisted:
 * this is where the reader *was*, which is a fact about this session's
 * navigation, not progress through the content. Progress has its own persisted
 * resume (`lastCourseId` / `resumeByCourse`), so a fresh load still opens the
 * catalog — with a Resume button on it — rather than dropping someone straight
 * back into a lesson they may have finished with.
 */
let lastLearnPath: string | null = null;

/** The remembered tutorial path, or the catalog if none has been visited. */
export function learnReturnPath(): string {
  return lastLearnPath ?? LEARN_PATH;
}

export function rememberLearnPath(pathname: string): void {
  if (pathname === LEARN_PATH || pathname.startsWith(`${LEARN_PATH}/`)) {
    lastLearnPath = pathname;
  }
}

/** Test seam: forget the remembered path. */
export function resetLearnReturnPathForTest(): void {
  lastLearnPath = null;
}

/**
 * Record every tutorial path the app visits. Mounted once in the shell rather
 * than in each of the three learn routes, so there is one rule for what counts
 * and no way for the routes to drift apart on it.
 */
export function useRememberLearnPath(): void {
  const { pathname } = useLocation();
  useEffect(() => rememberLearnPath(pathname), [pathname]);
}
