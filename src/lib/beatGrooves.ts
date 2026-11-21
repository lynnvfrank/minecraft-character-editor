/**
 * The studio beat's built-in grooves, as data (pure; tested in beatGrooves.test.ts). All original:
 * each is one bar of 16 steps for kick, snare (or clap) and hi-hat, plus a bass line and a lead
 * line written as steps of a five-note (pentatonic) scale. services/beatEngine.ts turns the events
 * into synthesized sound; nothing here is recorded audio.
 *
 * Drum rows: `x` = hit, `X` = accented hit, `.` = rest.
 * Note rows: a digit is a scale degree (0 = root, 5 = root an octave up, ...), `.` = rest.
 */
import { STEPS_PER_BAR } from './beatClock';

export type Wave = 'square' | 'triangle' | 'sawtooth' | 'sine';
export type ScaleName = 'major' | 'minor';

export type Groove = {
  id: string;
  label: string;
  /** One line for the picker's tooltip. */
  blurb: string;
  /** 0 = straight, 1 = full triplet swing. */
  swing: number;
  scale: ScaleName;
  /** MIDI note of the bass root (36 = C2). The lead plays two octaves above. */
  root: number;
  kick: string;
  snare: string;
  /** Play the snare row as a hand clap. */
  clap?: boolean;
  hat: string;
  bass: string;
  lead: string;
  bassWave: Wave;
  leadWave: Wave;
  /** Note length in steps (how long bass and lead notes ring). */
  noteSteps: number;
};

export const PENTATONIC: Record<ScaleName, readonly number[]> = {
  major: [0, 2, 4, 7, 9],
  minor: [0, 3, 5, 7, 10],
};

export const GROOVES: readonly Groove[] = [
  {
    id: 'bouncy',
    label: 'Bouncy',
    blurb: 'Springy and bright',
    swing: 0.35,
    scale: 'major',
    root: 36,
    kick: 'X..x..x.X..x....',
    snare: '....X.......X...',
    hat: 'x.x.x.x.x.x.x.xx',
    bass: '0..0..2.0..3..2.',
    lead: '..4...3...2...34',
    bassWave: 'triangle',
    leadWave: 'square',
    noteSteps: 1.6,
  },
  {
    id: 'chill',
    label: 'Chill',
    blurb: 'Laid back',
    swing: 0.55,
    scale: 'minor',
    root: 33,
    kick: 'X.........x.....',
    snare: '....x.......x...',
    hat: '..x...x...x...x.',
    bass: '0.......3.....2.',
    lead: '....4.....3.2...',
    bassWave: 'sine',
    leadWave: 'triangle',
    noteSteps: 3.5,
  },
  {
    id: 'disco',
    label: 'Disco',
    blurb: 'Four on the floor',
    swing: 0,
    scale: 'minor',
    root: 38,
    kick: 'X...X...X...X...',
    snare: '....X.......X...',
    clap: true,
    hat: '..X...X...X...X.',
    bass: '0.5.0.5.3.8.2.7.',
    lead: '4..3..4.....2.3.',
    bassWave: 'sawtooth',
    leadWave: 'square',
    noteSteps: 1.2,
  },
  {
    id: 'chiptune',
    label: 'Chiptune',
    blurb: 'Bleeps and bloops',
    swing: 0,
    scale: 'major',
    root: 40,
    kick: 'X.....x.X.......',
    snare: '....X.......X.x.',
    hat: 'xxxxxxxxxxxxxxxx',
    bass: '0.0.5.0.3.3.2.2.',
    lead: '0247420.3579753.',
    bassWave: 'square',
    leadWave: 'square',
    noteSteps: 0.9,
  },
  {
    id: 'stomp',
    label: 'Stomp',
    blurb: 'Stomp, stomp, clap',
    swing: 0,
    scale: 'minor',
    root: 31,
    kick: 'X...X.......X...',
    snare: '........X.......',
    clap: true,
    hat: '................',
    bass: '0...0.......0...',
    lead: '........4.....3.',
    bassWave: 'sawtooth',
    leadWave: 'triangle',
    noteSteps: 2.5,
  },
  {
    id: 'lullaby',
    label: 'Lullaby',
    blurb: 'Soft and sleepy',
    swing: 0.2,
    scale: 'major',
    root: 36,
    kick: 'x...............',
    snare: '................',
    hat: '....x.......x...',
    bass: '0.......2.......',
    lead: '4...3...2...3...',
    bassWave: 'sine',
    leadWave: 'triangle',
    noteSteps: 4,
  },
];

export const DEFAULT_GROOVE_ID = GROOVES[0]!.id;

export const isGrooveId = (value: unknown): value is string =>
  typeof value === 'string' && GROOVES.some((g) => g.id === value);

/** The groove with this id, or the first one. */
export function grooveById(id: string): Groove {
  return GROOVES.find((g) => g.id === id) ?? GROOVES[0]!;
}

/** Frequency in Hz of a MIDI note (69 = A4 = 440 Hz). */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** MIDI note for a scale degree above `root` (degree 5 is the root an octave up). */
export function degreeToMidi(root: number, degree: number, scale: ScaleName): number {
  const notes = PENTATONIC[scale];
  const octave = Math.floor(degree / notes.length);
  return root + 12 * octave + notes[((degree % notes.length) + notes.length) % notes.length]!;
}

/** Loudness of a drum row at a step: 0 (rest), 0.7 (hit) or 1 (accent). */
export function hitAt(row: string, step: number): number {
  const c = row[((step % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR];
  return c === 'X' ? 1 : c === 'x' ? 0.7 : 0;
}

/** Scale degree of a note row at a step, or null for a rest. */
export function degreeAt(row: string, step: number): number | null {
  const c = row[((step % STEPS_PER_BAR) + STEPS_PER_BAR) % STEPS_PER_BAR];
  return c !== undefined && c >= '0' && c <= '9' ? Number(c) : null;
}

export type GrooveEvent =
  | { voice: 'kick' | 'snare' | 'clap' | 'hat'; velocity: number }
  | { voice: 'bass' | 'lead'; freq: number; wave: Wave; steps: number };

/** Everything that sounds on one step of a groove (steps wrap round the bar). */
export function grooveEventsAt(groove: Groove, step: number): GrooveEvent[] {
  const out: GrooveEvent[] = [];
  const kick = hitAt(groove.kick, step);
  if (kick > 0) out.push({ voice: 'kick', velocity: kick });
  const snare = hitAt(groove.snare, step);
  if (snare > 0) out.push({ voice: groove.clap ? 'clap' : 'snare', velocity: snare });
  const hat = hitAt(groove.hat, step);
  if (hat > 0) out.push({ voice: 'hat', velocity: hat });
  const bass = degreeAt(groove.bass, step);
  if (bass !== null) {
    out.push({
      voice: 'bass',
      freq: midiToFreq(degreeToMidi(groove.root, bass, groove.scale)),
      wave: groove.bassWave,
      steps: groove.noteSteps,
    });
  }
  const lead = degreeAt(groove.lead, step);
  if (lead !== null) {
    out.push({
      voice: 'lead',
      freq: midiToFreq(degreeToMidi(groove.root + 24, lead, groove.scale)),
      wave: groove.leadWave,
      steps: groove.noteSteps,
    });
  }
  return out;
}
