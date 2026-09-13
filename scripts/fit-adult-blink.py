from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = Path(
    r"C:\Users\mckafei\.grok\sessions\c%3A%5CUsers%5Cmckafei%5CDesktop%5COpenGrok\01a093b5-aaaa-7ea2-a4ad-7aa3acfa4f81\images\26.jpg"
)
IDLE = ROOT / "desktop" / "pet-assets" / "adult-idle.png"
OUTS = [
    ROOT / "desktop" / "pet-assets" / "adult-blink.png",
    ROOT / "resources" / "pet" / "adult-blink.png",
]


def main() -> None:
    idle = Image.open(IDLE).convert("RGBA")
    blink = Image.open(SRC).convert("RGBA").resize(idle.size, Image.Resampling.LANCZOS)
    src = np.array(blink)
    dst = np.array(idle)
    out = np.dstack([src[:, :, :3], dst[:, :, 3]])
    image = Image.fromarray(out, "RGBA")
    for path in OUTS:
        image.save(path)
        print(path.name, image.size, image.getbbox())


if __name__ == "__main__":
    main()
