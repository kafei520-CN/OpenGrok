import os
import shutil

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = os.path.join(root, "resources", "pet")
dst = os.path.join(root, "desktop", "pet-assets")
os.makedirs(dst, exist_ok=True)
log = []
log.append(f"root={root}")
log.append(f"src exists={os.path.isdir(src)} dst={dst}")
if os.path.isdir(src):
    log.append("src files=" + ",".join(os.listdir(src)))
    for name in os.listdir(src):
        if name.endswith(".png"):
            shutil.copy2(os.path.join(src, name), os.path.join(dst, name))
            log.append(f"copied {name} {os.path.getsize(os.path.join(dst, name))}")
log.append("dst files=" + ",".join(os.listdir(dst) if os.path.isdir(dst) else []))
out = os.path.join(root, "scripts", "copy-pet-assets.log")
with open(out, "w", encoding="utf-8") as handle:
    handle.write("\n".join(log))
print("\n".join(log))
