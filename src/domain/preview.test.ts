import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { placeAroundCharacter } from './preview';

const close = (a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) =>
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < 1e-9, `${JSON.stringify(a)} != ${JSON.stringify(b)}`);

describe('placeAroundCharacter', () => {
  // A preset camera in front of a character at the origin facing +Z.
  const camera = { x: 0, y: 1.5, z: 3 };

  test('a character at the origin facing +Z keeps the preset as authored', () => {
    close(placeAroundCharacter(camera, { x: 0, y: 0, z: 0, yaw: 0 }), camera);
  });

  test('moves with the character', () => {
    close(placeAroundCharacter(camera, { x: 5, y: 0, z: -2, yaw: 0 }), { x: 5, y: 1.5, z: 1 });
  });

  test('turns with the character so the camera stays in front of its face', () => {
    // Facing +X (yaw 90°): the camera should be on the +X side.
    close(placeAroundCharacter(camera, { x: 0, y: 0, z: 0, yaw: Math.PI / 2 }), { x: 3, y: 1.5, z: 0 });
    // Facing −Z (turned around): the camera goes behind the origin, i.e. still in front of the face.
    close(placeAroundCharacter(camera, { x: 1, y: 0, z: 1, yaw: Math.PI }), { x: 1, y: 1.5, z: -2 });
  });
});
