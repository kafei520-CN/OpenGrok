from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1] / "desktop" / "pet-assets"
for name in sorted(root.glob("*.png")):
    im = Image.open(name).convert("RGBA")
    pix = list(im.getdata())
    opaque = sum(1 for p in pix if p[3] > 32)
    print(f"{name.name:20} {im.size} opaque={opaque} ratio={opaque / max(1, len(pix)):.3f}")
