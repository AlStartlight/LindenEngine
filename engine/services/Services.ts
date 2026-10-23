export interface ServiceDef {
  name: string
  source: string // path to script or prefab
  enabled: boolean
}

export class ServiceRegistry {
  private services: Map<string, any> = new Map()
  private serviceDefinitions: ServiceDef[] = []

  register<T>(name: string, serviceInstance: T): void {
    this.services.set(name, serviceInstance)
  }

  get<T>(name: string): T {
    const s = this.services.get(name)
    if (!s) {
      throw new Error(`Service "${name}" not found in Services registry`)
    }
    return s as T
  }

  has(name: string): boolean {
    return this.services.has(name)
  }

  unregister(name: string): boolean {
    return this.services.delete(name)
  }

  setDefinitions(defs: ServiceDef[]): void {
    this.serviceDefinitions = [...defs]
  }

  getDefinitions(): ServiceDef[] {
    return [...this.serviceDefinitions]
  }

  initializeServices(): void {
    for (const def of this.serviceDefinitions) {
      if (!def.enabled) continue
      const s = this.services.get(def.name)
      if (s) {
        if (typeof s.awake === 'function') {
          s.awake()
        }
        if (typeof s.start === 'function') {
          s.start()
        }
      }
    }
  }

  clear(): void {
    this.services.clear()
  }
}

export const Services = new ServiceRegistry()
