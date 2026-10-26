/** Placeholder scene shown when the build has no readable scene file */
export const DEFAULT_SCENE = {
  format: 'linden-scene',
  version: 2,
  name: 'DefaultScene',
  entities: [
    {
      id: 'ground',
      name: 'Ground',
      active: true,
      static: true,
      tags: [],
      layer: 0,
      parentId: null,
      components: [
        {
          type: 'Transform',
          data: { position: [0, -0.5, 0], rotation: [0, 0, 0], scale: [20, 1, 20] },
        },
        {
          type: 'MeshRenderer',
          data: { primitive: 'box', color: '#1e293b' },
        },
        {
          type: 'BoxCollider',
          data: { size: { x: 20, y: 1, z: 20 } },
        },
      ],
    },
    {
      id: 'player',
      name: 'Player',
      active: true,
      static: false,
      tags: ['Player'],
      layer: 0,
      parentId: null,
      components: [
        {
          type: 'Transform',
          data: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
        },
        {
          type: 'MeshRenderer',
          data: { primitive: 'sphere', color: '#38bdf8' },
        },
        {
          type: 'Rigidbody',
          data: { bodyType: 'dynamic', mass: 1 },
        },
        {
          type: 'SphereCollider',
          data: { radius: 0.5 },
        },
      ],
    },
  ],
}
