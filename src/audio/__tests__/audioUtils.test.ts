import { computeRMS, mergeBuffers } from '../audioUtils';

describe('mergeBuffers', () => {
  it('returns empty array for no chunks', () => {
    const out = mergeBuffers([]);
    expect(out.length).toBe(0);
  });

  it('concatenates chunks in order', () => {
    const a = new Float32Array([1, 2]);
    const b = new Float32Array([3, 4, 5]);
    const out = mergeBuffers([a, b]);
    expect(Array.from(out)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('computeRMS', () => {
  it('is zero for empty buffer', () => {
    expect(computeRMS(new Float32Array(0))).toBe(0);
  });

  it('is 1 for full-scale constant', () => {
    const n = 1000;
    const buf = new Float32Array(n);
    buf.fill(1);
    const rms = computeRMS(buf);
    expect(rms).toBeCloseTo(1, 5);
  });
});
