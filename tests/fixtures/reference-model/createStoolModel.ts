// A hand-written three.js factory, as the agent writes it with linden_factory_write (prompt section 7).
// Relative units, centred on the origin; linden_model_build fits it to meters.
import * as THREE from 'three'
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js'

export function createStoolModel(options: { castShadow?: boolean } = {}): THREE.Group {
  const root = new THREE.Group()
  root.name = 'Stool'
  const wood = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.65 })
  const metal = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.8, roughness: 0.35 })

  const seat = new THREE.Mesh(new RoundedBoxGeometry(1, 0.12, 1, 4, 0.04), wood)
  seat.name = 'seat'
  seat.position.y = 1.0
  root.add(seat)

  const legs: THREE.Mesh[] = []
  for (const [x, z] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) {
    const profile = [new THREE.Vector2(0.05, 0), new THREE.Vector2(0.04, 0.94)]
    const leg = new THREE.Mesh(new THREE.LatheGeometry(profile, 16), metal)
    leg.name = `leg${legs.length}`
    leg.position.set(x, 0, z)
    root.add(leg)
    legs.push(leg)
  }

  const cushionTop = new THREE.Object3D()
  cushionTop.position.set(0, 1.06, 0)
  root.add(cushionTop)

  root.traverse((o) => {
    o.castShadow = options.castShadow ?? true
  })
  root.userData.sculptRuntime = {
    meshes: { seat, leg0: legs[0], leg1: legs[1], leg2: legs[2], leg3: legs[3] },
    colliders: { seat: {}, leg0: {}, leg1: {}, leg2: {}, leg3: {} },
    sockets: { cushionTop },
  }
  root.userData.tick = () => {}
  return root
}
