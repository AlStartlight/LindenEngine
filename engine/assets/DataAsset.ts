import { nanoid } from '../utils/index'

export class DataAsset {
  public id: string
  public name: string

  constructor(name: string = 'New DataAsset', id: string = nanoid()) {
    this.id = id
    this.name = name
  }

  duplicate(): this {
    const constructor = this.constructor as new (name: string, id: string) => this
    const cloned = new constructor(`${this.name} (Copy)`, nanoid())

    for (const [key, value] of Object.entries(this)) {
      if (key === 'id' || key === 'name') continue
      if (value && typeof value === 'object') {
        ;(cloned as any)[key] = JSON.parse(JSON.stringify(value))
      } else {
        ;(cloned as any)[key] = value
      }
    }

    return cloned
  }

  serialize(): Record<string, any> {
    const result: Record<string, any> = {
      format: 'linden-asset',
      version: 1,
      type: this.constructor.name,
      id: this.id,
      name: this.name,
      data: {},
    }

    for (const [key, value] of Object.entries(this)) {
      if (key === 'id' || key === 'name') continue
      if (typeof value === 'function') continue
      result.data[key] = value
    }

    return result
  }

  deserialize(payload: any): void {
    if (payload.id) this.id = payload.id
    if (payload.name) this.name = payload.name
    if (payload.data && typeof payload.data === 'object') {
      Object.assign(this, payload.data)
    }
  }
}
