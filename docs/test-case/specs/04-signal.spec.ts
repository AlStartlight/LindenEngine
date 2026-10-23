import { test, expect } from '@playwright/test'
import { Signal } from '../../../engine/scene/Signal'
import { mulberry32, randInt, shuffle, tcId } from './_helpers'

// 600 cases: 5 behaviours x 120 seeded scenarios
const SEEDS = 120

test.describe('Signal (Godot-style)', () => {
  let n = 0
  for (let s = 0; s < SEEDS; s++) {
    const rng = mulberry32(4000 + s)
    const listeners = randInt(rng, 1, 12)
    const emits = randInt(rng, 1, 8)
    const removed = randInt(rng, 0, listeners)
    const failingIndex = randInt(rng, 0, listeners - 1)
    const payload = randInt(rng, -1000, 1000)
    const order = shuffle(rng, Array.from({ length: listeners }, (_, i) => i))

    test(`${tcId('SIG', ++n)} ${listeners} listeners x ${emits} emits are each called ${emits} times`, () => {
      const sig = new Signal<number>('changed')
      const counts = new Array(listeners).fill(0)
      for (let i = 0; i < listeners; i++) sig.connect(() => counts[i]++)
      for (let e = 0; e < emits; e++) sig.emit(payload)
      expect(counts).toEqual(new Array(listeners).fill(emits))
    })

    test(`${tcId('SIG', ++n)} disconnecting ${removed}/${listeners} listeners stops only those`, () => {
      const sig = new Signal<number>('changed')
      const counts = new Array(listeners).fill(0)
      const fns = Array.from({ length: listeners }, (_, i) => () => counts[i]++)
      fns.forEach((fn) => sig.connect(fn))
      const gone = new Set(order.slice(0, removed))
      for (const i of gone) expect(sig.disconnect(fns[i])).toBe(true)
      sig.emit(payload)
      for (let i = 0; i < listeners; i++) {
        expect(counts[i]).toBe(gone.has(i) ? 0 : 1)
        expect(sig.isConnected(fns[i])).toBe(!gone.has(i))
      }
      expect(sig.getConnections().length).toBe(listeners - removed)
    })

    test(`${tcId('SIG', ++n)} listeners run in connection order and receive payload ${payload}`, () => {
      const sig = new Signal<number>('changed')
      const seen: Array<[number, number]> = []
      for (const i of order) sig.connect((v: number) => seen.push([i, v]))
      sig.emit(payload)
      expect(seen).toEqual(order.map((i) => [i, payload]))
    })

    test(`${tcId('SIG', ++n)} a throwing listener (#${failingIndex}) does not stop the others`, () => {
      const sig = new Signal('changed')
      const counts = new Array(listeners).fill(0)
      for (let i = 0; i < listeners; i++) {
        sig.connect(() => {
          counts[i]++
          if (i === failingIndex) throw new Error('boom')
        })
      }
      const original = console.error
      console.error = () => {}
      try {
        sig.emit()
      } finally {
        console.error = original
      }
      expect(counts).toEqual(new Array(listeners).fill(1))
    })

    test(`${tcId('SIG', ++n)} target/method connection calls method ${emits} times then disconnects`, () => {
      const sig = new Signal<number>('changed')
      const target = { total: 0, add(v: number) { this.total += v } }
      sig.connect(target, 'add')
      expect(sig.isConnected(target, 'add')).toBe(true)
      for (let e = 0; e < emits; e++) sig.emit(payload)
      expect(target.total).toBe(payload * emits)
      expect(sig.disconnect(target, 'add')).toBe(true)
      sig.emit(payload)
      expect(target.total).toBe(payload * emits)
    })
  }
})
