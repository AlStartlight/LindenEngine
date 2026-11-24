#!/usr/bin/env python3
"""Generate the portal vortex texture used by the Cosmic Rift gate (assets/sky/portal_swirl.png)."""
import math
import os
import numpy as np
from PIL import Image

S = 512
out = os.path.join(os.path.dirname(__file__), "..", "..", "assets", "sky", "portal_swirl.png")
yy, xx = np.mgrid[0:S, 0:S].astype(np.float32)
x = (xx / (S - 1)) * 2 - 1
y = (yy / (S - 1)) * 2 - 1
r = np.sqrt(x * x + y * y)
theta = np.arctan2(y, x)
# deterministic turbulence
rng = np.random.default_rng(5)
noise = np.zeros_like(r)
for k in range(4):
    f = 2 ** k
    noise += (0.5 ** k) * np.sin(theta * (2 + k) + r * (6 + f) + k * 1.7)
swirl = 0.5 + 0.5 * np.sin(theta * 3 + r * 14 - noise * 2.4)
core = np.exp(-(r ** 2) / 0.05)
ring = np.exp(-((r - 0.55) ** 2) / 0.004)
a = np.clip((1.0 - r) * 2.2, 0, 1) ** 0.7
alpha = np.clip(a * (0.25 + 0.75 * swirl ** 3) + ring * 0.8 + core * 0.9, 0, 1)
col = np.zeros((S, S, 3), np.float32)
col += np.array([0.02, 0.08, 0.35], np.float32)
col += np.array([0.05, 0.45, 1.0], np.float32) * swirl[..., None] * 0.9
col += np.array([0.65, 0.9, 1.0], np.float32) * (core * 0.9 + ring * 0.5)[..., None]
col = np.clip(col, 0, 1) ** (1 / 1.6)
rgba = np.concatenate([(col * 255).astype(np.uint8), (alpha * 255).astype(np.uint8)[..., None]], axis=2)
Image.fromarray(rgba, "RGBA").save(out)
print("wrote", os.path.abspath(out))
