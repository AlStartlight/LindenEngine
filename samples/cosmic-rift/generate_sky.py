#!/usr/bin/env python3
"""Generate the equirectangular cosmic sky for the Cosmic Rift demo.

Pure numpy, no external assets. Writes a Radiance .hdr (RGBE, flat scanlines) that three's
RGBELoader and the Linden AssetLoader understand. Also writes a tonemapped PNG for review.

    python3 samples/cosmic-rift/generate_sky.py
"""
import math
import os
import sys

import numpy as np
from PIL import Image

W, H = 4096, 2048
OUT_HDR = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "hdri", "cosmic_rift.hdr")


def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def value_noise_3d(px, py, pz, freq, seed):
    rng = np.random.default_rng(seed)
    n = max(2, int(freq))
    grid = rng.random((n, n, n)).astype(np.float32)
    x = (px * n) % n
    y = (py * n) % n
    z = (pz * n) % n
    i0 = np.floor(x).astype(np.int32) % n; j0 = np.floor(y).astype(np.int32) % n; k0 = np.floor(z).astype(np.int32) % n
    fx = smooth(x - i0); fy = smooth(y - j0); fz = smooth(z - k0)
    i1 = (i0 + 1) % n; j1 = (j0 + 1) % n; k1 = (k0 + 1) % n
    def g(a, b, c):
        return grid[a, b, c]
    c00 = g(i0, j0, k0) * (1 - fx) + g(i1, j0, k0) * fx
    c10 = g(i0, j1, k0) * (1 - fx) + g(i1, j1, k0) * fx
    c01 = g(i0, j0, k1) * (1 - fx) + g(i1, j0, k1) * fx
    c11 = g(i0, j1, k1) * (1 - fx) + g(i1, j1, k1) * fx
    c0 = c00 * (1 - fy) + c10 * fy
    c1 = c01 * (1 - fy) + c11 * fy
    return c0 * (1 - fz) + c1 * fz


def fbm3(px, py, pz, octaves, seed, base=3.0):
    total = np.zeros_like(px, dtype=np.float32)
    amp = 1.0
    norm = 0.0
    f = base
    for i in range(octaves):
        total += amp * value_noise_3d(px, py, pz, f, seed + i * 37)
        norm += amp
        amp *= 0.5
        f *= 2.0
    return total / norm


def main():
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    lon = (xx / W) * 2 * math.pi - math.pi
    lat = (0.5 - yy / H) * math.pi
    dx = np.cos(lat) * np.sin(lon)
    dy = np.sin(lat)
    dz = np.cos(lat) * np.cos(lon)

    # Deep space base with a subtle blue-violet gradient
    rgb = np.zeros((H, W, 3), dtype=np.float32)
    rgb += np.array([0.006, 0.008, 0.020], dtype=np.float32)
    rgb += np.array([0.010, 0.006, 0.022], dtype=np.float32) * (0.5 + 0.5 * dy)[..., None]

    # Nebula clouds
    n1 = fbm3(dx, dy, dz, 6, 11, base=2.2)
    n2 = fbm3(dx * 0.7 + 3.1, dy * 0.7, dz * 1.3 - 2.0, 6, 29, base=2.8)
    cloud = smooth((n1 * 0.7 + n2 * 0.3 - 0.34) * 3.2)
    violet = np.array([0.22, 0.05, 0.45], dtype=np.float32)
    teal = np.array([0.02, 0.22, 0.40], dtype=np.float32)
    blue = np.array([0.05, 0.10, 0.50], dtype=np.float32)
    mix1 = smooth((n2 - 0.45) * 3.0)[..., None]
    nebula = violet * (1 - mix1) + teal * mix1
    nebula = nebula * 0.55 + blue * 0.45
    rgb += nebula * cloud[..., None] * 0.55

    # The Rift: a bright diagonal band (great circle) with turbulent edges
    band = np.abs(dx * 0.55 + dy * 0.75 + dz * 0.12)
    band = np.exp(-(band ** 2) / (0.0022 + 0.012 * n1 * n1))
    rgb += np.array([0.06, 0.22, 0.75], dtype=np.float32) * band[..., None] * 0.35
    rgb += np.array([0.20, 0.45, 1.0], dtype=np.float32) * (band ** 5)[..., None] * 0.55

    # Distant galaxies: compact elliptical glows
    rng = np.random.default_rng(7)
    for _ in range(9):
        cx, cy = rng.uniform(0, W), rng.uniform(H * 0.12, H * 0.88)
        sx, sy = rng.uniform(8, 26), rng.uniform(5, 14)
        ang = rng.uniform(0, math.pi)
        gx = (xx - cx) * math.cos(ang) + (yy - cy) * math.sin(ang)
        gy = -(xx - cx) * math.sin(ang) + (yy - cy) * math.cos(ang)
        glow = np.exp(-((gx / sx) ** 2 + (gy / sy) ** 2))
        tint = np.array([0.9, 0.8, 1.0]) * rng.uniform(0.5, 1.4)
        rgb += glow[..., None] * tint * 0.9
        core = np.exp(-((gx / (sx * 0.18)) ** 2 + (gy / (sy * 0.18)) ** 2))
        rgb += core[..., None] * np.array([1.0, 0.95, 0.85]) * 3.0

    # Stars: uniform directions, random brightness and colour temperature
    stars = 9000
    u = rng.random(stars)
    v = rng.random(stars)
    star_lon = u * 2 * math.pi - math.pi
    star_lat = np.arcsin(2 * v - 1)
    sx = ((star_lon + math.pi) / (2 * math.pi) * W).astype(int) % W
    sy = ((0.5 - star_lat / math.pi) * H).astype(int).clip(0, H - 1)
    brightness = rng.power(5.0, stars) * 5.0 + 0.10
    warm = rng.random(stars)
    colors = np.stack([np.ones(stars), 0.85 + 0.15 * warm, 0.75 + 0.35 * (1 - warm)], axis=1)
    for i in range(stars):
        cx, cy = sx[i], sy[i]
        sig = 0.35 + rng.random() * 0.55
        rad = int(sig * 3)
        x0, x1 = max(0, cx - rad), min(W, cx + rad + 1)
        y0, y1 = max(0, cy - rad), min(H, cy + rad + 1)
        gy, gx = np.mgrid[y0:y1, x0:x1]
        f = np.exp(-(((gx - cx) ** 2 + (gy - cy) ** 2) / (2 * sig * sig)))
        rgb[y0:y1, x0:x1] += f[..., None] * colors[i] * brightness[i]

    rgb = np.clip(rgb, 0, None)

    # Save HDR (Radiance RGBE, flat scanlines). The IBL probe does not need the full 4K sky,
    # so it is downsampled 2x; the sharp 4096px PNG is what the camera sees.
    hdr = rgb.reshape(H // 2, 2, W // 2, 2, 3).mean(axis=(1, 3))
    hdr_h, hdr_w = hdr.shape[:2]
    v = np.maximum(hdr.max(axis=2), 1e-32)
    e = np.floor(np.log2(v)).astype(np.int32) + 1
    scale = np.exp2(8 - e)
    rgbe = np.zeros((hdr_h, hdr_w, 4), dtype=np.uint8)
    rgbe[..., :3] = np.clip(hdr * scale[..., None], 0, 255).astype(np.uint8)
    rgbe[..., 3] = np.clip(e + 128, 0, 255).astype(np.uint8)
    os.makedirs(os.path.dirname(os.path.abspath(OUT_HDR)), exist_ok=True)
    with open(OUT_HDR, "wb") as fh:
        fh.write(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n")
        fh.write(f"-Y {hdr_h} +X {hdr_w}\n".encode("ascii"))
        fh.write(rgbe.tobytes())

    # Tonemapped preview for review
    disp = 1.0 - np.exp(-rgb * 1.6)
    disp = np.clip(disp, 0, 1) ** (1 / 2.2)
    Image.fromarray((disp * 255).astype(np.uint8)).save(os.path.join(os.path.dirname(__file__), "cosmic_sky_preview.png"))
    print("wrote", os.path.abspath(OUT_HDR), os.path.getsize(OUT_HDR), "bytes")


if __name__ == "__main__":
    sys.exit(main())
