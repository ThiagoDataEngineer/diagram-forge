"""
Creates docs/demo-github-connect.gif
Frames:
  1. Idle — "Connect GitHub (optional)" secondary button visible
  2. Idle — green dot "GitHub connected" + Disconnect button
"""

from PIL import Image, ImageDraw, ImageFont
import os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ── Load base screenshot and detect exact colors ────────────────────────────
base = Image.open(os.path.join(ROOT, "vscode-extension/media/01-idle.png")).convert("RGB")
W, H = base.size  # 608 × 432

# Sample exact background color from a known-empty corner
BG = base.getpixel((W - 4, H - 4))           # bottom-right corner → dark bg
PANEL_BG = base.getpixel((W // 2, H - 60))   # center bottom → same bg

# ── Fonts ────────────────────────────────────────────────────────────────────
def load_font(name, size):
    candidates = [
        f"C:/Windows/Fonts/{name}.ttf",
        f"C:/Windows/Fonts/{name.lower()}.ttf",
        f"/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]
    for p in candidates:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

font_body    = load_font("segoeui",   13)
font_bold    = load_font("segoeuib",  13)
font_small   = load_font("segoeui",   11)
font_tiny    = load_font("segoeui",   10)

# ── Colors ───────────────────────────────────────────────────────────────────
C_BG       = BG
C_FG       = (204, 204, 204)
C_MUTED    = (106, 106, 106)
C_PURPLE   = (124,  58, 237)
C_PURPLE_H = (109,  40, 217)
C_GREEN    = ( 34, 197,  94)
C_BORDER   = ( 62,  62,  66)
C_WHITE    = (255, 255, 255)

# ── Layout constants (measured from 01-idle.png) ────────────────────────────
PAD        = 16   # left/right padding
LOGO_H     = 88   # height of logo + separator section (crop from base)
HINT_Y     = LOGO_H + 16
BTN_H      = 42   # button height
BTN_R      = 8    # button corner radius
CONTENT_W  = W - PAD * 2

# ── Helper: rounded rect ─────────────────────────────────────────────────────
def rrect(draw, xy, r, fill=None, outline=None, width=1):
    x0, y0, x1, y1 = xy
    draw.rounded_rectangle((x0, y0, x1, y1), radius=r, fill=fill, outline=outline, width=width)

# ── Helper: centered text in a box ──────────────────────────────────────────
def centered_text(draw, text, font, color, box):
    x0, y0, x1, y1 = box
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    tx = x0 + (x1 - x0 - tw) // 2
    ty = y0 + (y1 - y0 - th) // 2
    draw.text((tx, ty), text, fill=color, font=font)

# ── Build a base canvas with logo from the real screenshot ──────────────────
def make_canvas():
    img = Image.new("RGB", (W, H), C_BG)
    # Paste logo section from real screenshot (pixel-perfect match)
    logo_crop = base.crop((0, 0, W, LOGO_H))
    img.paste(logo_crop, (0, 0))
    return img

# ── Draw hint text (multiline) ───────────────────────────────────────────────
def draw_hint(draw, y):
    lines = [
        ("Open a GitHub repo in VS Code, then click ", False),
        ("Analyze", True),
        (" to generate an interactive architecture diagram.", False),
    ]
    x = PAD
    # measure height of one line
    h = draw.textbbox((0, 0), "A", font=font_body)[3]
    # render inline — split into two visual lines
    line1_parts = [
        ("Open a GitHub repo in VS Code, then click ", False),
        ("Analyze", True),
    ]
    line2 = " to generate an interactive architecture diagram."

    cx = x
    for text, bold in line1_parts:
        f = font_bold if bold else font_body
        draw.text((cx, y), text, fill=C_FG, font=f)
        bx = draw.textbbox((cx, y), text, font=f)
        cx = bx[2]

    draw.text((x, y + h + 4), line2, fill=C_FG, font=font_body)
    return y + h * 2 + 4 + 10  # return next Y

# ── Draw secondary button (Connect GitHub) ───────────────────────────────────
def draw_secondary_btn(draw, y, label):
    x0, x1 = PAD, W - PAD
    y0, y1 = y, y + BTN_H
    rrect(draw, (x0, y0, x1, y1), BTN_R, outline=C_BORDER, width=1)
    centered_text(draw, label, font_small, C_FG, (x0, y0, x1, y1))
    return y1 + 10

# ── Draw primary button (Analyze Repo) ──────────────────────────────────────
def draw_primary_btn(draw, y, label="  Analyze Repo"):
    x0, x1 = PAD, W - PAD
    y0, y1 = y, y + BTN_H
    rrect(draw, (x0, y0, x1, y1), BTN_R, fill=C_PURPLE)
    centered_text(draw, label, font_bold, C_WHITE, (x0, y0, x1, y1))
    return y1

# ── Draw connected status row ────────────────────────────────────────────────
def draw_connected(draw, y):
    # Green dot
    dot_r = 4
    dot_x, dot_y = PAD, y + BTN_H // 2
    draw.ellipse((dot_x - dot_r, dot_y - dot_r, dot_x + dot_r, dot_y + dot_r), fill=C_GREEN)

    # "GitHub connected" text
    draw.text((PAD + 14, y + BTN_H // 2 - 6), "GitHub connected", fill=C_GREEN, font=font_small)

    # "Disconnect" small secondary button on the right
    d_label = "Disconnect"
    d_bbox = draw.textbbox((0, 0), d_label, font=font_tiny)
    d_w = d_bbox[2] - d_bbox[0] + 18
    d_h = 24
    d_x0 = W - PAD - d_w
    d_y0 = y + (BTN_H - d_h) // 2
    d_x1 = W - PAD
    d_y1 = d_y0 + d_h
    rrect(draw, (d_x0, d_y0, d_x1, d_y1), 5, outline=C_BORDER, width=1)
    centered_text(draw, d_label, font_tiny, C_MUTED, (d_x0, d_y0, d_x1, d_y1))

    return y + BTN_H + 10

# ── FRAME 1 — Before connect ─────────────────────────────────────────────────
f1 = make_canvas()
d1 = ImageDraw.Draw(f1)
y = draw_hint(d1, HINT_Y)
y = draw_secondary_btn(d1, y, "Connect GitHub  (optional)")
draw_primary_btn(d1, y)

# ── FRAME 2 — After connect ──────────────────────────────────────────────────
f2 = make_canvas()
d2 = ImageDraw.Draw(f2)
y = draw_hint(d2, HINT_Y)
y = draw_connected(d2, y)
draw_primary_btn(d2, y)

# ── Crop both frames to content area (remove black bottom) ───────────────────
CROP_H = 320
f1 = f1.crop((0, 0, W, CROP_H))
f2 = f2.crop((0, 0, W, CROP_H))

# ── Build GIF ────────────────────────────────────────────────────────────────
frames = [
    (f1, 3000),   # Before: show long enough to read
    (f2, 3500),   # After:  show connected state
]

gif_frames = []
gif_durations = []
for img, dur in frames:
    gif_frames.append(img.convert("P", palette=Image.Palette.ADAPTIVE, colors=128))
    gif_durations.append(dur)

out = os.path.join(ROOT, "docs", "demo-github-connect.gif")
gif_frames[0].save(
    out,
    save_all=True,
    append_images=gif_frames[1:],
    loop=0,
    duration=gif_durations,
    disposal=2,
    optimize=False,
)
size_kb = os.path.getsize(out) // 1024
print(f"OK github-connect GIF -> {out}  ({size_kb} KB)")
