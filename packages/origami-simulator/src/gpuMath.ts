export class GpuMath {
  readonly gl: WebGL2RenderingContext | WebGLRenderingContext;
  private programs = new Map<
    string,
    { program: WebGLProgram; uniforms: Map<string, WebGLUniformLocation | null> }
  >();
  private textures = new Map<string, WebGLTexture>();
  private framebuffers = new Map<string, WebGLFramebuffer>();
  private currentProgram: WebGLProgram | null = null;

  constructor(gl: WebGL2RenderingContext | WebGLRenderingContext) {
    this.gl = gl;
  }

  static fromCanvas(canvas: HTMLCanvasElement | OffscreenCanvas): GpuMath | null {
    const gl =
      canvas.getContext('webgl2') ??
      canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
    return gl ? new GpuMath(gl as WebGL2RenderingContext | WebGLRenderingContext) : null;
  }

  compileProgram(name: string, vertexSource: string, fragmentSource: string): WebGLProgram {
    const vertex = this.compileShader(this.gl.VERTEX_SHADER, vertexSource);
    const fragment = this.compileShader(this.gl.FRAGMENT_SHADER, fragmentSource);
    const program = this.gl.createProgram();
    if (!program) throw new Error('Unable to create WebGL program');
    this.gl.attachShader(program, vertex);
    this.gl.attachShader(program, fragment);
    this.gl.linkProgram(program);
    if (!this.gl.getProgramParameter(program, this.gl.LINK_STATUS)) {
      const info = this.gl.getProgramInfoLog(program) ?? 'unknown WebGL link error';
      this.gl.deleteProgram(program);
      throw new Error(info);
    }
    this.programs.set(name, { program, uniforms: new Map() });
    return program;
  }

  initTextureFromData(
    name: string,
    width: number,
    height: number,
    typeName: 'FLOAT' | 'UNSIGNED_BYTE',
    data: Float32Array | Uint8Array | null,
    replace = true,
  ): WebGLTexture {
    const existing = this.textures.get(name);
    if (existing) {
      if (!replace) return existing;
      this.gl.deleteTexture(existing);
      this.textures.delete(name);
    }

    if (typeName === 'FLOAT') {
      this.ensureFloatTextureSupport();
    }

    const texture = this.gl.createTexture();
    if (!texture) throw new Error(`Unable to create WebGL texture ${name}`);
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_S, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_WRAP_T, this.gl.CLAMP_TO_EDGE);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MIN_FILTER, this.gl.NEAREST);
    this.gl.texParameteri(this.gl.TEXTURE_2D, this.gl.TEXTURE_MAG_FILTER, this.gl.NEAREST);
    this.gl.texImage2D(
      this.gl.TEXTURE_2D,
      0,
      this.gl.RGBA,
      width,
      height,
      0,
      this.gl.RGBA,
      typeName === 'FLOAT' ? this.gl.FLOAT : this.gl.UNSIGNED_BYTE,
      data,
    );
    this.textures.set(name, texture);
    return texture;
  }

  initFramebufferForTexture(name: string, textureName = name, replace = true): WebGLFramebuffer {
    const existing = this.framebuffers.get(name);
    if (existing) {
      if (!replace) return existing;
      this.gl.deleteFramebuffer(existing);
      this.framebuffers.delete(name);
    }

    const texture = this.textures.get(textureName);
    if (!texture) throw new Error(`Texture ${textureName} does not exist`);

    const framebuffer = this.gl.createFramebuffer();
    if (!framebuffer) throw new Error(`Unable to create WebGL framebuffer ${name}`);
    this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
    this.gl.framebufferTexture2D(
      this.gl.FRAMEBUFFER,
      this.gl.COLOR_ATTACHMENT0,
      this.gl.TEXTURE_2D,
      texture,
      0,
    );
    if (this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER) !== this.gl.FRAMEBUFFER_COMPLETE) {
      this.gl.deleteFramebuffer(framebuffer);
      throw new Error(`Framebuffer ${name} is incomplete`);
    }
    this.framebuffers.set(name, framebuffer);
    return framebuffer;
  }

  setProgram(name: string): WebGLProgram {
    const record = this.programs.get(name);
    if (!record) throw new Error(`Unknown WebGL program ${name}`);
    this.gl.useProgram(record.program);
    this.currentProgram = record.program;
    return record.program;
  }

  setUniformForProgram(
    programName: string,
    name: string,
    value: number | [number, number] | [number, number, number],
    type: '1f' | '2f' | '3f' | '1i',
  ): void {
    const record = this.programs.get(programName);
    if (!record) throw new Error(`Unknown WebGL program ${programName}`);
    this.gl.useProgram(record.program);
    let location = record.uniforms.get(name);
    if (location === undefined) {
      location = this.gl.getUniformLocation(record.program, name);
      record.uniforms.set(name, location);
    }
    if (type === '1f') this.gl.uniform1f(location, value as number);
    else if (type === '1i') this.gl.uniform1i(location, value as number);
    else if (type === '2f') this.gl.uniform2f(location, ...(value as [number, number]));
    else this.gl.uniform3f(location, ...(value as [number, number, number]));
  }

  setSize(width: number, height: number): void {
    this.gl.viewport(0, 0, width, height);
  }

  step(programName: string, inputTextures: string[], outputFramebuffer?: string): void {
    this.setProgram(programName);
    if (outputFramebuffer) {
      const framebuffer = this.framebuffers.get(outputFramebuffer);
      if (!framebuffer) throw new Error(`Unknown WebGL framebuffer ${outputFramebuffer}`);
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, framebuffer);
    } else {
      this.gl.bindFramebuffer(this.gl.FRAMEBUFFER, null);
    }

    inputTextures.forEach((textureName, index) => {
      const texture = this.textures.get(textureName);
      if (!texture) throw new Error(`Unknown WebGL texture ${textureName}`);
      this.gl.activeTexture(this.gl.TEXTURE0 + index);
      this.gl.bindTexture(this.gl.TEXTURE_2D, texture);
    });
    this.gl.drawArrays(this.gl.TRIANGLE_STRIP, 0, 4);
  }

  swapTextures(textureA: string, textureB: string): void {
    const a = this.textures.get(textureA);
    const b = this.textures.get(textureB);
    if (!a || !b) throw new Error(`Cannot swap missing textures ${textureA} and ${textureB}`);
    this.textures.set(textureA, b);
    this.textures.set(textureB, a);

    const framebufferA = this.framebuffers.get(textureA);
    const framebufferB = this.framebuffers.get(textureB);
    if (framebufferA && framebufferB) {
      this.framebuffers.set(textureA, framebufferB);
      this.framebuffers.set(textureB, framebufferA);
    }
  }

  readyToRead(): boolean {
    return this.gl.checkFramebufferStatus(this.gl.FRAMEBUFFER) === this.gl.FRAMEBUFFER_COMPLETE;
  }

  readPixels(x: number, y: number, width: number, height: number, target: Uint8Array): void {
    this.gl.readPixels(x, y, width, height, this.gl.RGBA, this.gl.UNSIGNED_BYTE, target);
  }

  clear(red = 1, green = 1, blue = 1, alpha = 1): void {
    this.gl.clearColor(red, green, blue, alpha);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT | this.gl.DEPTH_BUFFER_BIT);
  }

  dispose(): void {
    for (const record of this.programs.values()) {
      this.gl.deleteProgram(record.program);
    }
    for (const texture of this.textures.values()) {
      this.gl.deleteTexture(texture);
    }
    for (const framebuffer of this.framebuffers.values()) {
      this.gl.deleteFramebuffer(framebuffer);
    }
    this.programs.clear();
    this.textures.clear();
    this.framebuffers.clear();
    this.currentProgram = null;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) throw new Error('Unable to create WebGL shader');
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const info = this.gl.getShaderInfoLog(shader) ?? 'unknown WebGL compile error';
      this.gl.deleteShader(shader);
      throw new Error(info);
    }
    return shader;
  }

  private ensureFloatTextureSupport(): void {
    if ('texStorage2D' in this.gl) return;
    const extension = this.gl.getExtension('OES_texture_float');
    if (!extension) throw new Error('Floating point textures are not supported');
  }
}

export function detectWebGlSupport(): boolean {
  if (typeof document === 'undefined') return false;
  const canvas = document.createElement('canvas');
  return Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
}
