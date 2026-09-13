from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
out = []
for folder in [root / "desktop" / "pet-assets", root / "resources" / "pet"]:
    out.append(f"== {folder}")
    if not folder.is_dir():
        out.append(" missing")
        continue
    for path in sorted(folder.glob("*.png")):
        im = Image.open(path).convert("RGBA")
        bbox = im.getbbox()
        out.append(f"{path.name:22} canvas={im.size} content={bbox}")
(root / "scripts" / "inspect-pet.log").write_text("\n".join(out), encoding="utf-8")
print("\n".join(out))
