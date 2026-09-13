from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DIRS = [ROOT / "resources" / "pet", ROOT / "desktop" / "pet-assets"]
SETS = [
    ("anime-idle.png", "anime-blink.png", "anime-think.png"),
    ("adult-idle.png", "adult-blink.png", "adult-think.png"),
    ("pixel-idle.png", "pixel-think.png"),
]


def align(other: Image.Image, idle: Image.Image) -> Image.Image:
    idle_box = idle.getbbox()
    other_box = other.getbbox()
    if not idle_box or not other_box:
        return other
    crop = other.crop(other_box)
    canvas = Image.new("RGBA", idle.size, (0, 0, 0, 0))
    idle_cx = (idle_box[0] + idle_box[2]) / 2
    idle_bottom = idle_box[3]
    x = round(idle_cx - crop.width / 2)
    y = idle_bottom - crop.height
    canvas.paste(crop, (x, y), crop)
    return canvas


def main() -> None:
    lines = []
    for folder in DIRS:
        if not folder.is_dir():
            continue
        for names in SETS:
            idle = Image.open(folder / names[0]).convert("RGBA")
            for name in names[1:]:
                path = folder / name
                src = Image.open(path).convert("RGBA")
                aligned = align(src, idle)
                aligned.save(path)
                lines.append(f"{folder.name}/{name} content {src.getbbox()} -> {aligned.getbbox()}")
    log = ROOT / "scripts" / "align-pet-content.log"
    log.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
