import { LindenProjectConfig } from '../../shared/types/project'
import { defaultExportPresets } from '../store/editorStore'
import { cloneDefaultActions, cloneDefaultTouch } from '../../engine/input/defaultInput'

export type ProjectTemplateId = 'empty-3d' | 'empty-2d' | '2d-platformer' | '3d-fps' | 'html-threejs'

export interface ProjectTemplateInfo {
  id: ProjectTemplateId
  name: string
  description: string
  icon: string
  category: '3D' | '2D' | 'HTML'
}

export const PROJECT_TEMPLATES: ProjectTemplateInfo[] = [
  {
    id: 'empty-3d',
    name: 'Empty 3D',
    description: 'Titik awal proyek 3D kosong dengan Main Camera, Directional Light, Ground plane, dan Cube.',
    icon: 'cube',
    category: '3D',
  },
  {
    id: 'empty-2d',
    name: 'Empty 2D',
    description: 'Titik awal proyek 2D dengan kamera orthographic dan setup layer 2D.',
    icon: 'square',
    category: '2D',
  },
  {
    id: '2d-platformer',
    name: '2D Platformer',
    description: 'Template platformer lengkap dengan Player Rigidbody2D, Ground Collider, Coin, dan Input Bindings.',
    icon: 'gamepad',
    category: '2D',
  },
  {
    id: '3d-fps',
    name: '3D FPS Arena',
    description: 'Template First-Person Shooter dengan CharacterController, ruang arena, dan pencahayaan dinamis.',
    icon: 'crosshair',
    category: '3D',
  },
  {
    id: 'html-threejs',
    name: 'HTML Game (three.js)',
    description: 'Game 3D sebagai halaman web sendiri (web/index.html + three.js lokal). Dijalankan di viewport saat Play dan diekspor apa adanya.',
    icon: 'code',
    category: 'HTML',
  },
]

/** Templates whose game is the project's own web page (project runtime 'html') */
export function isHtmlTemplate(templateId: ProjectTemplateId): boolean {
  return templateId === 'html-threejs'
}

export function generateTemplateScene(templateId: ProjectTemplateId, sceneName: string = 'Main'): any {
  switch (templateId) {
    case 'empty-2d':
      return {
        format: 'linden-scene',
        version: 2,
        name: sceneName,
        settings: {
          ambientColor: '#888888',
          skybox: null,
        },
        entities: [
          {
            id: 'ent-camera-2d',
            name: 'Main Camera 2D',
            active: true,
            static: false,
            tags: ['MainCamera'],
            layer: 0,
            parentId: null,
            components: [
              {
                type: 'Transform',
                data: {
                  position: [0, 0, 10],
                  rotation: [0, 0, 0],
                  scale: [1, 1, 1],
                },
              },
              {
                type: 'Camera',
                data: {
                  fov: 60,
                  near: 0.1,
                  far: 1000,
                  isOrthographic: true,
                  orthoSize: 5,
                },
              },
            ],
          },
          {
            id: 'ent-bg-2d',
            name: 'Background Sprite',
            active: true,
            static: true,
            tags: [],
            layer: 0,
            parentId: null,
            components: [
              {
                type: 'Transform',
                data: {
                  position: [0, 0, 0],
                  rotation: [0, 0, 0],
                  scale: [4, 4, 1],
                },
              },
              {
                type: 'MeshRenderer',
                data: {
                  primitive: 'plane',
                  color: '#2a4365',
                },
              },
            ],
          },
        ],
      }

    case '2d-platformer':
      return {
        format: 'linden-scene',
        version: 2,
        name: sceneName,
        settings: {
          ambientColor: '#ffffff',
          skybox: null,
        },
        entities: [
          {
            id: 'ent-player-2d',
            name: 'Player',
            active: true,
            static: false,
            tags: ['Player'],
            layer: 6,
            parentId: null,
            components: [
              {
                type: 'Transform',
                data: {
                  position: [0, 2, 0],
                  rotation: [0, 0, 0],
                  scale: [1, 1, 1],
                },
              },
              {
                type: 'MeshRenderer',
                data: { primitive: 'cube', color: '#48bb78' },
              },
              {
                type: 'CapsuleCollider',
                data: { radius: 0.45, height: 1 },
              },
              {
                type: 'CharacterController',
                data: { stepOffset: 0.2, slopeLimit: 50 },
              },
              {
                // A/D (or joystick) to run, Space to jump; locked to the 2D plane
                type: 'CharacterMovement',
                data: { mode: 'walk', lockAxis: 'z', walkSpeed: 5, sprintSpeed: 8, jumpHeight: 2.2, maxJumps: 2, qeMode: 'strafe' },
              },
            ],
          },
          {
            id: 'ent-ground-2d',
            name: 'Ground Platform',
            active: true,
            static: true,
            tags: ['Ground'],
            layer: 0,
            parentId: null,
            components: [
              {
                type: 'Transform',
                data: {
                  position: [0, -1, 0],
                  rotation: [0, 0, 0],
                  scale: [12, 0.5, 2],
                },
              },
              {
                type: 'MeshRenderer',
                data: { primitive: 'cube', color: '#4a5568' },
              },
              {
                type: 'BoxCollider',
                data: { size: { x: 12, y: 0.5, z: 2 } },
              },
            ],
          },
          {
            id: 'ent-coin-2d',
            name: 'Coin Pickup',
            active: true,
            static: true,
            tags: ['Coin', 'Pickup'],
            layer: 0,
            parentId: null,
            components: [
              {
                type: 'Transform',
                data: {
                  position: [2, 1, 0],
                  rotation: [0, 0, 0],
                  scale: [0.6, 0.6, 0.6],
                },
              },
              {
                type: 'MeshRenderer',
                data: { primitive: 'sphere', color: '#ecc94b' },
              },
              {
                type: 'SphereCollider',
                data: { radius: 0.3, isTrigger: true },
              },
            ],
          },
        ],
      }

    case '3d-fps':
      return {
        format: 'linden-scene',
        version: 2,
        name: sceneName,
        settings: {
          ambientColor: '#4a5568',
          skybox: 'default',
        },
        entities: [
          {
            id: 'ent-fps-player',
            name: 'FPS Player',
            active: true,
            static: false,
            tags: ['Player'],
            layer: 6,
            parentId: null,
            components: [
              {
                type: 'Transform',
                data: {
                  position: [0, 1.8, 0],
                  rotation: [0, 0, 0],
                  scale: [1, 1, 1],
                },
              },
              {
                type: 'CapsuleCollider',
                data: { radius: 0.4, height: 1.8 },
              },
              {
                type: 'CharacterController',
                data: { stepOffset: 0.3, slopeLimit: 45 },
              },
              {
                // WASD/joystick move, Q/E turn, mouse/right stick/right-side drag to look, Space jump, Shift sprint
                type: 'CharacterMovement',
                data: { mode: 'walk', qeMode: 'turn', walkSpeed: 5, sprintSpeed: 8.5, jumpHeight: 1.2 },
              },
            ],
          },
          {
            id: 'ent-fps-head-camera',
            name: 'Head Camera',
            active: true,
            static: false,
            tags: ['MainCamera'],
            layer: 6,
            parentId: 'ent-fps-player',
            components: [
              {
                type: 'Transform',
                data: { position: [0, 0.7, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
              },
              {
                type: 'Camera',
                data: { fov: 75, near: 0.1, far: 1000, isActive: true },
              },
            ],
          },
          {
            id: 'ent-arena-floor',
            name: 'Arena Floor',
            active: true,
            static: true,
            tags: ['Ground'],
            layer: 0,
            parentId: null,
            components: [
              {
                type: 'Transform',
                data: {
                  position: [0, 0, 0],
                  rotation: [0, 0, 0],
                  scale: [30, 0.2, 30],
                },
              },
              {
                type: 'MeshRenderer',
                data: { primitive: 'plane', color: '#2d3748' },
              },
              {
                type: 'BoxCollider',
                data: { size: { x: 30, y: 0.2, z: 30 } },
              },
            ],
          },
          {
            id: 'ent-sun-light',
            name: 'Sun Light',
            active: true,
            static: true,
            tags: [],
            layer: 0,
            parentId: null,
            components: [
              {
                type: 'Transform',
                data: {
                  position: [0, 20, 0],
                  rotation: [45, -30, 0],
                  scale: [1, 1, 1],
                },
              },
              {
                type: 'Light',
                data: { type: 'directional', color: '#fffaf0', intensity: 1.2 },
              },
            ],
          },
        ],
      }

    case 'empty-3d':
    default:
      return {
        format: 'linden-scene',
        version: 2,
        name: sceneName,
        settings: {
          ambientColor: '#666666',
          skybox: null,
        },
        entities: [
          {
            id: 'ent-camera-main',
            name: 'Main Camera',
            active: true,
            static: false,
            tags: ['MainCamera'],
            layer: 0,
            parentId: null,
            components: [
              {
                type: 'Transform',
                data: {
                  position: [0, 4, 8],
                  rotation: [-20, 0, 0],
                  scale: [1, 1, 1],
                },
              },
              {
                type: 'Camera',
                data: { fov: 60, near: 0.1, far: 1000 },
              },
            ],
          },
          {
            id: 'ent-dir-light',
            name: 'Directional Light',
            active: true,
            static: true,
            tags: [],
            layer: 0,
            parentId: null,
            components: [
              {
                type: 'Transform',
                data: {
                  position: [5, 10, 5],
                  rotation: [50, -30, 0],
                  scale: [1, 1, 1],
                },
              },
              {
                type: 'Light',
                data: { type: 'directional', color: '#ffffff', intensity: 1.0 },
              },
            ],
          },
          {
            id: 'ent-cube-sample',
            name: 'Cube',
            active: true,
            static: false,
            tags: [],
            layer: 0,
            parentId: null,
            components: [
              {
                type: 'Transform',
                data: {
                  position: [0, 0.5, 0],
                  rotation: [0, 0, 0],
                  scale: [1, 1, 1],
                },
              },
              {
                type: 'MeshRenderer',
                data: { primitive: 'cube', color: '#3182ce' },
              },
              {
                type: 'BoxCollider',
                data: { size: { x: 1, y: 1, z: 1 } },
              },
            ],
          },
          {
            id: 'ent-ground-plane',
            name: 'Ground',
            active: true,
            static: true,
            tags: ['Ground'],
            layer: 0,
            parentId: null,
            components: [
              {
                type: 'Transform',
                data: {
                  position: [0, 0, 0],
                  rotation: [0, 0, 0],
                  scale: [10, 0.1, 10],
                },
              },
              {
                type: 'MeshRenderer',
                data: { primitive: 'plane', color: '#4a5568' },
              },
              {
                type: 'BoxCollider',
                data: { size: { x: 10, y: 0.1, z: 10 } },
              },
            ],
          },
        ],
      }
  }
}

export function generateProjectConfig(
  projectName: string,
  renderer: string = 'webgpu'
): LindenProjectConfig {
  return {
    name: projectName,
    version: '0.1.0',
    renderer: renderer === 'webgpu' ? 'webgpu' : 'webgl',
    tags: ['Player', 'Enemy', 'Pickup', 'Coin', 'Ground', 'Flying'],
    layers: [
      'Default',
      'TransparentFX',
      'Ignore Raycast',
      '',
      'Water',
      'UI',
      'Player',
      'Enemy',
    ],
    collisionMatrix: Array(16)
      .fill(null)
      .map(() => Array(16).fill(true)),
    input: {
      actions: cloneDefaultActions(),
      touch: cloneDefaultTouch(),
    },
    services: [],
    scenesInBuild: ['scenes/Main.lscene'],
    exportPresets: defaultExportPresets.map((p) => ({
      ...p,
      output: p.output.replace('LindenProject', projectName.replace(/\s+/g, '')),
      appName: projectName,
    })),
  }
}
