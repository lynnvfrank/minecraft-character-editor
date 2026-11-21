import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  captureFileName,
  extensionForMimeType,
  formatElapsed,
  MAX_RECORDING_MS,
  pickVideoMimeType,
  reachedMaxLength,
  VIDEO_AUDIO_MIME_PREFERENCE,
  VIDEO_MIME_PREFERENCE,
  videoMimePreference,
} from './captureFiles';

describe('pickVideoMimeType', () => {
  test('prefers vp9 webm when everything is supported', () => {
    assert.equal(pickVideoMimeType(() => true), 'video/webm;codecs=vp9');
  });
  test('falls through the list in order', () => {
    assert.equal(pickVideoMimeType((m) => !m.includes('vp9')), 'video/webm;codecs=vp8');
    assert.equal(pickVideoMimeType((m) => !m.includes('codecs')), 'video/webm');
    assert.equal(pickVideoMimeType((m) => m === 'video/mp4'), 'video/mp4');
  });
  test('null when nothing is supported', () => {
    assert.equal(pickVideoMimeType(() => false), null);
  });
  test('a throwing predicate counts as unsupported', () => {
    const picked = pickVideoMimeType((m) => {
      if (m.includes('codecs')) throw new TypeError('bad mime');
      return true;
    });
    assert.equal(picked, 'video/webm');
  });
  test('the preference list ends with mp4', () => {
    assert.equal(VIDEO_MIME_PREFERENCE.at(-1), 'video/mp4');
  });
});

describe('extensionForMimeType', () => {
  test('maps the types we record and save', () => {
    assert.equal(extensionForMimeType('video/webm;codecs=vp9'), 'webm');
    assert.equal(extensionForMimeType('video/webm'), 'webm');
    assert.equal(extensionForMimeType('video/mp4;codecs=avc1.42E01E'), 'mp4');
    assert.equal(extensionForMimeType('VIDEO/MP4'), 'mp4');
    assert.equal(extensionForMimeType('image/png'), 'png');
    assert.equal(extensionForMimeType('video/x-matroska;codecs=avc1'), 'mkv');
  });
  test('unknown or empty types fall back to webm', () => {
    assert.equal(extensionForMimeType(''), 'webm');
    assert.equal(extensionForMimeType('video/whatever'), 'webm');
  });
});

describe('captureFileName', () => {
  test('zero-pads local date and time', () => {
    assert.equal(captureFileName(new Date(2026, 0, 5, 7, 8, 9), 'png'), 'blockygotchi-dance-20260105-070809.png');
    assert.equal(
      captureFileName(new Date(2026, 10, 20, 23, 59, 59), 'webm'),
      'blockygotchi-dance-20261120-235959.webm'
    );
  });
  test('accepts an extension with a leading dot', () => {
    assert.equal(captureFileName(new Date(2026, 5, 1, 0, 0, 0), '.mp4'), 'blockygotchi-dance-20260601-000000.mp4');
  });

  test('takes a prefix for other places (cleaned for a file name)', () => {
    assert.equal(captureFileName(new Date(2026, 0, 5, 7, 8, 9), 'png', 'village'), 'blockygotchi-village-20260105-070809.png');
    assert.equal(captureFileName(new Date(2026, 0, 5, 7, 8, 9), 'png', ' My Village! '), 'blockygotchi-my-village-20260105-070809.png');
    assert.equal(captureFileName(new Date(2026, 0, 5, 7, 8, 9), 'png', '///'), 'blockygotchi-dance-20260105-070809.png');
  });
});

describe('formatElapsed', () => {
  test('m:ss, rounded down', () => {
    assert.equal(formatElapsed(0), '0:00');
    assert.equal(formatElapsed(999), '0:00');
    assert.equal(formatElapsed(7_400), '0:07');
    assert.equal(formatElapsed(60_000), '1:00');
    assert.equal(formatElapsed(125_000), '2:05');
  });
  test('bad input reads as zero', () => {
    assert.equal(formatElapsed(-50), '0:00');
    assert.equal(formatElapsed(NaN), '0:00');
  });
});

describe('reachedMaxLength', () => {
  test('default limit is 60 seconds, inclusive', () => {
    assert.equal(MAX_RECORDING_MS, 60_000);
    assert.equal(reachedMaxLength(59_999), false);
    assert.equal(reachedMaxLength(60_000), true);
  });
  test('custom limit', () => {
    assert.equal(reachedMaxLength(500, 1000), false);
    assert.equal(reachedMaxLength(1500, 1000), true);
  });
});

describe('video mime with sound', () => {
  test('prefers opus audio when there is a sound track', () => {
    assert.equal(pickVideoMimeType(() => true, videoMimePreference(true)), 'video/webm;codecs=vp9,opus');
    assert.equal(pickVideoMimeType((m) => !m.includes('vp9'), videoMimePreference(true)), 'video/webm;codecs=vp8,opus');
    assert.equal(pickVideoMimeType((m) => !m.includes('opus'), videoMimePreference(true)), 'video/webm;codecs=vp9');
  });
  test('silent recordings keep the old list', () => {
    assert.equal(videoMimePreference(false), VIDEO_MIME_PREFERENCE);
    assert.equal(VIDEO_AUDIO_MIME_PREFERENCE.at(-1), 'video/mp4');
  });
});
