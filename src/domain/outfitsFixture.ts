/**
 * Test helper (not used by the app): a data URL that passes as a PNG of the given size.
 * Only the header is real; `seed` makes the images differ.
 */
export function fakeSkinDataUrl(seed = 0, width = 64, height = 64, extraBytes = 60): string {
  const bytes = Buffer.alloc(33 + extraBytes, seed % 251);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'latin1');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes.writeUInt32BE(seed >>> 0, 29);
  return `data:image/png;base64,${bytes.toString('base64')}`;
}
