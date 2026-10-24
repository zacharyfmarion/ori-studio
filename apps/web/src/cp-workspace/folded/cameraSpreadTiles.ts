type XY = readonly [number, number];

/** Conservative triangle/rectangle separating-axis test after the bounds test. */
export function triangleTouchesTile(a: XY, b: XY, c: XY, x: number, y: number, size: number): boolean {
  const sign = Math.sign((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
  return edgeReachesTile(a,b,sign,x,y,size) && edgeReachesTile(b,c,sign,x,y,size) && edgeReachesTile(c,a,sign,x,y,size);
}

function edgeReachesTile(p: XY, q: XY, sign: number, x: number, y: number, size: number): boolean {
  const dx=sign*(q[0]-p[0]),dy=sign*(q[1]-p[1]);
  const max=dx*(y-p[1])-dy*(x-p[0])+Math.max(0,dx*size)+Math.max(0,-dy*size);
  return max >= -1e-5;
}
