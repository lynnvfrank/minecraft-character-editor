/**
 * Registry for 3D thumbnail capture. Main.ts registers the implementation
 * to avoid circular dependency with creator.
 */

export type Capture3DThumbnailFn = (size?: number) => Promise<string | null>;

let captureFn: Capture3DThumbnailFn | null = null;

export function registerCapture3DThumbnail(fn: Capture3DThumbnailFn): void {
  captureFn = fn;
}

export function getCapture3DThumbnail(): Capture3DThumbnailFn | null {
  return captureFn;
}
