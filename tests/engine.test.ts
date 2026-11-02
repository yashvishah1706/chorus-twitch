import { describe, expect, it } from 'vitest';
import { assignVoice, quantize, snapToScale, PENTATONIC, chatNote, celebration, smoothEnergy } from '../src/engine.js';
describe('musical invariants', () => {
  it('quantizes forward onto every BPM grid', () => {
    for (const bpm of [40, 90, 120, 137, 240]) for (let t = -1000; t < 10000; t += 37) {
      const result = quantize(t, bpm), step = 60000 / bpm / 4;
      expect(result + 1e-8).toBeGreaterThanOrEqual(t);
      expect(result / step).toBeCloseTo(Math.round(result / step), 8);
    }
  });
  it('snaps all pitches to C major pentatonic', () => {
    for (let n = -48; n < 140; n += 0.37) expect(PENTATONIC).toContain(((snapToScale(n) % 12) + 12) % 12);
  });
  it('assigns a stable case-insensitive voice and color', () => {
    expect(assignVoice('Chatter')).toEqual(assignVoice('Chatter'));
    expect(assignVoice('Chatter')).toEqual(assignVoice('chatter'));
  });
  it('recognizes drums, marks simulations, and schedules celebrations', () => {
    expect(chatNote('a', 'A', '!drum SNARE', 0, 120, true)).toMatchObject({instrument:'snare',simulated:true,at:1375});
    expect(celebration('raid', 'A', 0, 120, false)).toHaveLength(8);
    expect(smoothEnergy(0, 8, 1)).toBeGreaterThan(0);
    expect(() => quantize(1, 0)).toThrow();
  });
});
