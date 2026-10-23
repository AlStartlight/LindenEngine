/**
 * Coordinate and Units Converter across Unity, Godot, and Linden
 *
 * Implements:
 * - 3D Right-Handed (Godot/Linden) <-> Left-Handed (Unity)
 *   Position Z-axis inversion: (x, y, z) <-> (x, y, -z)
 *   Quaternion: (x, y, z, w) <-> (-x, -y, z, w)
 * - 2D Y-down pixels (Godot/Linden) <-> Y-up units with PPU (Unity)
 */

export class CoordinateConverter {
  /**
   * Convert 3D position between Unity (LH) and Linden/Godot (RH)
   */
  static unityToLinden3DPos(pos: [number, number, number]): [number, number, number] {
    return [pos[0], pos[1], -pos[2]]
  }

  static lindenToUnity3DPos(pos: [number, number, number]): [number, number, number] {
    return [pos[0], pos[1], -pos[2]]
  }

  /**
   * Convert 3D rotation quaternion between Unity (LH) and Linden/Godot (RH)
   * Formula: (x, y, z, w) -> (-x, -y, z, w)
   */
  static unityToLindenQuat(q: [number, number, number, number]): [number, number, number, number] {
    return [-q[0], -q[1], q[2], q[3]]
  }

  static lindenToUnityQuat(q: [number, number, number, number]): [number, number, number, number] {
    return [-q[0], -q[1], q[2], q[3]]
  }

  /**
   * Convert 2D position: Unity (Y-up units with PPU) -> Linden (Y-down pixels)
   */
  static unityToLinden2DPos(pos: [number, number], ppu: number = 100): [number, number] {
    return [pos[0] * ppu, -pos[1] * ppu]
  }

  /**
   * Convert 2D position: Linden (Y-down pixels) -> Unity (Y-up units with PPU)
   */
  static lindenToUnity2DPos(pos: [number, number], ppu: number = 100): [number, number] {
    const safePpu = ppu > 0 ? ppu : 100
    return [pos[0] / safePpu, -pos[1] / safePpu]
  }
}
