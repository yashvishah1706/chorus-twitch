export const PENTATONIC = [0, 2, 4, 7, 9] as const;
export const INSTRUMENTS = ['sine', 'triangle', 'square', 'sawtooth', 'kick', 'snare', 'hat', 'bell', 'fanfare'] as const;
export type Instrument = typeof INSTRUMENTS[number];
export interface Note { type: 'note'; id: string; at: number; midi: number; duration: number; instrument: Instrument; hue: number; name: string; simulated: boolean; velocity: number }
export function hashUsername(username: string): number {
  let hash = 2166136261;
  for (const char of username.toLowerCase()) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}
export function assignVoice(username: string) {
  const hash = hashUsername(username);
  return { instrument: INSTRUMENTS[hash % 4]!, hue: hash % 360, octave: 4 + (hash % 2) };
}
export function quantize(time: number, bpm = 120): number {
  if (!Number.isFinite(time) || !Number.isFinite(bpm) || bpm <= 0) throw new Error('Invalid grid');
  const step = 60_000 / bpm / 4;
  return Math.ceil(time / step) * step;
}
export function snapToScale(midi: number): number {
  if (!Number.isFinite(midi)) throw new Error('Invalid note');
  let best = Math.round(midi), distance = Infinity;
  for (let n = Math.floor(midi) - 12; n <= Math.ceil(midi) + 12; n++) {
    if ((PENTATONIC as readonly number[]).includes(((n % 12) + 12) % 12) && Math.abs(n - midi) < distance) { best = n; distance = Math.abs(n - midi); }
  }
  return best;
}
// Caller supplies clock and previous state: the engine has no I/O or hidden timer.
export function smoothEnergy(previous: number, messagesPerSecond: number, elapsedSeconds: number): number {
  return previous + (Math.min(1, Math.max(0, messagesPerSecond / 8)) - previous) * (1 - Math.exp(-Math.max(0, elapsedSeconds) / 1.5));
}
export function chatNote(username: string, name: string, message: string, now: number, bpm = 120, simulated = false): Note {
  const voice = assignVoice(username);
  const drum = /^!drum\s+(kick|snare|hat)\b/i.exec(message)?.[1]?.toLowerCase() as Instrument | undefined;
  return { type: 'note', id: `${now}-${hashUsername(username + message)}`, at: quantize(now + 1300, bpm), midi: snapToScale(voice.octave * 12 + 12 + hashUsername(message) % 24), duration: 0.24, instrument: drum ?? voice.instrument, hue: voice.hue, name, simulated, velocity: 0.65 };
}
export function celebration(kind: 'follow' | 'raid', name: string, now: number, bpm: number, simulated: boolean): Note[] {
  const notes = kind === 'follow' ? [72, 76, 79, 84] : [60, 64, 67, 72, 76, 79, 84, 79];
  const start = quantize(now + 1300, bpm);
  return notes.map((midi, i) => ({ type: 'note', id: `${kind}-${now}-${i}`, at: start + i * 60_000 / bpm / 4, midi, duration: 0.5, instrument: kind === 'follow' ? 'bell' : 'fanfare', hue: hashUsername(name) % 360, name: `${kind.toUpperCase()} · ${name}`, simulated, velocity: 0.7 }));
}
