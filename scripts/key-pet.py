from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(
    r"C:\Users\mckafei\.grok\sessions\c%3A%5CUsers%5Cmckafei%5CDesktop%5COpenGrok\01a093b5-aaaa-7ea2-a4ad-7aa3acfa4f81\images"
)
OUT = ROOT / "resources" / "pet"
MAP = {
    "4.jpg": "pixel-idle.png",
    "5.jpg": "pixel-think.png",
    "23.jpg": "anime-idle.png",
    "24.jpg": "anime-blink.png",
    "25.jpg": "anime-think.png",
    "18.jpg": "adult-idle.png",
    "21.jpg": "adult-blink.png",
    "22.jpg": "adult-think.png",
}


def key_green(im: Image.Image) -> Image.Image:
    arr = np.array(im.convert("RGBA")).astype(np.float32)
    r, g, b = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2]
    dist = g - np.maximum(r, b)
    green = (g > 70) & (g > r * 1.25) & (g > b * 1.25)
    alpha = np.clip(255.0 - np.maximum(dist - 12.0, 0.0) * 5.5, 0, 255)
    arr[:, :, 3] = np.where(green, alpha, 255)
    out = Image.fromarray(arr.astype(np.uint8), "RGBA")
    bbox = out.getbbox()
    if bbox:
        pad = 8
        x0, y0, x1, y1 = bbox
        x0 = max(0, x0 - pad)
        y0 = max(0, y0 - pad)
        x1 = min(out.width, x1 + pad)
        y1 = min(out.height, y1 + pad)
        out = out.crop((x0, y0, x1, y1))
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for src_name, dest_name in MAP.items():
        src = SRC / src_name
        if not src.exists():
            raise SystemExit(f"missing {src}")
        keyed = key_green(Image.open(src))
        dest = OUT / dest_name
        keyed.save(dest)
        print(dest.name, keyed.size)


if __name__ == "__main__":
    main()
