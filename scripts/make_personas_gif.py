"""
docs/demo-personas-paying.gif
Layout: VS Code extension panel (left) | 2×2 persona grid (right)
3 frames:
  1. QR visible — all 4 personas scanning
  2. Lightning flash — payment in flight
  3. All paid — extension transitions to Analyzing
"""

from PIL import Image, ImageDraw, ImageFont
import math, os, random

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MEDIA = os.path.join(ROOT, "vscode-extension", "media")
base_idle = Image.open(os.path.join(MEDIA, "01-idle.png")).convert("RGB")

# ── Canvas ────────────────────────────────────────────────────────────────────
TOTAL_W = 960
TOTAL_H = 480
PANEL_W = 280    # left: VS Code extension
GRID_W  = TOTAL_W - PANEL_W   # right: persona grid

# ── Colors ────────────────────────────────────────────────────────────────────
C_BG      = (18,  18,  20)
C_PANEL   = (30,  30,  30)
C_CARD    = (37,  37,  38)
C_BORDER  = (62,  62,  66)
C_FG      = (204, 204, 204)
C_MUTED   = (107, 107, 107)
C_PURPLE  = (124,  58, 237)
C_PURPLE_L= (168,  85, 247)
C_GREEN   = ( 34, 197,  94)
C_ORNG    = (245, 158,  11)
C_WHITE   = (255, 255, 255)
C_INV_BG  = ( 13,  17,  23)
C_INV_BD  = ( 48,  54,  61)

# Persona accent colors
P_DEV  = ( 99, 102, 241)   # indigo
P_EXEC = (245, 158,  11)   # amber
P_AI   = ( 20, 184, 166)   # teal
P_MOM  = (236,  72, 153)   # pink

# ── Fonts ─────────────────────────────────────────────────────────────────────
def load_font(name, size):
    for p in [f"C:/Windows/Fonts/{name}.ttf", f"C:/Windows/Fonts/{name.lower()}.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"]:
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def load_mono(size):
    for p in ["C:/Windows/Fonts/consola.ttf","C:/Windows/Fonts/cour.ttf",
              "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"]:
        if os.path.exists(p): return ImageFont.truetype(p, size)
    return ImageFont.load_default()

f_logo   = load_font("segoeuib", 11)
f_sub    = load_font("segoeui",   9)
f_body   = load_font("segoeui",  11)
f_bold   = load_font("segoeuib", 11)
f_name   = load_font("segoeuib", 13)
f_role   = load_font("segoeui",  10)
f_status = load_font("segoeuib", 11)
f_small  = load_font("segoeui",   9)
f_big    = load_font("segoeuib", 22)
f_mono   = load_mono(8)
f_init   = load_font("segoeuib", 30)

# ── Helpers ───────────────────────────────────────────────────────────────────
def tw(d, t, f): bb=d.textbbox((0,0),t,font=f); return bb[2]-bb[0]
def th(d, t, f): bb=d.textbbox((0,0),t,font=f); return bb[3]-bb[1]
def rrect(d, xy, r, fill=None, outline=None, width=1):
    d.rounded_rectangle(xy, radius=r, fill=fill, outline=outline, width=width)
def centered(d, txt, font, color, box):
    x0,y0,x1,y1=box
    d.text((x0+(x1-x0-tw(d,txt,font))//2, y0+(y1-y0-th(d,txt,font))//2), txt, fill=color, font=font)

def draw_lightning_bolt(d, cx, cy, size=7, color=C_ORNG):
    pts = [(cx+size*.1, cy-size),(cx-size*.15,cy-size*.05),(cx+size*.2,cy-size*.05),
           (cx-size*.1,cy+size),(cx+size*.15,cy+size*.05),(-size*.2+cx,cy+size*.05)]
    d.polygon(pts, fill=color)

def draw_qr(d, cx, cy, size=108, bg=(255,255,255), mod=(0,0,0)):
    rng = random.Random(42)
    modules = 21
    cell = max(1, size // modules)
    actual = cell * modules
    ox, oy = cx - actual//2, cy - actual//2
    quiet = cell * 2
    d.rectangle((ox-quiet, oy-quiet, ox+actual+quiet, oy+actual+quiet), fill=bg)
    def finder(fx, fy):
        d.rectangle((fx,fy,fx+7*cell,fy+7*cell), fill=mod)
        d.rectangle((fx+cell,fy+cell,fx+6*cell,fy+6*cell), fill=bg)
        d.rectangle((fx+2*cell,fy+2*cell,fx+5*cell,fy+5*cell), fill=mod)
    finder(ox, oy); finder(ox+(modules-7)*cell, oy); finder(ox, oy+(modules-7)*cell)
    for i in range(8, modules-8):
        c = mod if i%2==0 else bg
        d.rectangle((ox+i*cell,oy+6*cell,ox+(i+1)*cell,oy+7*cell), fill=c)
        d.rectangle((ox+6*cell,oy+i*cell,ox+7*cell,oy+(i+1)*cell), fill=c)
    d.rectangle((ox+8*cell,oy+8*cell,ox+9*cell,oy+9*cell), fill=mod)
    reserved = set()
    for r in range(9):
        for c in range(9): reserved.add((r,c))
    for r in range(modules-8,modules):
        for c in range(9): reserved.add((r,c)); reserved.add((modules-8+r%8,modules-8+c%8))
    for i in range(modules): reserved.add((6,i)); reserved.add((i,6))
    for row in range(modules):
        for col in range(modules):
            if (row,col) in reserved: continue
            if rng.random() < 0.47:
                d.rectangle((ox+col*cell,oy+row*cell,ox+(col+1)*cell,oy+(row+1)*cell), fill=mod)

# ── Left panel: Extension paying state ───────────────────────────────────────
LOGO_H = 66   # scaled logo crop height (original 88px scaled to 280px panel)

def draw_extension_panel(img, frame):
    """Draws the VS Code extension panel on the left PANEL_W pixels."""
    d = ImageDraw.Draw(img)
    # Dark background
    d.rectangle((0, 0, PANEL_W, TOTAL_H), fill=C_PANEL)
    # Vertical separator
    d.line([(PANEL_W, 0), (PANEL_W, TOTAL_H)], fill=(50,50,55), width=1)

    # Logo crop (scaled from 608px to PANEL_W)
    scale = PANEL_W / 608
    logo_px = int(88 * scale)
    logo_crop = base_idle.crop((0, 0, 608, 88)).resize((PANEL_W, logo_px), Image.LANCZOS)
    img.paste(logo_crop, (0, 0))

    PAD = 10
    x0, x1 = PAD, PANEL_W - PAD
    CX = PANEL_W // 2
    y = logo_px + 8

    if frame in (0, 1):   # Scanning / paying
        # Status
        dot_r = 3
        status_c = C_ORNG if frame == 1 else C_PURPLE
        d.ellipse((PAD, y+3, PAD+dot_r*2, y+3+dot_r*2), fill=status_c)
        status_txt = "Payment in flight…" if frame == 1 else "Waiting for payment…"
        d.text((PAD+dot_r*2+5, y), status_txt, fill=C_FG, font=f_body)
        y += 16 + 6

        # Badge
        badge = "  10,000 sats  —  Full"
        bw = 12 + tw(d, badge, f_role) + 14
        bh = 20
        bx = CX - bw//2
        badge_bg = (50,35,15) if frame==1 else (26,15,46)
        badge_bd = (120,80,10) if frame==1 else (62,29,118)
        badge_c  = C_ORNG if frame==1 else C_PURPLE_L
        rrect(d, (bx,y,bx+bw,y+bh), 10, fill=badge_bg, outline=badge_bd, width=1)
        draw_lightning_bolt(d, bx+8, y+bh//2, size=4, color=badge_c)
        d.text((bx+16, y+(bh-th(d,badge,f_role))//2), badge, fill=badge_c, font=f_role)
        y += bh + 8

        # QR code (smaller, fits panel)
        qr_size = 90 if frame == 0 else 90
        qr_cy = y + qr_size//2 + 2
        # flash overlay on frame 1
        if frame == 1:
            # yellow-tinted QR
            draw_qr(d, CX, qr_cy, size=qr_size, bg=(255,240,200), mod=(180,100,0))
        else:
            draw_qr(d, CX, qr_cy, size=qr_size)
        y = qr_cy + qr_size//2 + 8

        # Wallets hint
        wallets = "Alby · Satoshi · Phoenix"
        d.text((CX-tw(d,wallets,f_small)//2, y), wallets, fill=C_MUTED, font=f_small)
        y += 14

        # Copy Invoice button
        rrect(d, (PAD, y, x1, y+24), 5, fill=C_PURPLE)
        centered(d, "Copy Invoice", f_role, C_WHITE, (PAD, y, x1, y+24))

    else:  # frame 2 — analyzing
        # Green status
        dot_r = 3
        d.ellipse((PAD, y+3, PAD+dot_r*2, y+3+dot_r*2), fill=C_GREEN)
        d.text((PAD+dot_r*2+5, y), "Analyzing with Claude…", fill=C_FG, font=f_body)
        y += 18 + 4

        # progress bar
        bar_h = 4
        d.rounded_rectangle((PAD, y, x1, y+bar_h), radius=2, fill=(33,38,45))
        d.rounded_rectangle((PAD, y, PAD+int((x1-PAD)*0.45), y+bar_h), radius=2, fill=C_PURPLE)
        y += bar_h + 6
        d.text((PAD, y), "Step 5 — detecting services…", fill=C_MUTED, font=f_small)
        y += 14

        # Small file list
        files = [("next.config.js","Next.js"), ("docker-compose.yml","postgres · redis"),
                 ("prisma/schema.prisma","8 models")]
        for fname, desc in files:
            d.rectangle((PAD+1, y+3, PAD+5, y+7), fill=C_BORDER)
            d.text((PAD+9, y), fname, fill=C_FG, font=f_mono)
            d.text((PAD+9+tw(d,fname,f_mono)+6, y+1), desc, fill=C_MUTED, font=f_small)
            y += 12

        # Detected pills
        y += 4
        d.text((PAD, y), "Detected:", fill=C_MUTED, font=f_small)
        y += 12
        px = PAD
        for tech in ["Next.js","PostgreSQL","Redis"]:
            pw = tw(d,tech,f_small)+10
            rrect(d, (px,y,px+pw,y+15), 7, outline=C_BORDER, width=1)
            d.text((px+5, y+2), tech, fill=C_FG, font=f_small)
            px += pw + 5


# ── Persona cards ─────────────────────────────────────────────────────────────
PERSONAS = [
    # (initials, name, role, accent_color, device_label)
    ("T",  "Thiago",   "Dev / Builder",    P_DEV,  "VS Code · Alby"),
    ("C",  "Carlos",   "CTO",              P_EXEC, "iPhone · Wallet of Satoshi"),
    ("AI", "Agent-7",  "AI Orchestrator",  P_AI,   "Autonomous · Lightning"),
    ("A",  "Ana",      "Startup Founder",  P_MOM,  "Android · Phoenix"),
]

CELL_W = GRID_W // 2
CELL_H = TOTAL_H // 2

def darken(c, factor=0.15):
    return tuple(max(0, int(v * factor)) for v in c)

def lighten(c, factor=0.3):
    return tuple(min(255, int(v * factor + 230 * (1-factor))) for v in c)

def draw_persona_card(img, col, row, persona, frame):
    d = ImageDraw.Draw(img)
    x0 = PANEL_W + col * CELL_W
    y0 = row * CELL_H
    x1 = x0 + CELL_W
    y1 = y0 + CELL_H
    CX = (x0 + x1) // 2

    initials, name, role, accent, device = persona

    # Card background — subtle accent tint
    bg_tint = darken(accent, 0.08)
    d.rectangle((x0, y0, x1-1, y1-1), fill=bg_tint)

    # Grid lines
    d.line([(x0, y0), (x1, y0)], fill=(45,45,48), width=1)
    d.line([(x0, y0), (x0, y1)], fill=(45,45,48), width=1)

    iy = y0 + 18

    # Avatar circle
    av_r = 32
    av_cx, av_cy = CX, iy + av_r
    # Glow effect on frame 1 (paying)
    if frame == 1:
        for glow_r in range(av_r+14, av_r+2, -3):
            glow_alpha = max(0, int(60 * (1 - (glow_r-av_r)/14)))
            gc = tuple(min(255, v + glow_alpha) for v in bg_tint)
            d.ellipse((av_cx-glow_r, av_cy-glow_r, av_cx+glow_r, av_cy+glow_r), fill=gc)

    d.ellipse((av_cx-av_r, av_cy-av_r, av_cx+av_r, av_cy+av_r), fill=accent)

    # Initials inside avatar
    init_font = f_init if len(initials)==1 else f_bold
    iw = tw(d, initials, init_font)
    ih = th(d, initials, init_font)
    d.text((av_cx - iw//2, av_cy - ih//2), initials, fill=C_WHITE, font=init_font)

    # Special icons for AI persona
    if initials == "AI":
        # Antennas
        d.line([(av_cx-10, av_cy-av_r), (av_cx-14, av_cy-av_r-10)], fill=accent, width=2)
        d.ellipse((av_cx-16, av_cy-av_r-13, av_cx-10, av_cy-av_r-7), fill=C_ORNG)
        d.line([(av_cx+10, av_cy-av_r), (av_cx+14, av_cy-av_r-10)], fill=accent, width=2)
        d.ellipse((av_cx+10, av_cy-av_r-13, av_cx+16, av_cy-av_r-7), fill=C_ORNG)

    iy = av_cy + av_r + 10

    # Name + role
    d.text((CX-tw(d,name,f_name)//2, iy), name, fill=C_WHITE, font=f_name)
    iy += th(d,name,f_name) + 3
    d.text((CX-tw(d,role,f_role)//2, iy), role, fill=C_MUTED, font=f_role)
    iy += th(d,role,f_role) + 10

    # Status per frame
    if frame == 0:
        # Scanning
        status = "Scanning QR…"
        s_c = C_FG
        # Draw tiny phone silhouette with QR
        ph_w, ph_h = 28, 44
        ph_x0, ph_y0 = CX - ph_w//2, iy
        rrect(d, (ph_x0, ph_y0, ph_x0+ph_w, ph_y0+ph_h), 4, fill=(50,50,55), outline=C_BORDER)
        # mini QR inside phone (very small)
        draw_qr(d, CX, ph_y0+22, size=18)
        iy = ph_y0 + ph_h + 8

    elif frame == 1:
        # Paying — big lightning bolt flash
        bolt_size = 20
        draw_lightning_bolt(d, CX, iy+bolt_size, size=bolt_size, color=C_ORNG)
        iy += bolt_size*2 + 6
        status = "Paying…"
        s_c = C_ORNG

    else:
        # Paid — green checkmark
        ck_r = 14
        d.ellipse((CX-ck_r, iy, CX+ck_r, iy+ck_r*2), fill=C_GREEN)
        # checkmark lines
        d.line([(CX-6, iy+ck_r), (CX-1, iy+ck_r+6), (CX+7, iy+ck_r-5)], fill=C_WHITE, width=2)
        iy += ck_r*2 + 8
        status = "Diagram ready!"
        s_c = C_GREEN

    # Status text
    d.text((CX-tw(d,status,f_status)//2, iy), status, fill=s_c, font=f_status)
    iy += th(d,status,f_status) + 4

    # Device label (small, bottom)
    d.text((CX-tw(d,device,f_small)//2, iy), device, fill=darken(accent, 1.8) if frame==0 else C_MUTED, font=f_small)


# ── Big lightning overlay for transition frame ────────────────────────────────
def draw_payment_flash(img):
    """Subtle yellow lightning bolts radiating from QR to personas."""
    d = ImageDraw.Draw(img)
    # Central flash at QR position
    qr_cx = PANEL_W // 2
    qr_cy = TOTAL_H // 2
    # Lines to each persona center
    persona_centers = [
        (PANEL_W + CELL_W//2,        CELL_H//2),
        (PANEL_W + CELL_W + CELL_W//2, CELL_H//2),
        (PANEL_W + CELL_W//2,        CELL_H + CELL_H//2),
        (PANEL_W + CELL_W + CELL_W//2, CELL_H + CELL_H//2),
    ]
    for px, py in persona_centers:
        # Dashed lightning line
        dx, dy = px-qr_cx, py-qr_cy
        dist = math.sqrt(dx*dx+dy*dy)
        steps = int(dist/8)
        for i in range(0, steps, 2):
            t0, t1 = i/steps, min(1, (i+1)/steps)
            lx0, ly0 = int(qr_cx+dx*t0), int(qr_cy+dy*t0)
            lx1, ly1 = int(qr_cx+dx*t1), int(qr_cy+dy*t1)
            d.line([(lx0,ly0),(lx1,ly1)], fill=(245,158,11,180), width=2)
    # Central burst
    for angle in range(0, 360, 45):
        rad = math.radians(angle)
        ex = int(qr_cx + 18*math.cos(rad))
        ey = int(qr_cy + 18*math.sin(rad))
        d.line([(qr_cx,qr_cy),(ex,ey)], fill=C_ORNG, width=2)


# ── Build each frame image ─────────────────────────────────────────────────────
def build_frame(frame_idx):
    img = Image.new("RGB", (TOTAL_W, TOTAL_H), C_BG)
    draw_extension_panel(img, frame_idx)
    for i, persona in enumerate(PERSONAS):
        col = i % 2
        row = i // 2
        draw_persona_card(img, col, row, persona, frame_idx)
    if frame_idx == 1:
        draw_payment_flash(img)
    return img


frames_def = [
    (build_frame(0), 4000),   # Scanning
    (build_frame(1), 2000),   # Lightning flash
    (build_frame(2), 5000),   # All paid, analyzing
]

gif_frames    = []
gif_durations = []
for img, dur in frames_def:
    gif_frames.append(img.convert("P", palette=Image.Palette.ADAPTIVE, colors=192))
    gif_durations.append(dur)

out = os.path.join(ROOT, "docs", "demo-personas-paying.gif")
gif_frames[0].save(
    out, save_all=True, append_images=gif_frames[1:],
    loop=0, duration=gif_durations, disposal=2, optimize=False,
)
size_kb = os.path.getsize(out) // 1024
print(f"OK personas GIF -> {out}  ({size_kb} KB, {len(frames_def)} frames)")
