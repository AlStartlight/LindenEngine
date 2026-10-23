import { expect } from '@playwright/test'
import { Animator, AnimatorController, ConditionMode, ParameterType } from '../../../engine/animation/AnimatorController'
import type { Case } from '../lib/define'
import { mulberry32, randInt, seedOf } from '../lib/util'

// Animator — 60.000 cases
//   20.000 parameters: float 5.000, int 5.000, bool 5.000, trigger 5.000
//   20.000 transitions: 4 condition modes x 25 thresholds x 200 values
//   20.000 controller serialize/deserialize keeps structure (one seed each)
export const COUNT = 60_000

function oneParamAnimator(name: string, type: ParameterType, def: number | boolean) {
  const c = new AnimatorController('Params')
  c.addParameter(name, type, def)
  const a = new Animator()
  a.initialize(c)
  return a
}

const MODES: Array<[ConditionMode, (v: number, t: number) => boolean]> = [
  [ConditionMode.GREATER, (v, t) => v > t],
  [ConditionMode.LESS, (v, t) => v < t],
  [ConditionMode.EQUALS, (v, t) => v === t],
  [ConditionMode.NOT_EQUALS, (v, t) => v !== t],
]

function randomController(seed: number) {
  const rng = mulberry32(seed)
  const c = new AnimatorController(`AC ${seed}`)
  const layer = c.layers[0]
  for (let i = randInt(rng, 0, 6); i > 0; i--) c.addParameter(`p${i}`, [ParameterType.FLOAT, ParameterType.INT, ParameterType.BOOL, ParameterType.TRIGGER][randInt(rng, 0, 3)])
  const states = Array.from({ length: randInt(rng, 1, 10) }, (_, i) => c.addState(layer.id, `State${i}`)!)
  for (let i = randInt(rng, 0, 15); i > 0; i--) c.addTransition(layer.id, states[randInt(rng, 0, states.length - 1)].id, states[randInt(rng, 0, states.length - 1)].id)
  for (let i = randInt(rng, 0, 2); i > 0; i--) c.addLayer(`Layer${i}`)
  return c
}

const shape = (c: AnimatorController) => ({
  name: c.name,
  params: c.parameters.map((p) => `${p.name}:${p.type}:${p.defaultValue}`),
  layers: c.layers.map((l) => ({ name: l.name, states: l.states.map((s) => `${s.name}:${s.transitions.length}`), def: l.states.find((s) => s.id === l.defaultStateId)?.name })),
})

export function* cases(): Generator<Case> {
  for (let k = -2_500; k < 2_500; k++) {
    const v = k / 8
    yield { title: `float parameter Speed set to ${v} reads back`, run: () => { const a = oneParamAnimator('Speed', ParameterType.FLOAT, 0); a.setFloat('Speed', v); expect(a.getFloat('Speed')).toBe(v) } }
  }
  for (let k = -2_500; k < 2_500; k++) {
    const v = k / 3
    yield { title: `int parameter Count set to ${v.toFixed(4)} floors to ${Math.floor(v)}`, run: () => { const a = oneParamAnimator('Count', ParameterType.INT, 0); a.setInteger('Count', v); expect(a.getInteger('Count')).toBe(Math.floor(v)) } }
  }
  for (let i = 0; i < 2_500; i++) {
    for (const b of [true, false]) {
      yield { title: `bool parameter Flag${i} set to ${b} reads back`, run: () => { const a = oneParamAnimator(`Flag${i}`, ParameterType.BOOL, !b); a.setBool(`Flag${i}`, b); expect(a.getBool(`Flag${i}`)).toBe(b) } }
    }
  }
  for (let i = 0; i < 2_500; i++) {
    yield { title: `trigger Fire${i} is set by setTrigger and cleared by update`, run: () => {
      const a = oneParamAnimator(`Fire${i}`, ParameterType.TRIGGER, false)
      a.setTrigger(`Fire${i}`)
      expect(a.parameters.get(`Fire${i}`)).toBe(true)
      a.update(0.016)
      expect(a.parameters.get(`Fire${i}`)).toBe(false)
    } }
    yield { title: `trigger Fire${i} is cleared by resetTrigger`, run: () => {
      const a = oneParamAnimator(`Fire${i}`, ParameterType.TRIGGER, false)
      a.setTrigger(`Fire${i}`)
      a.resetTrigger(`Fire${i}`)
      expect(a.parameters.get(`Fire${i}`)).toBe(false)
    } }
  }

  for (const [mode, holds] of MODES) {
    for (let j = 0; j < 25; j++) {
      const threshold = j - 12
      for (let k = 0; k < 200; k++) {
        const value = (k - 100) / 2
        const expectMove = holds(value, threshold)
        yield {
          title: `transition Idle->Run when Speed ${mode} ${threshold} with Speed=${value}: ${expectMove ? 'moves' : 'stays'}`,
          run: () => {
            const c = new AnimatorController('T')
            const layer = c.layers[0]
            const speed = c.addParameter('Speed', ParameterType.FLOAT, 0)
            const idle = c.addState(layer.id, 'Idle')!
            const run = c.addState(layer.id, 'Run')!
            const tr = c.addTransition(layer.id, idle.id, run.id)!
            tr.hasExitTime = false
            c.addCondition(layer.id, idle.id, tr.id, speed.id, mode, threshold)
            const a = new Animator()
            a.initialize(c)
            a.setFloat('Speed', value)
            a.update(0.01)
            a.update(tr.transitionDuration + 0.01)
            expect(a.getCurrentAnimatorStateInfo(0)!.stateName).toBe(expectMove ? 'Run' : 'Idle')
          },
        }
      }
    }
  }

  for (let s = 0; s < 20_000; s++) {
    const seed = seedOf(301, s)
    yield {
      title: `controller serialize/deserialize keeps parameters, layers, states, transitions seed=${s}`,
      run: () => {
        const c = randomController(seed)
        const copy = AnimatorController.deserialize(JSON.parse(JSON.stringify(c.serialize())))
        expect(shape(copy)).toEqual(shape(c))
      },
    }
  }
}
