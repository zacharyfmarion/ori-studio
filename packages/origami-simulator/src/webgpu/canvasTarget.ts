/// <reference types="@webgpu/types" />
// A canvas as a WebGPU render target: the counterpart of the default
// framebuffer a WebGL context draws to.
//
// A canvas holds one context of one kind, configured for one device, so every
// solver and figure that draws to the same canvas shares one of these and one
// GpuCore, as the WebGL2 path shares one context per canvas.
import type { GpuCore } from './gpuCore.js';
import type { WebgpuRenderTarget } from './meshRenderer.js';

export class WebgpuCanvasTarget {
  readonly format: GPUTextureFormat;
  private readonly context: GPUCanvasContext;

  private constructor(
    readonly canvas: HTMLCanvasElement | OffscreenCanvas,
    context: GPUCanvasContext,
    format: GPUTextureFormat
  ) {
    this.context = context;
    this.format = format;
  }

  /**
   * Configure `canvas` for `core`'s device, or null when the canvas already
   * holds a context of another kind (a WebGL one) and so cannot take this one.
   */
  static create(canvas: HTMLCanvasElement | OffscreenCanvas, core: GpuCore): WebgpuCanvasTarget | null {
    const context = canvas.getContext('webgpu') as GPUCanvasContext | null;
    if (!context) return null;
    const format = navigator.gpu.getPreferredCanvasFormat();
    // Premultiplied, so a transparent background (an inline window over the
    // crease pattern) composites as nothing rather than as black.
    context.configure({ device: core.device, format, alphaMode: 'premultiplied' });
    return new WebgpuCanvasTarget(canvas, context, format);
  }

  /** The size frames are drawn at: the canvas's, clamped to what the device can back. */
  drawingBufferSize(core: GpuCore): { width: number; height: number } {
    const limit = core.device.limits.maxTextureDimension2D;
    return { width: Math.min(this.canvas.width, limit), height: Math.min(this.canvas.height, limit) };
  }

  /** This frame's texture. A new one each frame, presented when the frame is snapshotted or composited. */
  current(): WebgpuRenderTarget {
    const texture = this.context.getCurrentTexture();
    return { view: texture.createView(), width: texture.width, height: texture.height, format: this.format };
  }

  dispose(): void {
    this.context.unconfigure();
  }
}
