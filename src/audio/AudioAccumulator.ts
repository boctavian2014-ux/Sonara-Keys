import { mergeBuffers } from './audioUtils';

/**
 * Sliding window: collect PCM until 2s worth, emit segment, retain 0.5s overlap (advance 1.5s).
 */
export class AudioAccumulator {
  private buffer: Float32Array[] = [];

  private totalSamples = 0;

  private readonly sampleRate: number;

  private readonly segmentSamples: number;

  private readonly overlapSamples: number;

  private readonly dropSamples: number;

  private callback: ((segment: Float32Array) => void) | null = null;

  constructor(sampleRate = 44100, segmentSec = 2.0, overlapSec = 0.5) {
    this.sampleRate = sampleRate;
    this.segmentSamples = Math.max(1, Math.floor(segmentSec * sampleRate));
    this.overlapSamples = Math.max(0, Math.floor(overlapSec * sampleRate));
    this.dropSamples = Math.max(0, this.segmentSamples - this.overlapSamples);
  }

  onSegmentReady(cb: (segment: Float32Array) => void): void {
    this.callback = cb;
  }

  reset(): void {
    this.buffer = [];
    this.totalSamples = 0;
  }

  /** Remove `count` samples from the front of the internal chunk list. */
  private dropFromFront(count: number): void {
    let remaining = count;
    const next: Float32Array[] = [];
    for (const chunk of this.buffer) {
      if (remaining <= 0) {
        next.push(chunk);
        continue;
      }
      if (chunk.length <= remaining) {
        remaining -= chunk.length;
      } else {
        next.push(chunk.subarray(remaining));
        remaining = 0;
      }
    }
    this.buffer = next;
    this.totalSamples = next.reduce((acc, c) => acc + c.length, 0);
  }

  push(chunk: Float32Array): void {
    if (chunk.length === 0) return;
    this.buffer.push(chunk);
    this.totalSamples += chunk.length;

    while (this.totalSamples >= this.segmentSamples && this.callback != null) {
      const merged = mergeBuffers(this.buffer);
      const segment = merged.subarray(0, this.segmentSamples);
      const copy = new Float32Array(segment.length);
      copy.set(segment);
      this.callback(copy);
      this.dropFromFront(this.dropSamples);
    }
  }

  /**
   * Remaining audio after stop. Only emits if at least 1.5s (never send shorter to Basic Pitch).
   */
  flushRemainder(minSamples: number): Float32Array | null {
    if (this.totalSamples < minSamples) {
      this.reset();
      return null;
    }
    const merged = mergeBuffers(this.buffer);
    this.reset();
    return merged;
  }
}
