from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DIRS = [ROOT / "resources" / "pet", ROOT / "desktop" / "pet-assets"]
SETS = [
    ("anime-idle.png", "anime-blink.png", "anime-think.png"),
    ("adult-idle.png", "adult-blink.png", "adult-think.png"),
    ("pixel-idle.png", "pixel-think.png"),
]


def unify(folder: Path, names: tuple[str, ...]) -> None:
    frames = []
    for name in names:
        path = folder / name
        if not path.exists():
            raise SystemExit(f"missing {path}")
        frames.append((name, Image.open(path).convert("RGBA")))
    width = max(im.width for _, im in frames)
    height = max(im.height for _, im in frames)
    for name, im in frames:
        canvas = Image.new("RGBA", (width, height), (0, 0, 0, 0))
        x = (width - im.width) // 2
        y = height - im.height
        canvas.paste(im, (x, y), im)
        canvas.save(folder / name)
        print(f"{folder.name}/{name} -> {width}x{height}")


def main() -> None:
    for folder in DIRS:
        if not folder.is_dir():
            continue
        for names in SETS:
            unify(folder, names)


if __name__ == "__main__":
    main()
