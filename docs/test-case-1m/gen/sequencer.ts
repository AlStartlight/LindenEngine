import { expect } from '@playwright/test'
import { EventTrack, KeyframeInterpolation, PropertyTrack, Sequence, SequencerPlayer } from '../../../engine/cinematic/Sequencer'
import type { Case } from '../lib/define'
import { mulberry32, randInt, round3, seedOf, shuffle } from '../lib/util'

// Sequencer — 80.000 cases
//   24.000 keyframe interpolation: 6 modes x a [-10,9] x b [-10,9] x 10 times
//   16.000 keyframes inserted out of order end up sorted (one seed each)
//   20.000 EventTrack.getEventsBetween uses the (start, end] window (one seed each)
//   20.000 SequencerPlayer.seek clamps and evaluate() matches the track (one seed each)
export const COUNT = 80_000

const MODES: Array<[KeyframeInterpolation, (t: number) => number]> = [
  [KeyframeInterpolation.CONSTANT, () => 0],
  [KeyframeInterpolation.LINEAR, (t) => t],
  [KeyframeInterpolation.EASE_IN, (t) => t * t],
  [KeyframeInterpolation.EASE_OUT, (t) => 1 - (1 - t) * (1 - t)],
  [KeyframeInterpolation.EASE_IN_OUT, (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2)],
  [KeyframeInterpolation.CUBIC, (t) => t * t * (3 - 2 * t)],
]

export function* cases(): Generator<Case> {
  for (const [mode, curve] of MODES) {
    for (let a = -10; a < 10; a++) {
      for (let b = -10; b < 10; b++) {
        for (let k = 0; k < 10; k++) {
          const t = (k + 0.5) / 10
          yield {
            title: `PropertyTrack ${mode} from ${a} to ${b} at t=${t}`,
            run: () => {
              const track = new PropertyTrack('P')
              track.addKeyframe(0, a, mode)
              track.addKeyframe(1, b, mode)
              expect(track.getValueAtTime(t)).toBeCloseTo(a + (b - a) * curve(t), 12)
            },
          }
        }
      }
    }
  }

  for (let s = 0; s < 16_000; s++) {
    const seed = seedOf(401, s)
    yield {
      title: `keyframes added out of order are kept sorted seed=${s}`,
      run: () => {
        const rng = mulberry32(seed)
        const times = Array.from({ length: randInt(rng, 2, 30) }, (_, i) => round3(i * 0.5 + rng() * 0.4))
        const track = new PropertyTrack('Sort')
        for (const t of shuffle(rng, times)) track.addKeyframe(t, t * 10)
        expect(track.keyframes.map((k) => k.time)).toEqual([...times].sort((x, y) => x - y))
        // Values at exact keyframe times are the keyframe values
        for (const t of times) expect(track.getValueAtTime(t)).toBeCloseTo(t * 10, 9)
      },
    }
  }

  for (let s = 0; s < 20_000; s++) {
    const seed = seedOf(402, s)
    yield {
      title: `EventTrack.getEventsBetween returns events in (start, end] seed=${s}`,
      run: () => {
        const rng = mulberry32(seed)
        const track = new EventTrack('E')
        const times = Array.from({ length: randInt(rng, 0, 25) }, () => round3(rng() * 10))
        for (const t of times) track.addKeyframe(t, { eventName: `e${t}`, params: {} })
        const start = round3(rng() * 10)
        const end = round3(start + rng() * (10 - start))
        const got = track.getEventsBetween(start, end).map((k) => k.time)
        expect(got).toEqual(times.filter((t) => t > start && t <= end).sort((x, y) => x - y))
      },
    }
  }

  for (let s = 0; s < 20_000; s++) {
    const seed = seedOf(403, s)
    yield {
      title: `SequencerPlayer.seek clamps to [0, duration] and evaluate matches the track seed=${s}`,
      run: () => {
        const rng = mulberry32(seed)
        const seq = new Sequence('Cut')
        seq.duration = round3(1 + rng() * 20)
        const track = new PropertyTrack('Opacity')
        for (let i = randInt(rng, 1, 8); i > 0; i--) track.addKeyframe(round3(rng() * seq.duration), round3(rng() * 100 - 50), KeyframeInterpolation.LINEAR)
        seq.addTrack(track)
        const player = new SequencerPlayer()
        player.loadSequence(seq)
        const target = round3(rng() * seq.duration * 1.6 - seq.duration * 0.3)
        player.seek(target)
        const clamped = Math.max(0, Math.min(target, seq.duration))
        expect(player.currentTime).toBe(clamped)
        expect(player.evaluate().get(track.id)).toBeCloseTo(track.getValueAtTime(clamped), 12)
      },
    }
  }
}
