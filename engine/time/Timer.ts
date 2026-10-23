import { Component } from '../ecs/Component'
import { EventField } from '../events/EventField'

export class TimerComponent extends Component {
  public waitTime: number = 1
  public oneShot: boolean = false
  public autoStart: boolean = true
  public isRunning: boolean = false
  public timeLeft: number = 1
  public onTimeout: EventField = new EventField()

  constructor(waitTime: number = 1, oneShot: boolean = false, autoStart: boolean = true) {
    super('Timer')
    this.waitTime = waitTime
    this.oneShot = oneShot
    this.autoStart = autoStart
    this.timeLeft = waitTime
    this.isRunning = autoStart
  }

  onAttach(entityId: string): void {
    super.onAttach(entityId)
    this.timeLeft = this.waitTime
    if (this.autoStart) {
      this.isRunning = true
    }
  }

  start(time?: number): void {
    if (time !== undefined && time > 0) {
      this.waitTime = time
    }
    this.timeLeft = this.waitTime
    this.isRunning = true
  }

  stop(): void {
    this.isRunning = false
  }

  reset(): void {
    this.timeLeft = this.waitTime
  }

  onUpdate(deltaTime: number): void {
    if (!this.isRunning || !this.isEnabled) return

    this.timeLeft -= deltaTime

    while (this.timeLeft <= 0 && this.isRunning) {
      this.onTimeout.emit()

      if (this.oneShot) {
        this.isRunning = false
        this.timeLeft = 0
        break
      } else {
        // Handle repeated timer intervals
        if (this.waitTime <= 0) {
          this.isRunning = false
          break
        }
        this.timeLeft += this.waitTime
      }
    }
  }

  clone(): TimerComponent {
    const cloned = new TimerComponent(this.waitTime, this.oneShot, this.autoStart)
    cloned.isRunning = this.isRunning
    cloned.timeLeft = this.timeLeft
    cloned.onTimeout = this.onTimeout.clone()
    return cloned
  }
}
