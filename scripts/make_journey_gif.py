"""
Creates docs/demo-extension-journey.gif
Full user journey: idle → confirming → paying → analyzing → done
All frames drawn from scratch (correct prices, correct layout matching panel.ts CSS).
"""

from PIL import Image, ImageDraw, ImageFont
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = os.path.join(ROOT, "vscode-extension", "media")

# ── Canvas from real screenshot ──────────────────────────────────────────────
base = Image.open(os.path.join(MEDIA, "01-idle.png")).convert("RGB")
W, H = base.size  # 608 × 432

# ── Colors (from panel.ts CSS) ───────────────────────────────────────────────
C_BG       = (30,  30,  30)    # #1e1e1e  sideBar background
C_CARD     = (37,  37,  38)    # #252526  editor background / card
C_BORDER   = (62,  62,  66)    # #3e3e42  panel border
C_FG       = (204, 204, 204)   # foreground
C_MUTED    = (107, 107, 107)   # descriptionForeground
C_PURPLE   = (124,  58, 237)   # #7c3aed
C_PURPLE_L = (168,  85, 247)   # #a855f7  lighter purple
C_GREEN    = ( 34, 197,  94)   # #22c55e
C_WHITE    = (255, 255, 255)
C_INV_BG   = ( 13,  17,  23)   # #0d1117  invoice box bg
C_INV_BD   = ( 48,  54,  61)   # #30363d  invoice box border
C_INV_TXT  = (139, 148, 158)   # #8b949e  invoice monospace text
C_BADGE_BG = ( 26,  15,  46)   # rgba(124,58,237,.15) approx
C_BADGE_BD = ( 62,  29, 118)   # rgba(124,58,237,.3) approx
C_ORNG     = (245, 158,  11)   # ⚡ lightning color

# ── Fonts ────────────────────────────────────────────────────────────────────
def load_font(name, size):
    for p in [
        f"C:/Windows/Fonts/{name}.ttf",
        f"C:/Windows/Fonts/{name.lower()}.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    ]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def load_mono(size):
    for p in [
        "C:/Windows/Fonts/consola.ttf",
        "C:/Windows/Fonts/cour.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    ]:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

f_logo   = load_font("segoeuib",  13)
f_sub    = load_font("segoeui",   10)
f_body   = load_font("segoeui",   11)
f_bold   = load_font("segoeuib",  11)
f_small  = load_font("segoeui",   10)
f_label  = load_font("segoeuib",   9)
f_btn    = load_font("segoeuib",  12)
f_mono   = load_mono(9)
f_badge  = load_font("segoeuib",  12)

# ── Layout ───────────────────────────────────────────────────────────────────
PAD    = 12
LOGO_H = 88      # logo section height (cropped from real screenshot)
BTN_H  = 28
R_CARD = 8
R_BTN  = 6

# ── Helpers ──────────────────────────────────────────────────────────────────
def rrect(d, xy, r, fill=None, outline=None, width=1):
    d.rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=width)

def text_w(d, text, font):
    bb = d.textbbox((0, 0), text, font=font)
    return bb[2] - bb[0]

def text_h(d, text, font):
    bb = d.textbbox((0, 0), text, font=font)
    return bb[3] - bb[1]

def centered(d, text, font, color, box):
    x0, y0, x1, y1 = box
    tw = text_w(d, text, font)
    th = text_h(d, text, font)
    d.text((x0 + (x1 - x0 - tw) // 2, y0 + (y1 - y0 - th) // 2), text, fill=color, font=font)

def canvas():
    img = Image.new("RGB", (W, H), C_BG)
    img.paste(base.crop((0, 0, W, LOGO_H)), (0, 0))
    return img

def card_top(d, img, title_color=None):
    """Returns (img, draw, y_start) — logo already pasted."""
    return LOGO_H + 10

def draw_label(d, x, y, text):
    d.text((x, y), text.upper(), fill=C_MUTED, font=f_label)
    return y + text_h(d, text, f_label) + 5

def draw_lightning(d, cx, cy, size=7, color=C_ORNG):
    """Draws a small lightning bolt polygon centered at (cx, cy)."""
    pts = [
        (cx + size*0.1, cy - size),
        (cx - size*0.15, cy - size*0.05),
        (cx + size*0.2, cy - size*0.05),
        (cx - size*0.1, cy + size),
        (cx + size*0.15, cy + size*0.05),
        (cx - size*0.2, cy + size*0.05),
    ]
    d.polygon(pts, fill=color)

def draw_primary_btn(d, x0, y, x1, label, disabled=False):
    y1 = y + BTN_H
    fill = (75, 58, 106) if disabled else C_PURPLE
    txt_c = (156, 163, 175) if disabled else C_WHITE
    rrect(d, (x0, y, x1, y1), R_BTN, fill=fill)
    centered(d, label, f_btn, txt_c, (x0, y, x1, y1))
    return y1 + 8

def draw_secondary_btn(d, x0, y, x1, label, small=False):
    y1 = y + (22 if small else BTN_H)
    rrect(d, (x0, y, x1, y1), R_BTN if not small else 5, outline=C_BORDER, width=1)
    f = f_small if small else f_body
    centered(d, label, f, C_FG if not small else C_MUTED, (x0, y, x1, y1))
    return y1 + 6

# ══════════════════════════════════════════════════════════════════════════════
# FRAME 1 — Idle (hint + Connect GitHub + Analyze Repo)
# ══════════════════════════════════════════════════════════════════════════════
def frame_idle():
    img = canvas()
    d = ImageDraw.Draw(img)
    y = LOGO_H + 12
    x0, x1 = PAD, W - PAD

    # Hint text
    line1a = "Open a GitHub repo in VS Code, then click "
    line1b = "Analyze"
    line2  = "to generate an interactive architecture diagram."
    d.text((x0, y), line1a, fill=C_FG, font=f_body)
    cx = x0 + text_w(d, line1a, f_body)
    d.text((cx, y), line1b, fill=C_FG, font=f_bold)
    y += text_h(d, "A", f_body) + 3
    d.text((x0, y), line2, fill=C_FG, font=f_body)
    y += text_h(d, "A", f_body) + 14

    # Connect GitHub secondary button
    y = draw_secondary_btn(d, x0, y, x1, "Connect GitHub  (optional)")

    # Analyze Repo primary button (with lightning bolt)
    btn_y0, btn_y1 = y, y + BTN_H
    rrect(d, (x0, btn_y0, x1, btn_y1), R_BTN, fill=C_PURPLE)
    lbl = "  Analyze Repo"
    total_w = 12 + text_w(d, lbl, f_btn)
    sx = x0 + ((x1 - x0) - total_w) // 2
    draw_lightning(d, sx + 5, (btn_y0 + btn_y1) // 2, size=6, color=C_ORNG)
    d.text((sx + 12, btn_y0 + (BTN_H - text_h(d, lbl, f_btn)) // 2), lbl, fill=C_WHITE, font=f_btn)
    y = btn_y1 + 18

    # Divider
    d.line([(x0, y), (x1, y)], fill=(50, 50, 55), width=1)
    y += 12

    # Value-prop bullets (fill dead space + communicate value)
    bullets = [
        ("Claude reads your entire codebase",     "Detects services, frameworks, all connections"),
        ("Interactive diagram in your browser",    "Animated flows · 80+ logos · minimap"),
        ("Share with your team forever",           "/g/:id permanent link · SVG/PNG export"),
    ]
    for title, sub in bullets:
        bx = x0 + 2
        # Bullet dot
        dot_y = y + 5
        d.ellipse((bx, dot_y, bx + 5, dot_y + 5), fill=C_PURPLE_L)
        d.text((bx + 10, y), title, fill=C_FG, font=f_bold)
        y += text_h(d, "A", f_bold) + 2
        d.text((bx + 10, y), sub, fill=C_MUTED, font=f_small)
        y += text_h(d, "A", f_small) + 10
    return img

# ══════════════════════════════════════════════════════════════════════════════
# FRAME 2 — Confirming (Full tier selected, correct prices)
# ══════════════════════════════════════════════════════════════════════════════
def frame_confirming():
    img = canvas()
    d = ImageDraw.Draw(img)
    x0, x1 = PAD, W - PAD
    y = LOGO_H + 10

    # Card background
    card_y0 = y
    card_h = 200
    rrect(d, (x0, card_y0, x1, card_y0 + card_h), R_CARD, fill=C_CARD, outline=C_BORDER, width=1)

    y = card_y0 + 10
    ix = x0 + 10  # inner x

    # Repository label + URL
    y = draw_label(d, ix, y, "Repository")
    d.text((ix, y), "https://github.com/vercel/next.js", fill=C_PURPLE_L, font=f_body)
    y += text_h(d, "A", f_body) + 10

    # Tier label
    y = draw_label(d, ix, y, "Analysis tier")

    # Tier buttons (Basic / Full selected / Live)
    tiers = [
        ("Basic",  "2,000 sats",  False),
        ("Full",   "10,000 sats", True),
        ("Live",   "25,000 sats", False),
    ]
    tw = (x1 - ix - 10 - 10) // 3
    btn_y0 = y
    btn_y1 = btn_y0 + 36
    for i, (name, price, active) in enumerate(tiers):
        bx0 = ix + i * (tw + 5)
        bx1 = bx0 + tw
        fill    = (26, 15, 46)  if active else None
        border  = C_PURPLE     if active else C_BORDER
        name_c  = C_PURPLE_L   if active else C_FG
        price_c = C_MUTED
        rrect(d, (bx0, btn_y0, bx1, btn_y1), 5, fill=fill, outline=border, width=1)
        th = text_h(d, name, f_bold)
        ph = text_h(d, price, f_small)
        total_h = th + 2 + ph
        ny = btn_y0 + (36 - total_h) // 2
        centered(d, name, f_bold, name_c, (bx0, ny, bx1, ny + th))
        centered(d, price, f_small if i != 1 else f_small, price_c, (bx0, ny + th + 2, bx1, ny + th + 2 + ph))
    y = btn_y1 + 10

    # Promo code field
    y = draw_label(d, ix, y, "Promo code (optional)")
    field_y1 = y + 22
    rrect(d, (ix, y, x1 - 10, field_y1), 5, outline=C_BORDER, width=1)
    d.text((ix + 8, y + 5), "e.g. PRIMAL", fill=C_MUTED, font=f_small)
    y = field_y1 + 10

    # Analyze button
    # Draw lightning bolt before "Analyze"
    btn_y0 = y
    btn_y1 = y + BTN_H
    rrect(d, (ix, btn_y0, x1 - 10, btn_y1), R_BTN, fill=C_PURPLE)
    lbl = "  Analyze"
    lw = text_w(d, lbl, f_btn)
    total_w = 14 + lw
    start_x = ix + ((x1 - 10 - ix) - total_w) // 2
    draw_lightning(d, start_x + 5, (btn_y0 + btn_y1) // 2, size=6, color=C_ORNG)
    d.text((start_x + 14, btn_y0 + (BTN_H - text_h(d, lbl, f_btn)) // 2), lbl, fill=C_WHITE, font=f_btn)
    y = btn_y1 + 8
    return img

# ══════════════════════════════════════════════════════════════════════════════
# FRAME 3 — Paying (QR code + Lightning)
# ══════════════════════════════════════════════════════════════════════════════
def draw_qr(d, cx, cy, size=108):
    """Draws a realistic QR code (not scannable, but visually authentic)."""
    import random
    rng = random.Random(42)
    modules = 21
    cell = max(1, size // modules)
    actual = cell * modules
    ox = cx - actual // 2
    oy = cy - actual // 2
    quiet = cell * 2

    # White background (quiet zone)
    d.rectangle((ox - quiet, oy - quiet, ox + actual + quiet, oy + actual + quiet), fill=(255, 255, 255))

    def finder(fx, fy):
        d.rectangle((fx, fy, fx + 7*cell, fy + 7*cell), fill=(0, 0, 0))
        d.rectangle((fx + cell, fy + cell, fx + 6*cell, fy + 6*cell), fill=(255, 255, 255))
        d.rectangle((fx + 2*cell, fy + 2*cell, fx + 5*cell, fy + 5*cell), fill=(0, 0, 0))

    finder(ox, oy)
    finder(ox + (modules - 7) * cell, oy)
    finder(ox, oy + (modules - 7) * cell)

    # Timing patterns
    for i in range(8, modules - 8):
        c = (0, 0, 0) if i % 2 == 0 else (255, 255, 255)
        d.rectangle((ox + i*cell, oy + 6*cell, ox + (i+1)*cell, oy + 7*cell), fill=c)
        d.rectangle((ox + 6*cell, oy + i*cell, ox + 7*cell, oy + (i+1)*cell), fill=c)

    # Format / alignment dots
    d.rectangle((ox + 8*cell, oy + 8*cell, ox + 9*cell, oy + 9*cell), fill=(0, 0, 0))

    reserved = set()
    for r in range(9):
        for c in range(9):
            reserved.add((r, c))
    for r in range(modules - 8, modules):
        for c in range(9):
            reserved.add((r, c))
    for r in range(9):
        for c in range(modules - 8, modules):
            reserved.add((r, c))
    for i in range(modules):
        reserved.add((6, i))
        reserved.add((i, 6))

    # Data modules — denser fill looks more like a real invoice QR
    for row in range(modules):
        for col in range(modules):
            if (row, col) in reserved:
                continue
            if rng.random() < 0.48:
                d.rectangle(
                    (ox + col*cell, oy + row*cell, ox + (col+1)*cell, oy + (row+1)*cell),
                    fill=(0, 0, 0)
                )


def frame_paying():
    img = canvas()
    d = ImageDraw.Draw(img)
    x0, x1 = PAD, W - PAD
    CX = W // 2    # horizontal center

    y = LOGO_H + 10
    card_y0 = y
    card_h = 270
    rrect(d, (x0, card_y0, x1, card_y0 + card_h), R_CARD, fill=C_CARD, outline=C_BORDER, width=1)
    y = card_y0 + 10
    ix = x0 + 10

    # ── Status dot + title ──────────────────────────────────────────────────
    dot_r = 4
    dot_cy = y + dot_r + 2
    d.ellipse((ix, dot_cy - dot_r, ix + dot_r * 2, dot_cy + dot_r), fill=C_PURPLE)
    d.text((ix + dot_r * 2 + 6, y), "Waiting for payment…", fill=C_FG, font=f_body)
    y += 18 + 6

    # ── Amount badge — centered ─────────────────────────────────────────────
    badge_inner = "  10,000 sats  —  Full"
    bw = 14 + text_w(d, badge_inner, f_badge) + 16
    bh = 24
    bx0 = CX - bw // 2
    rrect(d, (bx0, y, bx0 + bw, y + bh), 12, fill=C_BADGE_BG, outline=C_BADGE_BD, width=1)
    draw_lightning(d, bx0 + 10, y + bh // 2, size=6, color=C_ORNG)
    d.text((bx0 + 18, y + (bh - text_h(d, badge_inner, f_badge)) // 2), badge_inner, fill=C_PURPLE_L, font=f_badge)
    y += bh + 10

    # ── QR Code — centered ─────────────────────────────────────────────────
    qr_size = 110
    qr_cy = y + qr_size // 2 + 4
    draw_qr(d, CX, qr_cy, size=qr_size)
    y = qr_cy + qr_size // 2 + 12

    # ── Wallet instruction ──────────────────────────────────────────────────
    scan_text = "Scan with any Lightning wallet"
    tw = text_w(d, scan_text, f_body)
    d.text((CX - tw // 2, y), scan_text, fill=C_FG, font=f_body)
    y += text_h(d, "A", f_body) + 4

    wallets = "Wallet of Satoshi  ·  Alby  ·  Phoenix  ·  Muun"
    tw2 = text_w(d, wallets, f_small)
    d.text((CX - tw2 // 2, y), wallets, fill=C_MUTED, font=f_small)
    y += text_h(d, "A", f_small) + 12

    # ── Copy Invoice button — primary CTA (purple) ─────────────────────────
    draw_primary_btn(d, ix, y, x1 - 10, "Copy Invoice")

    return img

# ══════════════════════════════════════════════════════════════════════════════
# FRAME 3b — Payment Confirmed (paidConfirmed state — paste preimage)
# ══════════════════════════════════════════════════════════════════════════════
def frame_paid_confirmed():
    img = canvas()
    d = ImageDraw.Draw(img)
    x0, x1 = PAD, W - PAD
    CX = W // 2
    y = LOGO_H + 10
    ix = x0 + 10

    card_h = 195
    rrect(d, (x0, y, x1, y + card_h), R_CARD, fill=C_CARD, outline=C_BORDER, width=1)
    iy = y + 10

    # Green dot + "Payment received"
    dot_r = 4
    d.ellipse((ix, iy + 2, ix + dot_r * 2, iy + 2 + dot_r * 2), fill=C_GREEN)
    d.text((ix + dot_r * 2 + 6, iy), "Payment received", fill=C_FG, font=f_body)
    iy += 18 + 6

    # Amount badge (green tint this time)
    badge_inner = "  10,000 sats  —  Full"
    bw = 14 + text_w(d, badge_inner, f_badge) + 16
    bh = 24
    bx0 = CX - bw // 2
    green_badge_bg = (13, 35, 20)
    green_badge_bd = (34, 75, 46)
    rrect(d, (bx0, iy, bx0 + bw, iy + bh), 12, fill=green_badge_bg, outline=green_badge_bd, width=1)
    draw_lightning(d, bx0 + 10, iy + bh // 2, size=6, color=C_GREEN)
    d.text((bx0 + 18, iy + (bh - text_h(d, badge_inner, f_badge)) // 2), badge_inner, fill=C_GREEN, font=f_badge)
    iy += bh + 10

    # Green confirmation box
    box_h = 110
    rrect(d, (ix, iy, x1 - 10, iy + box_h), 6, fill=(13, 35, 20), outline=(34, 75, 46), width=1)
    biy = iy + 10
    bix = ix + 8

    # "Payment confirmed!" title
    d.ellipse((bix, biy + 3, bix + 8, biy + 11), fill=C_GREEN)
    d.text((bix + 14, biy), "Payment confirmed!", fill=C_GREEN, font=f_bold)
    biy += 18

    # Instruction text
    hint1 = "Your wallet received a payment proof (preimage)."
    hint2 = "Paste the 64-char hex below to start analysis."
    d.text((bix, biy), hint1, fill=C_MUTED, font=f_small)
    biy += 13
    d.text((bix, biy), hint2, fill=C_MUTED, font=f_small)
    biy += 16

    # Preimage input field (green border, blinking cursor hint)
    field_y1 = biy + 22
    rrect(d, (bix, biy, x1 - 18, field_y1), 4, fill=C_INV_BG, outline=(34, 100, 55), width=1)
    d.text((bix + 6, biy + 5), "a3f7e2b1...  (64 hex chars)", fill=(60, 100, 70), font=f_mono)
    biy = field_y1 + 8

    # Submit button (disabled state — no preimage yet)
    btn_y1 = biy + BTN_H - 4
    rrect(d, (bix, biy, x1 - 18, btn_y1), R_BTN, fill=(50, 90, 60))
    centered(d, "Submit & Generate Diagram", f_body, (100, 150, 110), (bix, biy, x1 - 18, btn_y1))

    return img


# ══════════════════════════════════════════════════════════════════════════════
# FRAMES 4 & 5 — Analyzing (step 4 and step 9)
# ══════════════════════════════════════════════════════════════════════════════
ANALYZING_DATA = {
    4: {
        "files": [
            ("package.json",             "43 packages"),
            ("next.config.js",           "Next.js detected"),
            ("docker-compose.yml",       "postgres · redis"),
            ("src/server/index.ts",      "entry point"),
            ("src/middleware.ts",        "auth layer"),
            ("tsconfig.json",            "TypeScript strict"),
        ],
        "detected": ["Next.js", "TypeScript", "Docker", "PostgreSQL", "Redis"],
    },
    9: {
        "files": [
            ("src/api/routes.ts",        "12 endpoints"),
            ("prisma/schema.prisma",     "8 models"),
            ("src/lib/redis.ts",         "cache layer"),
            (".github/workflows/ci.yml", "CI pipeline"),
            ("vercel.json",              "Edge runtime"),
            ("src/lib/s3.ts",            "S3 storage"),
        ],
        "detected": ["Next.js", "PostgreSQL", "Redis", "S3", "GitHub Actions", "Vercel"],
    },
}
DESC_COL = 190   # fixed x for right-side descriptions (two-column layout)

def frame_analyzing(step, label):
    img = canvas()
    d = ImageDraw.Draw(img)
    x0, x1 = PAD, W - PAD
    y = LOGO_H + 10

    card_h = 62
    rrect(d, (x0, y, x1, y + card_h), R_CARD, fill=C_CARD, outline=C_BORDER, width=1)
    inner_y = y + 10
    ix = x0 + 10

    # Status dot + text + step counter
    dot_r = 4
    dot_cy = inner_y + dot_r + 2
    d.ellipse((ix, dot_cy - dot_r, ix + dot_r * 2, dot_cy + dot_r), fill=C_PURPLE)
    d.text((ix + dot_r * 2 + 6, inner_y), "Analyzing with Claude…", fill=C_FG, font=f_body)
    step_lbl = f"{step}/12"
    d.text((x1 - 10 - text_w(d, step_lbl, f_small), inner_y + 1), step_lbl, fill=C_MUTED, font=f_small)
    inner_y += 16 + 6

    # Progress bar (4px, more visible)
    bar_x0, bar_x1 = ix, x1 - 10
    bar_h = 4
    d.rounded_rectangle((bar_x0, inner_y, bar_x1, inner_y + bar_h), radius=2, fill=(33, 38, 45))
    pct = min(0.95, step / 12.0)
    fill_x1 = int(bar_x0 + (bar_x1 - bar_x0) * pct)
    if fill_x1 > bar_x0:
        d.rounded_rectangle((bar_x0, inner_y, fill_x1, inner_y + bar_h), radius=2, fill=C_PURPLE)
    inner_y += bar_h + 8
    d.text((ix, inner_y), f"Step {step} — {label}", fill=C_MUTED, font=f_small)

    # ── Two-column file list ──────────────────────────────────────────────────
    data   = ANALYZING_DATA.get(step, {"files": [], "detected": []})
    files  = data["files"]
    fy = y + card_h + 10
    for fname, desc in files:
        d.rectangle((x0 + 2, fy + 3, x0 + 7, fy + 8), fill=(62, 62, 66))
        d.text((x0 + 12, fy), fname, fill=C_FG, font=f_mono)
        d.text((x0 + DESC_COL, fy + 1), desc, fill=C_MUTED, font=f_small)
        fy += 14

    # ── Detected tech (fills remaining space) ─────────────────────────────────
    detected = data["detected"]
    fy += 8
    d.line([(x0, fy), (x1, fy)], fill=(50, 50, 55), width=1)
    fy += 8
    d.text((x0, fy), "Detected so far:", fill=C_MUTED, font=f_small)
    fy += 14
    tx = x0
    for tech in detected:
        tw = text_w(d, tech, f_small)
        pill_w = tw + 12
        pill_h = 18
        if tx + pill_w > x1 - 4:
            tx = x0
            fy += pill_h + 4
        rrect(d, (tx, fy, tx + pill_w, fy + pill_h), 9, outline=C_BORDER, width=1)
        d.text((tx + 6, fy + (pill_h - text_h(d, tech, f_small)) // 2), tech, fill=C_FG, font=f_small)
        tx += pill_w + 6
    return img

# ══════════════════════════════════════════════════════════════════════════════
# FRAME 6 — Done
# ══════════════════════════════════════════════════════════════════════════════
def frame_done():
    img = canvas()
    d = ImageDraw.Draw(img)
    x0, x1 = PAD, W - PAD
    y = LOGO_H + 10
    ix = x0 + 10

    # Card with green border
    card_h = 170
    green_border = (34, 75, 46)
    rrect(d, (x0, y, x1, y + card_h), R_CARD, fill=C_CARD, outline=green_border, width=1)
    inner_y = y + 10

    # Green dot + "Diagram ready"
    dot_r = 4
    dot_cy = inner_y + dot_r + 2
    d.ellipse((ix, dot_cy - dot_r, ix + dot_r * 2, dot_cy + dot_r), fill=C_GREEN)
    d.text((ix + dot_r * 2 + 6, inner_y), "Diagram ready", fill=C_WHITE, font=f_bold)
    inner_y += 18 + 6

    # Summary
    summary = "Next.js monorepo  —  14 services detected:"
    summary2 = "App Router, Vercel Edge, PostgreSQL/Prisma,"
    summary3 = "Redis cache, S3 storage, GitHub Actions CI."
    for ln in [summary, summary2, summary3]:
        d.text((ix, inner_y), ln, fill=C_MUTED, font=f_body)
        inner_y += text_h(d, "A", f_body) + 2
    inner_y += 4

    # Confidence
    d.text((ix, inner_y), "Confidence: ", fill=C_MUTED, font=f_body)
    cx = ix + text_w(d, "Confidence: ", f_body)
    d.text((cx, inner_y), "91%", fill=C_GREEN, font=f_bold)
    inner_y += text_h(d, "A", f_small) + 10

    # Open Interactive Diagram button
    draw_primary_btn(d, ix, inner_y, x1 - 10, "Open Interactive Diagram")
    card_bottom = y + card_h + 8

    # Benchmark + Diff buttons (2 columns)
    half = (x1 - x0 - 6) // 2
    by = card_bottom
    draw_secondary_btn(d, x0, by, x0 + half, "Benchmark")
    draw_secondary_btn(d, x0 + half + 6, by, x1, "Diff")
    by_end = by + BTN_H + 6
    draw_secondary_btn(d, x0, by_end, x1, "Analyze another repo")

    # Share link teaser — fills remaining space, shows permanent URL value
    share_y = by_end + BTN_H + 16
    d.line([(x0, share_y), (x1, share_y)], fill=(50, 50, 55), width=1)
    share_y += 10
    share_label = "Your diagram is live at:"
    d.text((x0, share_y), share_label, fill=C_MUTED, font=f_small)
    share_y += text_h(d, "A", f_small) + 3
    d.text((x0, share_y), "forge.l402kit.com/g/7b1046a4...", fill=C_PURPLE_L, font=f_mono)
    return img

# ══════════════════════════════════════════════════════════════════════════════
# Build frames
# ══════════════════════════════════════════════════════════════════════════════
frames = [
    (frame_idle(),                                        3500),
    (frame_confirming(),                                  4000),
    (frame_paying(),                                      6000),
    (frame_paid_confirmed(),                              5000),
    (frame_analyzing(4, "reading entry points…"),         2500),
    (frame_analyzing(9, "mapping services and edges…"),   2500),
    (frame_done(),                                        5000),
]

CROP_H = 420   # paying frame (card_h=270 + logo 88 + padding) is ~390px

gif_frames = []
gif_durations = []
for img, dur in frames:
    cropped = img.crop((0, 0, W, CROP_H))
    gif_frames.append(cropped.convert("P", palette=Image.Palette.ADAPTIVE, colors=128))
    gif_durations.append(dur)

out = os.path.join(ROOT, "docs", "demo-extension-journey.gif")
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
print(f"OK journey GIF -> {out}  ({size_kb} KB, {len(frames)} frames)")
