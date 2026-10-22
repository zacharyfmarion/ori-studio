/** Small per-view rank lookup; leaves the large vertex buffers untouched. */
export function createCameraRankMap(gl: WebGL2RenderingContext, slots: number) {
  const texture = gl.createTexture();
  if (!texture) throw new Error('Could not allocate camera rank map');
  const width = 256,
    height = Math.max(1, Math.ceil(slots / width));
  const data = new Float32Array(width * height);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.activeTexture(gl.TEXTURE0);
  return {
    update(ranks: Float32Array) {
      data.set(ranks);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, height, gl.RED, gl.FLOAT, data);
      gl.activeTexture(gl.TEXTURE0);
    },
    bind() {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.activeTexture(gl.TEXTURE0);
    },
    dispose() {
      gl.deleteTexture(texture);
    },
  };
}
