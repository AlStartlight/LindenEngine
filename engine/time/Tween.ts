/**
 * Tween System - Smooth property interpolation
 * Easing equations ported from Godot scene/animation/easing_equations.h
 */

export type EasingType =
  | 'linear'
  | 'quadIn'
  | 'quadOut'
  | 'quadInOut'
  | 'cubicIn'
  | 'cubicOut'
  | 'cubicInOut'
  | 'quartIn'
  | 'quartOut'
  | 'quartInOut'
  | 'sineIn'
  | 'sineOut'
  | 'sineInOut'
  | 'expoIn'
  | 'expoOut'
  | 'expoInOut'
  | 'circIn'
  | 'circOut'
  | 'circInOut'
  | 'bounceIn'
  | 'bounceOut'
  | 'bounceInOut'

export const Easing = {
  linear: (t: number) => t,
  quadIn: (t: number) => t * t,
  quadOut: (t: number) => t * (2 - t),
  quadInOut: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  cubicIn: (t: number) => t * t * t,
  cubicOut: (t: number) => --t * t * t + 1,
  cubicInOut: (t: number) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  quartIn: (t: number) => t * t * t * t,
  quartOut: (t: number) => 1 - --t * t * t * t,
  quartInOut: (t: number) => (t < 0.5 ? 8 * t * t * t * t : 1 - 8 * --t * t * t * t),
  sineIn: (t: number) => 1 - Math.cos((t * Math.PI) / 2),
  sineOut: (t: number) => Math.sin((t * Math.PI) / 2),
  sineInOut: (t: number) => 0.5 * (1 - Math.cos(Math.PI * t)),
  expoIn: (t: number) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))),
  expoOut: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  expoInOut: (t: number) => {
    if (t === 0) return 0
    if (t === 1) return 1
    if ((t *= 2) < 1) return 0.5 * Math.pow(2, 10 * (t - 1))
    return 0.5 * (2 - Math.pow(2, -10 * --t))
  },
  circIn: (t: number) => 1 - Math.sqrt(1 - t * t),
  circOut: (t: number) => Math.sqrt(1 - --t * t),
  circInOut: (t: number) => (t < 0.5 ? 0.5 * (1 - Math.sqrt(1 - 4 * t * t)) : 0.5 * (Math.sqrt(1 - (2 * t - 2) * (2 * t - 2)) + 1)),
  bounceOut: (t: number) => {
    const n1 = 7.5625
    const d1 = 2.75
    if (t < 1 / d1) return n1 * t * t
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375
    return n1 * (t -= 2.625 / d1) * t + 0.984375
  },
  bounceIn: (t: number) => 1 - Easing.bounceOut(1 - t),
  bounceInOut: (t: number) => (t < 0.5 ? 0.5 * Easing.bounceIn(t * 2) : 0.5 * Easing.bounceOut(t * 2 - 1) + 0.5),
}

export interface TweenOptions {
  ease?: EasingType
  delay?: number
  loops?: number
}

export interface TweenHandle {
  kill(): void
  then(callback: () => void): TweenHandle
}

interface ActiveTween {
  target: any
  path: string
  fromValue: any
  toValue: any
  duration: number
  elapsed: number
  delay: number
  ease: (t: number) => number
  loops: number
  currentLoop: number
  killed: boolean
  completed: boolean
  onCompleteCallbacks: (() => void)[]
  entityId?: string
}

class TweenManager {
  private tweens: ActiveTween[] = []

  to(target: any, path: string, toValue: any, duration: number, options?: TweenOptions): TweenHandle {
    const delay = options?.delay ?? 0
    const loops = options?.loops ?? 1
    const easeFn = Easing[options?.ease || 'linear'] || Easing.linear

    // Get current value
    const fromValue = this.resolvePathValue(target, path)

    let entityId: string | undefined
    if (target && target.id && typeof target.id === 'string') {
      entityId = target.id
    } else if (target && typeof target.getEntityId === 'function') {
      entityId = target.getEntityId()
    }

    const tween: ActiveTween = {
      target,
      path,
      fromValue: JSON.parse(JSON.stringify(fromValue)),
      toValue: JSON.parse(JSON.stringify(toValue)),
      duration: Math.max(duration, 0.0001),
      elapsed: 0,
      delay,
      ease: easeFn,
      loops,
      currentLoop: 0,
      killed: false,
      completed: false,
      onCompleteCallbacks: [],
      entityId,
    }

    this.tweens.push(tween)

    const handle: TweenHandle = {
      kill: () => {
        tween.killed = true
        const idx = this.tweens.indexOf(tween)
        if (idx !== -1) {
          this.tweens.splice(idx, 1)
        }
      },
      then: (cb: () => void) => {
        if (tween.completed) {
          cb()
        } else {
          tween.onCompleteCallbacks.push(cb)
        }
        return handle
      },
    }

    return handle
  }

  update(deltaTime: number): void {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i]
      if (tw.killed) {
        this.tweens.splice(i, 1)
        continue
      }

      if (tw.delay > 0) {
        tw.delay -= deltaTime
        if (tw.delay > 0) continue
      }

      tw.elapsed += deltaTime
      const tNorm = Math.min(tw.elapsed / tw.duration, 1)
      const easedT = tw.ease(tNorm)

      this.applyInterpolatedValue(tw.target, tw.path, tw.fromValue, tw.toValue, easedT)

      if (tNorm >= 1) {
        tw.currentLoop++
        if (tw.loops > 0 && tw.currentLoop >= tw.loops) {
          tw.completed = true
          this.tweens.splice(i, 1)
          for (const cb of tw.onCompleteCallbacks) {
            try {
              cb()
            } catch (err) {
              console.error('Error in Tween callback:', err)
            }
          }
        } else {
          // Reset for next loop
          tw.elapsed = 0
        }
      }
    }
  }

  bindWorld(world: { events: { on: (event: string, fn: (entity: any) => void) => () => void } }): () => void {
    return world.events.on('entityRemoved', (entity: any) => {
      if (entity && entity.id) {
        this.killForEntity(entity.id)
      }
    })
  }

  killForEntity(entityId: string): void {
    for (let i = this.tweens.length - 1; i >= 0; i--) {
      const tw = this.tweens[i]
      if (tw.entityId === entityId) {
        tw.killed = true
        this.tweens.splice(i, 1)
      }
    }
  }

  clear(): void {
    this.tweens = []
  }

  private resolvePathValue(target: any, path: string): any {
    const parts = path.split('.')
    let current = target
    for (const part of parts) {
      if (current === null || current === undefined) return undefined
      if (typeof current.getComponent === 'function' && current.hasComponent?.(part)) {
        current = current.getComponent(part)
      } else {
        current = current[part]
      }
    }
    return current
  }

  private applyInterpolatedValue(target: any, path: string, from: any, to: any, t: number): void {
    const parts = path.split('.')
    let current = target
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i]
      if (typeof current.getComponent === 'function' && current.hasComponent?.(part)) {
        current = current.getComponent(part)
      } else {
        current = current[part]
      }
      if (!current) return
    }

    const lastProp = parts[parts.length - 1]
    const curVal = current[lastProp]

    if (typeof from === 'number' && typeof to === 'number') {
      current[lastProp] = from + (to - from) * t
    } else if (Array.isArray(to)) {
      const fromArr = Array.isArray(from) ? from : [0, 0, 0]
      if (Array.isArray(curVal)) {
        for (let j = 0; j < to.length; j++) {
          curVal[j] = fromArr[j] + (to[j] - fromArr[j]) * t
        }
      } else if (curVal && typeof curVal === 'object') {
        const keys = ['x', 'y', 'z', 'w']
        for (let j = 0; j < to.length; j++) {
          const k = keys[j]
          curVal[k] = fromArr[j] + (to[j] - fromArr[j]) * t
        }
      }
    } else if (typeof to === 'object' && to !== null) {
      const fromObj = from || {}
      for (const k of Object.keys(to)) {
        if (typeof to[k] === 'number') {
          const f = fromObj[k] ?? 0
          curVal[k] = f + (to[k] - f) * t
        }
      }
    }
  }
}

export const Tween = new TweenManager()
