import * as THREE from 'three'

// window.linden is injected by Linden (Play in the editor and the web export).
// Fallbacks keep the page working when opened directly in a browser.
const linden = window.linden
const keys = new Set()
addEventListener('keydown', (e) => keys.add(e.code))
addEventListener('keyup', (e) => keys.delete(e.code))
addEventListener('blur', () => keys.clear())

function readMove() {
  const v = linden?.input?.getVector?.('Move') ?? { x: 0, y: 0 }
  const x = v.x || (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0)
  const y = v.y || (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0)
  return { x, y }
}
const jumpPressed = () => linden?.input?.isActionPressed?.('Jump') || keys.has('Space')

const canvas = document.getElementById('game')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
renderer.shadowMap.enabled = true
linden?.registerRenderer?.(renderer)

const scene = new THREE.Scene()
scene.background = new THREE.Color(0x1a1a2e)
scene.fog = new THREE.Fog(0x1a1a2e, 20, 60)

const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 200)

scene.add(new THREE.HemisphereLight(0xbcd7ff, 0x202030, 0.7))
const sun = new THREE.DirectionalLight(0xffffff, 1.2)
sun.position.set(8, 14, 6)
sun.castShadow = true
sun.shadow.mapSize.set(1024, 1024)
Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20 })
scene.add(sun)

const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x1e293b }))
ground.rotation.x = -Math.PI / 2
ground.receiveShadow = true
scene.add(ground)
scene.add(new THREE.GridHelper(40, 40, 0x334155, 0x334155))

const player = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0x38bdf8 }))
player.castShadow = true
player.position.y = 0.5
scene.add(player)

const coins = []
const coinGeo = new THREE.TorusGeometry(0.35, 0.12, 12, 24)
const coinMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.6, roughness: 0.3 })
function spawnCoin() {
  const coin = new THREE.Mesh(coinGeo, coinMat)
  coin.position.set((Math.random() - 0.5) * 30, 0.8, (Math.random() - 0.5) * 30)
  coin.castShadow = true
  scene.add(coin)
  coins.push(coin)
}
for (let i = 0; i < 8; i++) spawnCoin()

const scoreEl = document.getElementById('score')
let score = 0
let velocityY = 0
const SPEED = 7
const GRAVITY = 25

function resize() {
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  renderer.setSize(w, h, false)
  camera.aspect = w / Math.max(h, 1)
  camera.updateProjectionMatrix()
}
addEventListener('resize', resize)
resize()

const clock = new THREE.Clock()
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1)
  const move = readMove()
  player.position.x = THREE.MathUtils.clamp(player.position.x + move.x * SPEED * dt, -19.5, 19.5)
  player.position.z = THREE.MathUtils.clamp(player.position.z - move.y * SPEED * dt, -19.5, 19.5)

  const grounded = player.position.y <= 0.5
  if (grounded && jumpPressed()) velocityY = 9
  velocityY -= GRAVITY * dt
  player.position.y = Math.max(0.5, player.position.y + velocityY * dt)
  if (player.position.y === 0.5) velocityY = Math.max(velocityY, 0)
  player.rotation.y += move.x * dt * 3

  for (let i = coins.length - 1; i >= 0; i--) {
    const coin = coins[i]
    coin.rotation.y += dt * 3
    if (coin.position.distanceTo(player.position) < 1) {
      scene.remove(coin)
      coins.splice(i, 1)
      score++
      scoreEl.textContent = String(score)
      spawnCoin()
    }
  }

  camera.position.lerp(new THREE.Vector3(player.position.x, 9, player.position.z + 12), 1 - Math.exp(-dt * 4))
  camera.lookAt(player.position)
  renderer.render(scene, camera)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
