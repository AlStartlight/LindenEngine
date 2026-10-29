/**
 * Typical real-world sizes of common objects, in meters (width x along the front, height y,
 * depth z). The agent reads this before modelling (linden_model_build returns the entry for the
 * model's category) and the validator compares a model's bounding box with it.
 * Sources: furniture/ergonomics standards (BIFMA, Neufert), manufacturer catalogues, typical values.
 */

export interface RealWorldDimension {
  /** Typical overall size [width, height, depth] in meters */
  size: [number, number, number]
  /** Important sub-dimensions (seat height, table top thickness...) in meters */
  details?: Record<string, number>
  aliases?: string[]
  note?: string
}

export const REAL_WORLD_DIMENSIONS: Record<string, RealWorldDimension> = {
  // Furniture
  chair: { size: [0.46, 0.85, 0.52], details: { seatHeight: 0.45, seatDepth: 0.42, seatWidth: 0.42, backrestTop: 0.85, legThickness: 0.035 }, aliases: ['kursi', 'dining chair', 'kursi makan'] },
  armchair: { size: [0.8, 0.85, 0.85], details: { seatHeight: 0.42, armHeight: 0.62 }, aliases: ['kursi santai', 'sofa chair'] },
  office_chair: { size: [0.65, 1.1, 0.65], details: { seatHeight: 0.48, baseDiameter: 0.65 }, aliases: ['kursi kantor'] },
  stool: { size: [0.35, 0.45, 0.35], details: { seatHeight: 0.45 }, aliases: ['bangku', 'dingklik'] },
  bar_stool: { size: [0.4, 0.75, 0.4], details: { seatHeight: 0.75 }, aliases: ['kursi bar'] },
  dining_table: { size: [1.6, 0.75, 0.9], details: { topThickness: 0.035, legThickness: 0.06, kneeClearance: 0.65 }, aliases: ['table', 'meja', 'meja makan'] },
  coffee_table: { size: [1.1, 0.42, 0.6], details: { topThickness: 0.03 }, aliases: ['meja tamu', 'meja kopi'] },
  desk: { size: [1.4, 0.75, 0.7], details: { topThickness: 0.025 }, aliases: ['meja kerja', 'meja belajar'] },
  side_table: { size: [0.5, 0.55, 0.5], aliases: ['meja samping', 'nakas', 'nightstand'] },
  sofa: { size: [2.0, 0.85, 0.9], details: { seatHeight: 0.43, armHeight: 0.62 }, aliases: ['sofa 3 dudukan', 'couch'] },
  bed_single: { size: [0.95, 0.5, 2.05], details: { mattressTop: 0.5 }, aliases: ['kasur single', 'ranjang single'] },
  bed_double: { size: [1.65, 0.55, 2.1], details: { mattressTop: 0.55, headboard: 1.1 }, aliases: ['kasur double', 'ranjang', 'bed', 'queen bed'] },
  wardrobe: { size: [1.2, 2.0, 0.6], aliases: ['lemari pakaian', 'lemari'] },
  bookshelf: { size: [0.8, 1.8, 0.3], details: { shelfSpacing: 0.33, shelfThickness: 0.02 }, aliases: ['rak buku', 'shelf'] },
  kitchen_counter: { size: [1.8, 0.9, 0.6], details: { counterHeight: 0.9 }, aliases: ['meja dapur', 'kitchen cabinet'] },
  tv_stand: { size: [1.6, 0.5, 0.4], aliases: ['meja tv', 'bufet'] },
  // Doors, windows, architecture
  door: { size: [0.9, 2.0, 0.04], details: { handleHeight: 1.0 }, aliases: ['pintu'] },
  door_frame: { size: [1.0, 2.1, 0.12], aliases: ['kusen pintu'] },
  window: { size: [1.2, 1.2, 0.08], details: { sillHeight: 0.9 }, aliases: ['jendela'] },
  wall: { size: [4.0, 2.8, 0.15], details: { ceilingHeight: 2.8 }, aliases: ['dinding', 'tembok'] },
  stair_step: { size: [1.0, 0.17, 0.28], details: { riser: 0.17, tread: 0.28 }, aliases: ['anak tangga', 'step'] },
  fence: { size: [2.0, 1.2, 0.05], aliases: ['pagar'] },
  house: { size: [9.0, 6.5, 10.0], aliases: ['rumah'] },
  // Lighting
  desk_lamp: { size: [0.18, 0.45, 0.18], details: { baseDiameter: 0.15, shadeDiameter: 0.18 }, aliases: ['lampu meja', 'table lamp'] },
  floor_lamp: { size: [0.4, 1.6, 0.4], details: { baseDiameter: 0.3 }, aliases: ['lampu lantai', 'lampu berdiri'] },
  pendant_lamp: { size: [0.35, 0.3, 0.35], aliases: ['lampu gantung'] },
  street_lamp: { size: [0.4, 6.0, 1.2], aliases: ['lampu jalan', 'tiang lampu'] },
  light_bulb: { size: [0.06, 0.11, 0.06], aliases: ['bohlam'] },
  // Tableware & household
  drinking_glass: { size: [0.075, 0.12, 0.075], details: { wallThickness: 0.0025, volumeLiters: 0.3 }, aliases: ['gelas', 'glass', 'tumbler'] },
  wine_glass: { size: [0.08, 0.2, 0.08], aliases: ['gelas anggur'] },
  mug: { size: [0.12, 0.095, 0.085], details: { diameter: 0.082 }, aliases: ['cangkir', 'mug'] },
  plate: { size: [0.27, 0.025, 0.27], aliases: ['piring'] },
  bowl: { size: [0.16, 0.07, 0.16], aliases: ['mangkuk'] },
  bottle: { size: [0.075, 0.3, 0.075], details: { volumeLiters: 0.75 }, aliases: ['botol', 'wine bottle'] },
  vase: { size: [0.18, 0.3, 0.18], aliases: ['vas', 'vas bunga'] },
  potted_plant: { size: [0.4, 0.8, 0.4], aliases: ['tanaman pot', 'pot tanaman'] },
  book: { size: [0.15, 0.23, 0.03], aliases: ['buku'] },
  laptop: { size: [0.32, 0.018, 0.22], details: { openHeight: 0.23 }, aliases: ['laptop'] },
  monitor: { size: [0.62, 0.45, 0.2], aliases: ['monitor', 'layar komputer'] },
  television: { size: [1.23, 0.71, 0.08], details: { diagonalInches: 55 }, aliases: ['tv', 'televisi'] },
  refrigerator: { size: [0.7, 1.8, 0.7], aliases: ['kulkas', 'lemari es'] },
  washing_machine: { size: [0.6, 0.85, 0.6], aliases: ['mesin cuci'] },
  toilet: { size: [0.38, 0.78, 0.7], details: { seatHeight: 0.42 }, aliases: ['kloset'] },
  bathtub: { size: [1.7, 0.55, 0.75], aliases: ['bak mandi'] },
  sink: { size: [0.5, 0.85, 0.45], aliases: ['wastafel'] },
  trash_can: { size: [0.3, 0.45, 0.3], aliases: ['tempat sampah'] },
  // Vehicles
  car_sedan: { size: [1.8, 1.45, 4.5], details: { wheelDiameter: 0.65, wheelbase: 2.7, groundClearance: 0.15 }, aliases: ['mobil', 'sedan', 'car'] },
  car_sports: { size: [1.95, 1.2, 4.5], details: { wheelDiameter: 0.68, wheelbase: 2.65, groundClearance: 0.11 }, aliases: ['mobil sport', 'sports car'], note: 'lebar termasuk spion ~2.0 m' },
  suv: { size: [1.9, 1.75, 4.8], details: { wheelDiameter: 0.75 }, aliases: ['mobil suv'] },
  pickup_truck: { size: [2.0, 1.9, 5.8], aliases: ['pikap'] },
  bus: { size: [2.55, 3.2, 12.0], aliases: ['bis'] },
  truck: { size: [2.5, 3.8, 10.0], aliases: ['truk'] },
  motorcycle: { size: [0.8, 1.15, 2.1], details: { wheelDiameter: 0.6, seatHeight: 0.8 }, aliases: ['motor', 'sepeda motor'] },
  scooter: { size: [0.7, 1.15, 1.85], aliases: ['skuter', 'motor matic'] },
  bicycle: { size: [0.6, 1.05, 1.75], details: { wheelDiameter: 0.7, seatHeight: 0.85 }, aliases: ['sepeda'] },
  boat: { size: [2.0, 1.0, 5.0], aliases: ['perahu'] },
  airplane_small: { size: [11.0, 2.7, 8.3], aliases: ['pesawat kecil', 'cessna'] },
  // People & animals
  human_adult: { size: [0.5, 1.7, 0.3], details: { eyeHeight: 1.6, shoulderWidth: 0.45 }, aliases: ['manusia', 'orang', 'person', 'character'] },
  human_child: { size: [0.35, 1.2, 0.22], aliases: ['anak'] },
  dog: { size: [0.3, 0.6, 0.9], aliases: ['anjing'] },
  cat: { size: [0.2, 0.3, 0.46], aliases: ['kucing'] },
  horse: { size: [0.6, 1.6, 2.4], aliases: ['kuda'] },
  cow: { size: [0.8, 1.5, 2.4], aliases: ['sapi'] },
  chicken: { size: [0.25, 0.4, 0.35], aliases: ['ayam'] },
  // Nature
  tree: { size: [4.0, 8.0, 4.0], details: { trunkDiameter: 0.35 }, aliases: ['pohon'] },
  palm_tree: { size: [3.5, 10.0, 3.5], details: { trunkDiameter: 0.3 }, aliases: ['pohon kelapa', 'pohon palem'] },
  bush: { size: [1.2, 1.0, 1.2], aliases: ['semak'] },
  rock: { size: [0.6, 0.4, 0.5], aliases: ['batu'] },
  boulder: { size: [2.0, 1.5, 1.8], aliases: ['batu besar'] },
  flower: { size: [0.08, 0.35, 0.08], aliases: ['bunga'] },
  // Sports & outdoor
  football: { size: [0.22, 0.22, 0.22], aliases: ['bola', 'bola sepak', 'soccer ball'] },
  basketball: { size: [0.24, 0.24, 0.24], aliases: ['bola basket'] },
  basketball_hoop: { size: [1.8, 3.05, 1.2], details: { rimHeight: 3.05 }, aliases: ['ring basket'] },
  football_goal: { size: [7.32, 2.44, 2.0], aliases: ['gawang'] },
  bench: { size: [1.5, 0.8, 0.6], details: { seatHeight: 0.45 }, aliases: ['bangku taman'] },
  stadium_seat: { size: [0.45, 0.8, 0.45], details: { seatHeight: 0.42 }, aliases: ['kursi stadion'] },
  // Containers & props
  crate: { size: [0.6, 0.6, 0.6], aliases: ['peti', 'kotak kayu'] },
  barrel: { size: [0.6, 0.9, 0.6], aliases: ['tong', 'drum'] },
  pallet: { size: [1.2, 0.15, 0.8], aliases: ['palet'] },
  shipping_container: { size: [2.44, 2.59, 6.06], aliases: ['kontainer'] },
  traffic_cone: { size: [0.3, 0.7, 0.3], aliases: ['kerucut lalu lintas'] },
  mailbox: { size: [0.3, 1.1, 0.25], aliases: ['kotak surat'] },
  fire_hydrant: { size: [0.35, 0.75, 0.35], aliases: ['hidran'] },
  // Electronics & small items
  smartphone: { size: [0.072, 0.147, 0.008], aliases: ['hp', 'ponsel', 'phone'] },
  keyboard: { size: [0.44, 0.03, 0.13], aliases: ['keyboard'] },
  speaker: { size: [0.2, 0.33, 0.25], aliases: ['speaker'] },
  guitar: { size: [0.38, 1.0, 0.1], aliases: ['gitar'] },
  piano_upright: { size: [1.5, 1.25, 0.6], aliases: ['piano'] },
  clock_wall: { size: [0.3, 0.3, 0.04], aliases: ['jam dinding'] },
  umbrella: { size: [1.0, 0.9, 1.0], aliases: ['payung'] },
  sword: { size: [0.2, 1.0, 0.04], aliases: ['pedang'] },
  coin: { size: [0.025, 0.002, 0.025], aliases: ['koin'] },
}

/** Find an entry by key or alias (case-insensitive) */
export function findRealWorldDimension(name: string | undefined): { key: string; entry: RealWorldDimension } | null {
  if (!name) return null
  const q = name.trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (REAL_WORLD_DIMENSIONS[q]) return { key: q, entry: REAL_WORLD_DIMENSIONS[q] }
  const spaced = q.replace(/_/g, ' ')
  for (const [key, entry] of Object.entries(REAL_WORLD_DIMENSIONS)) {
    if (entry.aliases?.some((a) => a.toLowerCase() === spaced || a.toLowerCase() === q)) return { key, entry }
  }
  return null
}
