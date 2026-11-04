import type { LayerOrderDialogState } from '../../layer-order/model/layerOrderState';

/**
 * The inspector's parts that read the model but not the pane hover
 * (`hover.face`): two renders of one are the same when nothing but the face
 * pointed at changed. A pane hover changes that alone, at pointer rate, and
 * on a large figure re-rendering the whole column for it is most of a frame
 * (U10's review). The model is immutable, so a field's identity says whether
 * it changed.
 */
export function samePastPaneHover<P extends { readonly state: LayerOrderDialogState }>(a: Readonly<P>, b: Readonly<P>): boolean {
  for (const key of Object.keys(a) as (keyof P)[]) {
    if (key !== 'state' && a[key] !== b[key]) return false;
  }
  if (Object.keys(a).length !== Object.keys(b).length) return false;
  if (a.state === b.state) return true;
  for (const key of Object.keys(a.state) as (keyof LayerOrderDialogState)[]) {
    if (key === 'hover') continue;
    if (a.state[key] !== b.state[key]) return false;
  }
  const [x, y] = [a.state.hover, b.state.hover];
  return x.slot === y.slot && x.row === y.row && x.reason === y.reason;
}
