# Panduan Blueprint Visual Scripting - Linden Engine

## Apa itu Blueprint?

Blueprint adalah sistem **visual scripting** yang memungkinkan Anda membuat game logic tanpa menulis kode. Mirip dengan:
- **Unreal Engine Blueprints**
- **Unity Visual Scripting**

## 🎮 Cara Menambahkan Blueprint ke Game Object

### 1. Menggunakan BlueprintComponent

```typescript
import { Entity } from '@engine/ecs/Entity'
import { BlueprintComponent, BlueprintRegistry } from '@engine/blueprints/BlueprintComponent'
import { BlueprintGraph } from '@engine/blueprints/BlueprintGraph'

// Buat Entity (Game Object)
const player = new Entity('Player')

// Cara 1: Buat Blueprint baru
const myBlueprint = new BlueprintGraph('PlayerController')
const blueprintComponent = new BlueprintComponent(myBlueprint)
player.addComponent(blueprintComponent)

// Cara 2: Gunakan template yang sudah ada
const helloComponent = BlueprintRegistry.createComponent('HelloWorld')
if (helloComponent) {
  player.addComponent(helloComponent)
}
```

### 2. Membangun Blueprint Graph secara Programatik

```typescript
import { BlueprintGraph, BlueprintPinType } from '@engine/blueprints/BlueprintGraph'

// Buat blueprint baru
const blueprint = new BlueprintGraph('MyPlayerBlueprint')

// 1. Tambahkan Event Begin Play (akan dipanggil saat game mulai)
const beginPlay = blueprint.createNode('EventBeginPlay')
beginPlay.position = { x: 0, y: 0 }

// 2. Tambahkan Print String node
const printNode = blueprint.createNode('PrintString')
printNode.position = { x: 300, y: 0 }

// 3. Hubungkan node-node tersebut
const execOut = beginPlay.outputPins.find(p => p.type === BlueprintPinType.EXEC)
const execIn = printNode.inputPins.find(p => p.type === BlueprintPinType.EXEC)
if (execOut && execIn) {
  blueprint.connect(beginPlay.id, execOut.id, printNode.id, execIn.id)
}

// 4. Tambahkan variabel
blueprint.addVariable('Health', BlueprintPinType.INTEGER, 100)
blueprint.addVariable('PlayerName', BlueprintPinType.STRING, 'Hero')
```

## 🖥️ Cara Menjalankan Blueprint Editor

### Langkah 1: Jalankan Development Server

```bash
# Di terminal, navigasi ke folder project
cd /Users/asepjumadi/Documents/GItlab/LindenEngine

# Install dependencies (jika belum)
npm install

# Jalankan editor
npm run dev
```

### Langkah 2: Buka Editor di Browser

Setelah server berjalan, buka browser dan pergi ke:
```
http://localhost:5173
```

### Langkah 3: Akses Blueprint Editor

Di dalam editor, Blueprint Editor dapat diakses dengan mengubah EditorLayout untuk menampilkan panel Blueprint Editor.

## 📝 Node Types yang Tersedia

### Event Nodes (Merah)
| Node | Deskripsi |
|------|-----------|
| `EventBeginPlay` | Dipanggil saat game mulai |
| `EventTick` | Dipanggil setiap frame |
| `EventInputAction` | Dipanggil saat input terdeteksi |
| `EventOnOverlapBegin` | Dipanggil saat ada collision |

### Flow Control (Biru)
| Node | Deskripsi |
|------|-----------|
| `Branch` | If/Else condition |
| `Sequence` | Execute multiple paths |
| `ForLoop` | Loop dengan counter |
| `ForEachLoop` | Loop melalui array |
| `WhileLoop` | Loop dengan kondisi |
| `Delay` | Tunggu beberapa detik |
| `Gate` | On/Off gate |

### Variable Nodes (Hijau)
| Node | Deskripsi |
|------|-----------|
| `GetVariable` | Ambil nilai variabel |
| `SetVariable` | Set nilai variabel |

### Math Nodes (Kuning)
| Node | Deskripsi |
|------|-----------|
| `Add` | Tambah dua angka |
| `Subtract` | Kurang dua angka |
| `Multiply` | Kali dua angka |
| `Divide` | Bagi dua angka |
| `Clamp` | Batasi nilai min/max |
| `Lerp` | Linear interpolation |
| `RandomFloat` | Angka random |

### Comparison Nodes
| Node | Deskripsi |
|------|-----------|
| `Equal` | A == B |
| `Greater` | A > B |
| `Less` | A < B |

### Action Nodes (Ungu)
| Node | Deskripsi |
|------|-----------|
| `PrintString` | Print ke console |
| `SpawnActor` | Spawn entity baru |
| `DestroyActor` | Hapus entity |
| `SetActorLocation` | Pindahkan entity |
| `GetActorLocation` | Ambil posisi entity |
| `AddMovementInput` | Gerakkan entity |
| `PlaySound` | Mainkan audio |

### Input Nodes
| Node | Deskripsi |
|------|-----------|
| `GetAxisValue` | Nilai input axis (-1 to 1) |
| `IsInputKeyDown` | Cek tombol ditekan |

## 🎯 Contoh Blueprint: Player Movement

```typescript
import { BlueprintGraph, BlueprintPinType } from '@engine/blueprints/BlueprintGraph'

function createPlayerMovementBlueprint(): BlueprintGraph {
  const bp = new BlueprintGraph('PlayerMovement')
  
  // Variabel
  bp.addVariable('MoveSpeed', BlueprintPinType.FLOAT, 500)
  
  // Event Tick - dipanggil setiap frame
  const tick = bp.createNode('EventTick')
  tick.position = { x: 0, y: 0 }
  
  // Get input horizontal
  const axisH = bp.createNode('GetAxisValue')
  axisH.position = { x: 200, y: 100 }
  
  // Multiply dengan speed
  const multiply = bp.createNode('Multiply')
  multiply.position = { x: 400, y: 50 }
  
  // Add movement
  const move = bp.createNode('AddMovementInput')
  move.position = { x: 600, y: 0 }
  
  // Connect execution
  bp.connect(tick.id, tick.outputPins[0].id, move.id, move.inputPins[0].id)
  
  return bp
}
```

## 🔧 Keyboard Shortcuts di Blueprint Editor

| Shortcut | Action |
|----------|--------|
| `Delete` | Hapus node terpilih |
| `Ctrl + Z` | Undo |
| `Ctrl + Y` | Redo |
| `Ctrl + D` | Duplicate node |
| `Ctrl + C` | Copy |
| `Ctrl + V` | Paste |
| `Space` | Buka node palette |

## 🎨 Cara Membuat Node di Editor

### Dari Palette (Panel Kiri)
1. Klik dan tahan node dari palette
2. Drag ke canvas
3. Lepas untuk membuat node

### Dari Context Menu
1. Klik kanan di canvas kosong
2. Pilih node dari menu
3. Node akan muncul di posisi kursor

### Menghubungkan Node
1. Klik output pin (sebelah kanan node)
2. Drag ke input pin node lain
3. Lepas untuk membuat koneksi

### Warna Pin
- **Putih (Exec)**: Alur eksekusi
- **Merah (Boolean)**: True/False
- **Cyan (Integer)**: Angka bulat
- **Hijau (Float)**: Angka desimal
- **Magenta (String)**: Teks
- **Kuning (Vector3)**: Posisi/Rotasi
- **Biru (Object)**: Referensi object

## 📦 Save & Load Blueprint

```typescript
// Save
const serialized = blueprint.serialize()
const json = JSON.stringify(serialized)
localStorage.setItem('myBlueprint', json)

// Load
const data = JSON.parse(localStorage.getItem('myBlueprint'))
const loadedBlueprint = BlueprintGraph.deserialize(data)
```

## 🚀 Tips & Best Practices

1. **Gunakan Comment**: Beri nama deskriptif pada node
2. **Organize dengan Position**: Susun node dari kiri ke kanan
3. **Pisahkan Logic**: Gunakan Functions untuk logic yang berulang
4. **Gunakan Variables**: Jangan hardcode nilai, gunakan variabel
5. **Test Incremental**: Test blueprint secara bertahap

## ❓ Troubleshooting

### Blueprint tidak jalan
- Pastikan ada `EventBeginPlay` atau `EventTick` node
- Pastikan node terhubung dengan benar (exec pins)
- Cek console untuk error messages

### Node tidak terhubung
- Pin harus compatible (warna sama)
- Output hanya bisa ke Input
- Exec pins harus terhubung untuk menjalankan node

### Nilai tidak berubah
- Cek apakah `SetVariable` terhubung di execution flow
- Pastikan nama variabel benar
