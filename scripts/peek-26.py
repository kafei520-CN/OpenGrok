from pathlib import Path
from PIL import Image

p = Path(
    r"C:\Users\mckafei\.grok\sessions\c%3A%5CUsers%5Cmckafei%5CDesktop%5COpenGrok\01a093b5-aaaa-7ea2-a4ad-7aa3acfa4f81\images\26.jpg"
)
im = Image.open(p).convert("RGB")
w, h = im.size
pts = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1), (w // 2, 2), (2, h // 2)]
lines = [f"size {im.size}"] + [f"{pt} {im.getpixel(pt)}" for pt in pts]
Path(__file__).with_suffix(".log").write_text("\n".join(lines), encoding="utf-8")
print("\n".join(lines))
