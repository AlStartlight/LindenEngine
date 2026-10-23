import type { PropertySchema } from './ComponentRegistry'

export const PROPERTY_METADATA_KEY = '__serialized_properties__'
export const CALLABLE_METADATA_KEY = '__callable_methods__'
export const DATA_ASSET_METADATA_KEY = '__data_asset_options__'

/**
 * Decorator to expose property to Inspector and serializer
 * Equivalent to @export in GDScript or [SerializeField] in Unity
 */
export function serialize(options?: Partial<PropertySchema>) {
  return function (target: any, propertyKey: string) {
    if (!target.constructor[PROPERTY_METADATA_KEY]) {
      target.constructor[PROPERTY_METADATA_KEY] = []
    }

    const schema: PropertySchema = {
      name: propertyKey,
      label: options?.label || propertyKey.charAt(0).toUpperCase() + propertyKey.slice(1),
      kind: options?.kind || 'number',
      default: options?.default ?? undefined,
      min: options?.min,
      max: options?.max,
      step: options?.step,
      options: options?.options,
      assetType: options?.assetType,
      tooltip: options?.tooltip,
      hideInInspector: options?.hideInInspector,
    }

    target.constructor[PROPERTY_METADATA_KEY].push(schema)
  }
}

/**
 * Decorator to mark method as callable by signals/events
 */
export function callable() {
  return function (target: any, propertyKey: string, descriptor?: PropertyDescriptor) {
    if (!target.constructor[CALLABLE_METADATA_KEY]) {
      target.constructor[CALLABLE_METADATA_KEY] = []
    }
    target.constructor[CALLABLE_METADATA_KEY].push(propertyKey)
    return descriptor
  }
}

/**
 * Decorator for custom DataAsset class
 * Equivalent to CreateAssetMenu in Unity or custom Resource in Godot
 */
export function dataAsset(options?: { menuName?: string }) {
  return function (constructor: Function) {
    ;(constructor as any)[DATA_ASSET_METADATA_KEY] = options || {}
  }
}
