"""
Creates:
  1. docs/demo-extension-journey.gif  — 4-state panel slideshow (idle → confirming → analyzing → done)
  2. docs/demo-extension-fixed.gif    — demo-extension.gif with disposal method corrected
"""

from PIL import Image
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ─── 1. JOURNEY GIF from static PNGs ────────────────────────────────────────

FRAMES = [
    ("vscode-extension/media/01-idle.png",       2800),
    ("vscode-extension/media/02-confirming.png", 3000),
    ("vscode-extension/media/03-analyzing.png",  3000),
    ("vscode-extension/media/04-done.png",       3500),
]

BG_COLOR = (30, 30, 30)   # VS Code dark #1e1e1e

# Determine canvas dimensions
images = [(Image.open(os.path.join(ROOT, p)).convert("RGB"), d) for p, d in FRAMES]
canvas_w = max(img.width for img, _ in images)
canvas_h = max(img.height for img, _ in images)

# Build frames: center each screenshot on the dark canvas
gif_frames = []
gif_durations = []

for img, duration in images:
    canvas = Image.new("RGB", (canvas_w, canvas_h), BG_COLOR)
    x = (canvas_w - img.width) // 2
    y = (canvas_h - img.height) // 2
    canvas.paste(img, (x, y))
    # Convert to P (palette) mode for GIF with a good quantizer
    gif_frames.append(canvas.convert("P", palette=Image.Palette.ADAPTIVE, colors=128))
    gif_durations.append(duration)

out_journey = os.path.join(ROOT, "docs", "demo-extension-journey.gif")
gif_frames[0].save(
    out_journey,
    save_all=True,
    append_images=gif_frames[1:],
    loop=0,
    duration=gif_durations,
    disposal=2,        # restore to background before each new frame — no ghosting
    optimize=False,
)
print(f"OK Journey GIF -> {out_journey}  ({os.path.getsize(out_journey)//1024} KB)")


# ─── 2. FIX demo-extension.gif disposal ─────────────────────────────────────

src = os.path.join(ROOT, "vscode-extension", "media", "demo-extension.gif")
out_fixed = os.path.join(ROOT, "docs", "demo-extension-fixed.gif")

src_gif = Image.open(src)
fixed_frames = []
fixed_durations = []

bg = Image.new("RGBA", src_gif.size, (0, 0, 0, 0))
canvas = bg.copy()

frame_idx = 0
try:
    while True:
        src_gif.seek(frame_idx)
        frame = src_gif.convert("RGBA")
        duration = src_gif.info.get("duration", 150)

        # Composite this frame onto current canvas
        canvas = Image.alpha_composite(canvas, frame)
        fixed_frames.append(canvas.convert("RGB").convert("P", palette=Image.Palette.ADAPTIVE, colors=128))
        fixed_durations.append(duration)

        frame_idx += 1
except EOFError:
    pass

if fixed_frames:
    fixed_frames[0].save(
        out_fixed,
        save_all=True,
        append_images=fixed_frames[1:],
        loop=0,
        duration=fixed_durations,
        disposal=2,
        optimize=False,
    )
    print(f"OK Fixed GIF -> {out_fixed}  ({os.path.getsize(out_fixed)//1024} KB)")
else:
    print("No frames extracted from demo-extension.gif")