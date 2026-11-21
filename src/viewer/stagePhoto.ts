/**
 * Stage photo: the scene exactly as the main camera frames it, at the canvas's pixel size,
 * returned as a 2D canvas (ready for `toBlob`). Everything happens synchronously inside one call,
 * so the main renderer needs neither `preserveDrawingBuffer` nor `alpha`.
 *
 * - Opaque: render one frame to the screen and copy the WebGL canvas in the same tick.
 * - Transparent: the main renderer has no alpha channel, so the scene is rendered into an
 *   offscreen render target with the background and ground hidden and a clear alpha of 0. A render
 *   target skips the renderer's tone mapping and sRGB encoding, so a second full-screen pass
 *   applies both (same shader chunks as three's OutputPass) and un-premultiplies the edges; the
 *   result is read back and flipped. All renderer/scene state is restored before returning.
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/examples/jsm/postprocessing/Pass.js';
import { flipPixelRows } from './captureHelpers';

export type StagePhotoContext = {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
};

export type StagePhotoOptions = {
  /** Hide the scene background and the ground; the PNG keeps only what stands on the stage. */
  transparent?: boolean;
};

const GROUND_NAME = 'ground';

/** Shader define for each renderer tone mapping (mirrors OutputPass). */
const TONE_MAPPING_DEFINES: Partial<Record<THREE.ToneMapping, string>> = {
  [THREE.LinearToneMapping]: 'LINEAR_TONE_MAPPING',
  [THREE.ReinhardToneMapping]: 'REINHARD_TONE_MAPPING',
  [THREE.CineonToneMapping]: 'CINEON_TONE_MAPPING',
  [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING',
  [THREE.AgXToneMapping]: 'AGX_TONE_MAPPING',
  [THREE.NeutralToneMapping]: 'NEUTRAL_TONE_MAPPING',
};

const OUTPUT_VERTEX = /* glsl */ `
  precision highp float;
  uniform mat4 modelViewMatrix;
  uniform mat4 projectionMatrix;
  attribute vec3 position;
  attribute vec2 uv;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
  }`;

// Like three's OutputShader, plus: colour is un-premultiplied before tone mapping (antialiased
// edges against the alpha-0 clear are premultiplied) and written with straight alpha for PNG.
const OUTPUT_FRAGMENT = /* glsl */ `
  precision highp float;
  uniform sampler2D tDiffuse;
  #include <tonemapping_pars_fragment>
  #include <colorspace_pars_fragment>
  varying vec2 vUv;
  void main() {
    vec4 texel = texture2D( tDiffuse, vUv );
    float alpha = clamp( texel.a, 0.0, 1.0 );
    vec3 color = alpha > 0.0 ? texel.rgb / alpha : vec3( 0.0 );
    #ifdef LINEAR_TONE_MAPPING
      color = LinearToneMapping( color );
    #elif defined( REINHARD_TONE_MAPPING )
      color = ReinhardToneMapping( color );
    #elif defined( CINEON_TONE_MAPPING )
      color = OptimizedCineonToneMapping( color );
    #elif defined( ACES_FILMIC_TONE_MAPPING )
      color = ACESFilmicToneMapping( color );
    #elif defined( AGX_TONE_MAPPING )
      color = AgXToneMapping( color );
    #elif defined( NEUTRAL_TONE_MAPPING )
      color = NeutralToneMapping( color );
    #endif
    gl_FragColor = vec4( clamp( color, 0.0, 1.0 ), alpha );
    #ifdef SRGB_TRANSFER
      gl_FragColor = sRGBTransferOETF( gl_FragColor );
    #endif
  }`;

function newCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  return ctx ? { canvas, ctx } : null;
}

function captureOpaque({ scene, camera, renderer }: StagePhotoContext): HTMLCanvasElement | null {
  const source = renderer.domElement;
  const out = newCanvas(source.width, source.height);
  if (!out) return null;
  // Render and copy in the same tick: the drawing buffer is still intact until we yield.
  renderer.render(scene, camera);
  out.ctx.drawImage(source, 0, 0);
  return out.canvas;
}

function captureTransparent({ scene, camera, renderer }: StagePhotoContext): HTMLCanvasElement | null {
  const width = renderer.domElement.width;
  const height = renderer.domElement.height;
  const out = newCanvas(width, height);
  if (!out) return null;

  // Half-float keeps highlights above 1.0 for the tone mapper; fall back to 8-bit without it.
  const hdr = renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float');
  const sceneTarget = new THREE.WebGLRenderTarget(width, height, {
    type: hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
    samples: 4,
  });
  const outputTarget = new THREE.WebGLRenderTarget(width, height);

  const defines: Record<string, string> = {};
  const toneDefine = TONE_MAPPING_DEFINES[renderer.toneMapping];
  if (toneDefine) defines[toneDefine] = '';
  if (THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer) defines.SRGB_TRANSFER = '';
  const material = new THREE.RawShaderMaterial({
    name: 'StagePhotoOutput',
    uniforms: {
      tDiffuse: { value: sceneTarget.texture },
      toneMappingExposure: { value: renderer.toneMappingExposure },
    },
    defines,
    vertexShader: OUTPUT_VERTEX,
    fragmentShader: OUTPUT_FRAGMENT,
    blending: THREE.NoBlending,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new FullScreenQuad(material);

  // Everything we change, saved so it can be put back exactly.
  const ground = scene.getObjectByName(GROUND_NAME);
  const groundWas = ground?.visible;
  const backgroundWas = scene.background;
  const clearColorWas = renderer.getClearColor(new THREE.Color());
  const clearAlphaWas = renderer.getClearAlpha();
  const targetWas = renderer.getRenderTarget();
  const pixels = new Uint8Array(width * height * 4);

  try {
    if (ground) ground.visible = false;
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(sceneTarget);
    renderer.clear();
    renderer.render(scene, camera);

    renderer.setRenderTarget(outputTarget);
    renderer.clear();
    quad.render(renderer);
    renderer.readRenderTargetPixels(outputTarget, 0, 0, width, height, pixels);
  } finally {
    renderer.setRenderTarget(targetWas);
    renderer.setClearColor(clearColorWas, clearAlphaWas);
    scene.background = backgroundWas;
    if (ground && groundWas !== undefined) ground.visible = groundWas;
    quad.dispose();
    material.dispose();
    sceneTarget.dispose();
    outputTarget.dispose();
  }

  const image = out.ctx.createImageData(width, height);
  image.data.set(flipPixelRows(pixels, width, height));
  out.ctx.putImageData(image, 0, 0);
  return out.canvas;
}

/** Take a photo of the stage as currently framed. Returns null if a 2D canvas can't be created. */
export function captureStagePhoto(ctx: StagePhotoContext, options: StagePhotoOptions = {}): HTMLCanvasElement | null {
  return options.transparent ? captureTransparent(ctx) : captureOpaque(ctx);
}
