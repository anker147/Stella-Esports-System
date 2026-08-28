from pathlib import Path

from PIL import Image


ASSET_DIR = Path(__file__).resolve().parents[1] / "public" / "assets" / "match-intro" / "bp-original"
REGIONS = ((0, 1920, 529, 605),)
def remove_ban_frames(path: Path) -> None:
    image = Image.open(path).convert("RGBA")
    pixels = image.load()

    for left, right, top, bottom in REGIONS:
        for y in range(top, bottom):
            for x in range(left, right):
                pixels[x, y] = (0, 0, 0, 0)

    image.save(path, optimize=True)


for shell_name in ("base-shell.png", "cover-shell.png"):
    remove_ban_frames(ASSET_DIR / shell_name)
