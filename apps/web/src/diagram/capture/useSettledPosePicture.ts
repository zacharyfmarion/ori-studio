import { useCallback, useEffect, useState } from 'react';
import { ORBIT_SETTLE_MS } from './poseController';

/** Reuse a committed picture once input rests. Neither decoding an image nor a
 * late capture may cover a newer live pose. The viewport stays mounted beneath
 * it, so the next gesture immediately resumes its fast drawing path. */
export function useSettledPosePicture(pose: object, matchingUrl: string | null) {
  const [activity, setActivity] = useState(0);
  const [pressed, setPressed] = useState<ReadonlySet<number>>(() => new Set());
  const [rest, setRest] = useState<{ pose: object; activity: number } | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const wake = useCallback(() => setActivity((was) => was + 1), []);
  const down = useCallback((id: number) => {
    setPressed((was) => new Set([...was, id]));
    wake();
  }, [wake]);
  const up = useCallback((id: number) => {
    setPressed((was) => {
      if (!was.has(id)) return was;
      const next = new Set(was);
      next.delete(id);
      return next;
    });
  }, []);
  useEffect(() => {
    if (pressed.size) return;
    const timer = setTimeout(() => setRest({ pose, activity }), ORBIT_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [pose, activity, pressed]);
  useEffect(() => {
    const blur = () => { setPressed(new Set()); wake(); };
    window.addEventListener('blur', blur);
    return () => window.removeEventListener('blur', blur);
  }, [wake]);
  useEffect(() => {
    if (!matchingUrl) return;
    let current = true;
    const image = new Image();
    // Decoding is asynchronous; do not blank the live canvas while it loads.
    image.src = matchingUrl;
    void image.decode().then(() => { if (current) setLoaded(matchingUrl); }, () => {});
    return () => { current = false; };
  }, [matchingUrl]);
  return {
    url: !pressed.size && rest?.pose === pose && rest.activity === activity && loaded === matchingUrl
      ? matchingUrl : null,
    wake, down, up,
  };
}
