from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
LAYOUT = ROOT / "public" / "assets" / "match-intro" / "bp-layout"
SOURCE = LAYOUT / "pick-frames.png"
OUTPUT = LAYOUT / "pick-frame-foreground.png"

# Clear only the portrait windows. Borders, name plates and lower ribbons remain
# above the character artwork so a portrait can never visually cross its frame.
PORTRAIT_WINDOWS = (
    (29, 650, 197, 799),
    (222, 650, 390, 799),
    (414, 650, 582, 799),
    (607, 650, 775, 799),
    (29, 884, 197, 1033),
    (222, 884, 390, 1033),
    (414, 884, 582, 1033),
    (607, 884, 775, 1033),
    (1144, 717, 1472, 1008),
    (1532, 717, 1860, 1008),
)


image = Image.open(SOURCE).convert("RGBA")
for box in PORTRAIT_WINDOWS:
    image.paste((0, 0, 0, 0), box)
image.save(OUTPUT, optimize=True)
