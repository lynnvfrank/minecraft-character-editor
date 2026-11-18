import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyMix,
  crossfadeWeights,
  describeBlend,
  dominantClip,
  mixToBlendStep,
  resolveMixWeights,
  stepSweep,
  type StudioMix,
} from './studioMix';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

/** Small deterministic PRNG (mulberry32) so the property tests are reproducible. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mixWith(layers: StudioMix['layers'], cf: Partial<StudioMix['crossfade']> = {}, normalize = true): StudioMix {
  const m = createEmptyMix();
  m.layers = layers;
  m.crossfade = { ...m.crossfade, ...cf };
  m.normalize = normalize;
  return m;
}

describe('crossfadeWeights', () => {
  test('linear is 1-t / t and sums to 1', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const w = crossfadeWeights(t, 'linear');
      assert.ok(near(w.a, 1 - t));
      assert.ok(near(w.a + w.b, 1));
    }
  });
  test('equal-power keeps a² + b² = 1 and is symmetric at 0.5', () => {
    for (const t of [0, 0.1, 0.5, 0.9, 1]) {
      const w = crossfadeWeights(t, 'equal-power');
      assert.ok(near(w.a * w.a + w.b * w.b, 1));
    }
    const mid = crossfadeWeights(0.5, 'equal-power');
    assert.ok(near(mid.a, mid.b));
  });
  test('clamps t outside 0..1', () => {
    assert.deepEqual(crossfadeWeights(-3, 'linear'), { a: 1, b: 0 });
    assert.deepEqual(crossfadeWeights(7, 'linear'), { a: 0, b: 1 });
  });
});

describe('resolveMixWeights', () => {
  test('two playing layers with different weights, normalized', () => {
    const w = resolveMixWeights(
      mixWith({ wave: { playing: true, weight: 0.6, timeScale: 1 }, clap: { playing: true, weight: 0.2, timeScale: 1.5 } })
    );
    assert.equal(w.size, 2);
    assert.ok(near(w.get('wave')!.weight, 0.75));
    assert.ok(near(w.get('clap')!.weight, 0.25));
    assert.equal(w.get('clap')!.timeScale, 1.5);
  });

  test('stopped layers and zero weights are left out', () => {
    const w = resolveMixWeights(
      mixWith({ wave: { playing: false, weight: 1, timeScale: 1 }, clap: { playing: true, weight: 0, timeScale: 1 } })
    );
    assert.equal(w.size, 0);
  });

  test('without normalize, raw weights pass through', () => {
    const w = resolveMixWeights(mixWith({ wave: { playing: true, weight: 0.3, timeScale: 1 } }, {}, false));
    assert.ok(near(w.get('wave')!.weight, 0.3));
  });

  test('crossfade alone blends A and B by t', () => {
    const w = resolveMixWeights(mixWith({}, { a: 'idle', b: 'dance', t: 0.25, curve: 'linear' }));
    assert.ok(near(w.get('idle')!.weight, 0.75));
    assert.ok(near(w.get('dance')!.weight, 0.25));
  });

  test('crossfade at the ends leaves only one clip', () => {
    const atA = resolveMixWeights(mixWith({}, { a: 'idle', b: 'dance', t: 0, curve: 'equal-power' }));
    assert.deepEqual([...atA.keys()], ['idle']);
    const atB = resolveMixWeights(mixWith({}, { a: 'idle', b: 'dance', t: 1, curve: 'equal-power' }));
    assert.deepEqual([...atB.keys()], ['dance']);
  });

  test('a single filled slot (or A = B) plays at full weight', () => {
    assert.ok(near(resolveMixWeights(mixWith({}, { a: 'idle', b: null })).get('idle')!.weight, 1));
    assert.ok(near(resolveMixWeights(mixWith({}, { a: 'idle', b: 'idle', t: 0.5 })).get('idle')!.weight, 1));
  });

  test('crossfade slot uses the layer time scale and adds to a playing layer', () => {
    const w = resolveMixWeights(
      mixWith(
        { dance: { playing: true, weight: 1, timeScale: 0.5 } },
        { a: 'idle', b: 'dance', t: 1, curve: 'linear' },
        false
      )
    );
    assert.ok(near(w.get('dance')!.weight, 2));
    assert.equal(w.get('dance')!.timeScale, 0.5);
  });

  test('time scale is clamped to 0..2', () => {
    const w = resolveMixWeights(mixWith({ x: { playing: true, weight: 1, timeScale: 9 } }));
    assert.equal(w.get('x')!.timeScale, 2);
  });

  test('seeded random mixes: normalized weights are in (0,1] and sum to 1', () => {
    const r = rng(1234);
    const keys = ['a', 'b', 'c', 'd', 'e'];
    for (let i = 0; i < 300; i++) {
      const layers: StudioMix['layers'] = {};
      for (const k of keys) {
        layers[k] = { playing: r() < 0.6, weight: r() * 1.4 - 0.2, timeScale: r() * 3 };
      }
      const pick = () => (r() < 0.2 ? null : keys[Math.floor(r() * keys.length)]!);
      const w = resolveMixWeights(
        mixWith(layers, { a: pick(), b: pick(), t: r(), curve: r() < 0.5 ? 'linear' : 'equal-power' })
      );
      if (w.size === 0) continue;
      let sum = 0;
      for (const v of w.values()) {
        assert.ok(v.weight > 0 && v.weight <= 1 + 1e-9, `weight ${v.weight}`);
        assert.ok(v.timeScale >= 0 && v.timeScale <= 2);
        sum += v.weight;
      }
      assert.ok(near(sum, 1, 1e-9), `sum ${sum} on iteration ${i}`);
    }
  });
});

describe('dominantClip', () => {
  test('picks the heaviest clip, null when empty', () => {
    assert.equal(dominantClip(new Map()), null);
    const w = resolveMixWeights(mixWith({}, { a: 'idle', b: 'dance', t: 0.7, curve: 'linear' }));
    assert.equal(dominantClip(w), 'dance');
  });
});

describe('mixToBlendStep', () => {
  test('snapshots resolved weights, heaviest first, rounded', () => {
    const step = mixToBlendStep(
      mixWith({ wave: { playing: true, weight: 1, timeScale: 1 }, clap: { playing: true, weight: 0.5, timeScale: 1.25 } }),
      4
    );
    assert.deepEqual(step, {
      type: 'blend',
      layers: [
        { name: 'wave', weight: 0.667, timeScale: 1 },
        { name: 'clap', weight: 0.333, timeScale: 1.25 },
      ],
      duration: 4,
    });
  });
  test('returns null when nothing plays; clamps the duration', () => {
    assert.equal(mixToBlendStep(createEmptyMix(), 4), null);
    const step = mixToBlendStep(mixWith({}, { a: 'idle' }), 999);
    assert.equal(step!.duration, 60);
  });
  test('describeBlend names the top layers', () => {
    const step = mixToBlendStep(mixWith({}, { a: 'idle', b: 'dance', t: 0.5, curve: 'linear' }), 3)!;
    assert.equal(describeBlend(step, (k) => k.toUpperCase()), 'DANCE 50% + IDLE 50%');
  });
});

describe('stepSweep', () => {
  test('moves forward and bounces off 1 and 0', () => {
    let s = stepSweep(0, 1, 1, 4);
    assert.ok(near(s.t, 0.25));
    s = stepSweep(0.9, 1, 1, 4);
    assert.ok(near(s.t, 0.85));
    assert.equal(s.dir, -1);
    s = stepSweep(0.1, -1, 1, 4);
    assert.ok(near(s.t, 0.15));
    assert.equal(s.dir, 1);
  });
  test('seeded random steps always stay in 0..1', () => {
    const r = rng(42);
    let s: { t: number; dir: 1 | -1 } = { t: 0.5, dir: 1 };
    for (let i = 0; i < 500; i++) {
      s = stepSweep(s.t, s.dir, r() * 10, 0.5 + r() * 4);
      assert.ok(s.t >= 0 && s.t <= 1);
    }
  });
});
