"""Build installer icons from resources/logo.png: rounded tile + multi-size ICO."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "resources" / "logo.png"
OUT_PNG = ROOT / "resources" / "icon.png"
OUT_ICO = ROOT / "resources" / "icon.ico"
MASTER = 1024
RADIUS = 225
ICO_SIZES = [(16, 16), (20, 20), (24, 24), (32, 32), (40, 40), (48, 48), (64, 64), (128, 128), (256, 256)]


def rounded_mask(size: int, radius: int) -> Image.Image:
    scale = 4
    big = size * scale
    r = radius * scale
    mask = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, big - 1, big - 1), radius=r, fill=255)
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def main() -> None:
    src = Image.open(SRC).convert("RGBA").resize((MASTER, MASTER), Image.Resampling.LANCZOS)
    src.putalpha(rounded_mask(MASTER, RADIUS))
    src.save(OUT_PNG, format="PNG")
    src.save(OUT_ICO, format="ICO", sizes=ICO_SIZES)
    check = Image.open(OUT_PNG)
    print(f"png {check.size} {check.mode}")
    print(f"ico {OUT_ICO.stat().st_size} bytes")


if __name__ == "__main__":
    main()
