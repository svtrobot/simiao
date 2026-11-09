"""泥生 · SDF raymarch renderer (numpy). Usage:
python nisheng3d.py --stage bisque --yaw 0 --w 900 --h 1200 --out front.png
"""
import argparse, math, time
import numpy as np
from PIL import Image

def V(*a): return np.array(a, dtype=np.float64)
def norm(v): return v / np.linalg.norm(v)
def length(p): return np.sqrt(np.sum(p * p, axis=-1))
def srgb2lin(h):
    h = h.lstrip('#'); c = np.array([int(h[i:i+2], 16) / 255 for i in (0, 2, 4)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

def smin(a, b, k):
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)
def smax(a, b, k): return -smin(-a, -b, k)

def sd_ellipsoid(p, c, r):
    q = (p - c)
    k0 = length(q / r); k1 = length(q / (r * r))
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)
def sd_capsule(p, a, b, r):
    pa = p - a; ba = b - a
    h = np.clip((pa @ ba) / (ba @ ba), 0, 1)
    return length(pa - h[:, None] * ba) - r

# ---------------- model ----------------
ZS = 0.86  # depth squash of body
def body_r(y):
    t = np.clip(y / 2.05, 0, 1)
    return 0.82 - 0.40 * t ** 1.5 + 0.04 * np.sin(np.pi * t)
def body_dr(y):
    return (body_r(y + 1e-3) - body_r(y - 1e-3)) / 2e-3

def sd_body(p):
    q = np.sqrt(p[:, 0] ** 2 + (p[:, 2] / ZS) ** 2)
    y = p[:, 1]
    d = (q - body_r(y)) / np.sqrt(1 + body_dr(y) ** 2) * ZS
    d = smax(d, y - 2.0, 0.06)
    d = smin(d, sd_ellipsoid(p, V(0, 2.0, 0), V(0.50, 0.24, 0.43)), 0.12)
    d = smax(d, 0.02 - y, 0.04)
    return d

HEAD_C = V(0, 2.62, 0); HEAD_R = V(0.68, 0.47, 0.58)
def head_surface_z(x, y):
    v = 1 - (x / HEAD_R[0]) ** 2 - ((y - HEAD_C[1]) / HEAD_R[1]) ** 2
    return -HEAD_R[2] * math.sqrt(max(v, 0.0))

def eye_segments():
    segs = []
    for xc in (-0.215, 0.215):
        pts = []
        for t in np.linspace(0, 1, 6):
            x = xc + (t - 0.5) * 0.19
            y = 2.61 - 0.05 * math.sin(math.pi * t)
            pts.append(V(x, y, head_surface_z(x, y) + 0.004))
        segs += [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    return segs
EYES = eye_segments()
def sd_eyes(p):
    return np.min([sd_capsule(p, a, b, 0.021) for a, b in EYES], axis=0)

def _petals():
    segs = []
    for sgn in (-1, 1):
        pts = []
        for t in np.linspace(0, 1, 8):
            x = sgn * (0.17 * math.sin(math.pi * t) ** 0.8)
            y = 0.98 + 0.42 * t
            z = float(-ZS * np.sqrt(max(body_r(np.array(y)) ** 2 - x ** 2, 0))) + 0.003
            pts.append(V(x, y, z))
        segs += [(pts[i], pts[i + 1]) for i in range(len(pts) - 1)]
    return segs
PETALS = None
LAMP_C = V(0, 1.18, float(-ZS * body_r(np.array(1.18))))
def sd_lamp_cavity(p): return sd_ellipsoid(p, LAMP_C, V(0.085, 0.14, 0.13))

PETALS = _petals()
def sd_petals(p):
    return np.min([sd_capsule(p, a, b, 0.013) for a, b in PETALS], axis=0)

ARMS = []
for s in (-1, 1):
    S = V(0.42 * s, 1.92, -0.14); E = V(0.47 * s, 1.40, -0.44); W = V(0.10 * s, 1.58, -0.64)
    ARMS.append((S, E, W))
HAND_C = V(0, 1.74, -0.68); HAND_R = V(0.15, 0.25, 0.10)
def sd_arms_hands(p):
    d = 1e9
    for S, E, W in ARMS:
        d = np.minimum(d, smin(sd_capsule(p, S, E, 0.115), sd_capsule(p, E, W, 0.10), 0.05))
    h = sd_ellipsoid(p, HAND_C, HAND_R)
    h = smax(h, -(np.abs(p[:, 0]) - 0.004), 0.006) if False else h
    # palm seam groove (front only)
    seam = np.maximum(np.abs(p[:, 0]) - 0.005, -(p[:, 2] + 0.70))
    h = smax(h, -np.maximum(seam, np.abs(p[:, 1] - 1.83) - 0.14), 0.004)
    thumbs = sd_capsule(p, V(0, 1.55, -0.76), V(0, 1.66, -0.77), 0.045)
    h = smin(h, thumbs, 0.02)
    return smin(d, h, 0.035)

SASH_D = norm(V(-1.0, -1.35, 0.0)); SASH_N = V(-SASH_D[1], SASH_D[0], 0.0)
SASH_C = V(-0.27, 1.40, 0.0)
def sash_uv(p):
    rel = p - SASH_C
    return rel @ SASH_D, rel @ SASH_N
def sd_sash(p, db):
    u, v = sash_uv(p)
    off = 0.036 + 0.006 * np.sin(v * 38.0)
    shell = np.abs(db - off) - 0.026
    band = np.abs(v) - 0.165
    d = smax(shell, band, 0.02)
    d = np.maximum(d, p[:, 1] - 2.32)
    d = np.maximum(d, 0.42 - p[:, 1])
    return d
def sd_hem(p, db):
    y = p[:, 1]
    ang = np.arctan2(p[:, 2], p[:, 0])
    fz = np.clip((0.5 - y) / 0.5, 0, 1)
    off = 0.012 + fz * (0.05 + 0.018 * np.sin(ang * 11.0) + 0.007 * np.sin(ang * 23.0))
    shell = np.abs(db - off) - 0.016
    return smax(smax(shell, y - 0.5, 0.03), 0.012 - y, 0.02)

_ry, _rx = 1.88, 0.14
RING_C = V(_rx, _ry, float(-ZS * np.sqrt(body_r(np.array(_ry)) ** 2 - _rx ** 2) - 0.07))
def sd_ring(p):
    q = p - RING_C
    return length(np.stack([np.sqrt(q[:, 0] ** 2 + q[:, 1] ** 2) - 0.06, q[:, 2]], -1)) - 0.017

FEET = [(V(-0.23, 0.075, -0.74), V(0.15, 0.08, 0.16)), (V(0.23, 0.075, -0.74), V(0.15, 0.08, 0.16))]

# material ids
M_CLAY, M_SASH, M_HEM, M_RING, M_FLOOR = 0, 1, 2, 3, 4
def scene(p, want_mat=False):
    db = sd_body(p)
    head = sd_ellipsoid(p, HEAD_C, HEAD_R)
    clay = smin(db, head, 0.05)
    clay = smax(clay, -sd_lamp_cavity(p), 0.015)
    clay = smax(clay, -sd_eyes(p), 0.008)
    clay = smax(clay, -sd_petals(p), 0.006)
    clay = smin(clay, sd_arms_hands(p), 0.035)
    for c, r in FEET:
        clay = smin(clay, sd_ellipsoid(p, c, r), 0.03)
    sash = sd_sash(p, db); hem = sd_hem(p, db); ring = sd_ring(p)
    floor = p[:, 1]
    d = np.minimum.reduce([clay, sash, hem, ring, floor])
    if not want_mat: return d
    mat = np.full(len(p), M_CLAY)
    mat[sash <= d + 1e-5] = M_SASH
    mat[hem <= d + 1e-5] = M_HEM
    mat[ring <= d + 1e-5] = M_RING
    mat[floor <= d + 1e-5] = M_FLOOR
    mat[clay <= d + 1e-5] = M_CLAY
    return d, mat

def calc_normal(p):
    e = 0.0015
    k = [V(1, -1, -1), V(-1, -1, 1), V(-1, 1, -1), V(1, 1, 1)]
    n = sum(kk[None, :] * scene(p + e * kk)[:, None] for kk in k)
    return n / np.maximum(length(n), 1e-9)[:, None]

def soft_shadow(p, ldir, k=10.0, tmax=6.0, steps=40):
    res = np.ones(len(p)); t = np.full(len(p), 0.02)
    alive = np.ones(len(p), bool)
    for _ in range(steps):
        idx = np.nonzero(alive)[0]
        if len(idx) == 0: break
        h = scene(p[idx] + ldir * t[idx, None]) if ldir.ndim == 1 else scene(p[idx] + ldir[idx] * t[idx, None])
        res[idx] = np.minimum(res[idx], k * h / t[idx])
        t[idx] += np.clip(h, 0.01, 0.25)
        alive[idx] = (h > 1e-4) & (t[idx] < tmax)
    return np.clip(res, 0, 1)

def ambient_occ(p, n):
    occ = np.zeros(len(p)); sca = 1.0
    for i in range(5):
        h = 0.02 + 0.07 * i
        d = scene(p + n * h)
        occ += (h - d) * sca; sca *= 0.75
    return np.clip(1 - 2.2 * occ, 0, 1)

# ---- noise ----
def hash3(i):
    x = np.sin(i @ V(127.1, 311.7, 74.7)) * 43758.5453
    return x - np.floor(x)
def vnoise(p):
    i = np.floor(p); f = p - i; u = f * f * (3 - 2 * f)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                w = (u[:, 0] if dx else 1 - u[:, 0]) * (u[:, 1] if dy else 1 - u[:, 1]) * (u[:, 2] if dz else 1 - u[:, 2])
                out = out + w * hash3(i + V(dx, dy, dz))
    return out
def worley_edge(p):
    i = np.floor(p); f = p - i
    f1 = np.full(len(p), 9.0); f2 = np.full(len(p), 9.0)
    for dx in (-1, 0, 1):
        for dy in (-1, 0, 1):
            for dz in (-1, 0, 1):
                o = V(dx, dy, dz)
                c = i + o
                jitter = np.stack([hash3(c), hash3(c + 17.3), hash3(c + 41.9)], -1)
                d = length(o + jitter - f)
                f2 = np.where(d < f1, f1, np.minimum(f2, d)); f1 = np.minimum(f1, d)
    return f2 - f1

# ---- stages ----
STAGES = {
    'raw':     dict(c0='#9B9184', c1='#857B6E', spec=0.02, gloss=8,   grain=0.16, crack=None),
    'bisque':  dict(c0='#AE7A5E', c1='#8F5A3E', spec=0.06, gloss=14,  grain=0.2, crack=None),
    'glaze':   dict(c0='#EEF3EF', c1='#CFDCD6', spec=0.55, gloss=140, grain=0.02, crack=None),
    'kiln':    dict(c0='#B6CEC9', c1='#8FB0AA', spec=0.55, gloss=140, grain=0.02, crack='dark'),
    'kintsugi':dict(c0='#B6CEC9', c1='#8FB0AA', spec=0.55, gloss=140, grain=0.02, crack='gold'),
}

BUMP = 0.10
def render(stage='bisque', yaw=0.0, W=900, H=1200, out='out.png', dist=9.0, look_y=1.72, fov=26.0, lamp=1.0, ss=1):
    t0 = time.time()
    st = STAGES[stage]
    W2, H2 = W * ss, H * ss
    yr = math.radians(yaw)
    cam = V(dist * math.sin(yr), 2.1, -dist * math.cos(yr))
    target = V(0, look_y, 0)
    fwd = norm(target - cam); right = norm(np.cross(V(0, 1, 0), fwd)); right = -right if right @ V(math.cos(yr), 0, math.sin(yr)) < 0 else right
    up = np.cross(fwd, right)
    if up[1] < 0: up = -up
    th = math.tan(math.radians(fov) / 2)
    xs = (np.arange(W2) + 0.5) / W2 * 2 - 1; ys = 1 - (np.arange(H2) + 0.5) / H2 * 2
    X, Y = np.meshgrid(xs * th * W2 / H2, ys * th)
    rd = fwd[None, :] + X.reshape(-1, 1) * right[None, :] + Y.reshape(-1, 1) * up[None, :]
    rd /= length(rd)[:, None]
    N = len(rd)
    t = np.full(N, 4.0); hit = np.zeros(N, bool); alive = np.ones(N, bool)
    for it in range(220):
        idx = np.nonzero(alive)[0]
        if len(idx) == 0: break
        p = cam + rd[idx] * t[idx, None]
        d = scene(p)
        t[idx] += d * 0.85
        h = d < 0.0006 * t[idx] / 9
        hit[idx[h]] = True
        alive[idx] = (~h) & (t[idx] < 20)
    print(f'march {time.time()-t0:.1f}s, hits {hit.sum()}')

    # background
    by = (Y.reshape(-1) / th + 1) / 2
    bx = X.reshape(-1) / th
    bg = (np.outer(1 - by, srgb2lin('#2A221D')) + np.outer(by, srgb2lin('#141110')))
    glow = np.exp(-((bx - 0.15) ** 2 + (by - 0.55) ** 2) / 0.25)[:, None] * srgb2lin('#4A3426') * 0.6
    col = bg + glow

    idx = np.nonzero(hit)[0]
    p = cam + rd[idx] * t[idx, None]
    _, mat = scene(p, True)
    n = calc_normal(p)
    v = -rd[idx]
    ao = ambient_occ(p, n)
    cm = (mat == M_CLAY)
    if cm.any():
        q = p[cm] * 38.0
        bump = np.stack([vnoise(q), vnoise(q + 13.1), vnoise(q + 27.7)], -1) - 0.5
        q2 = p[cm] * 9.0
        bump += 0.6 * (np.stack([vnoise(q2), vnoise(q2 + 5.3), vnoise(q2 + 9.1)], -1) - 0.5)
        nn = n[cm] + BUMP * bump
        n[cm] = nn / length(nn)[:, None]
    print(f'normals/ao {time.time()-t0:.1f}s')

    # lights
    key_dir = norm(V(-0.55, 0.85, -0.55)); key_col = V(0.97, 0.97, 1.0) * 2.0
    candle_pos = V(1.7, 1.25, -1.3); candle_col = V(1.0, 0.55, 0.22) * 1.8
    rim_dir = norm(V(0.4, 0.6, 1.0)); rim_col = V(1.0, 0.75, 0.5) * 1.4
    sky = V(0.30, 0.36, 0.48) * 0.48; ground_bounce = V(0.35, 0.22, 0.15) * 0.35

    sh_key = soft_shadow(p + n * 0.003, key_dir, k=9)
    ld_c = candle_pos - p; dist_c = length(ld_c); ld_c = ld_c / dist_c[:, None]
    sh_c = soft_shadow(p + n * 0.003, ld_c, k=7, tmax=3.5, steps=30)
    print(f'shadows {time.time()-t0:.1f}s')

    alb = np.zeros((len(p), 3)); spec = np.zeros(len(p)); gloss = np.ones(len(p)) * 10
    wrap = np.zeros(len(p)); metal = np.zeros(len(p), bool)
    emissive = np.zeros((len(p), 3))
    clay = mat == M_CLAY
    if clay.any():
        pc = p[clay]
        nlow = vnoise(pc * 5.0); nfine = vnoise(pc * 55.0)
        c0 = srgb2lin(st['c0']); c1 = srgb2lin(st['c1'])
        base = np.outer(nlow, c0) + np.outer(1 - nlow, c1)
        base *= (1 - st['grain'] * 0.5 + st['grain'] * nfine)[:, None]
        if stage in ('raw', 'bisque'):
            for cx in (-0.36, 0.36):
                w = np.exp(-length(pc - V(cx, 2.64, -0.46)) ** 2 / 0.006)
                base = base * (1 - 0.35 * w[:, None]) + srgb2lin('#E07A5F')[None, :] * 0.35 * w[:, None]
        eye = sd_eyes(pc) < 0.03
        base[eye] *= 0.32
        s = np.full(len(pc), st['spec']); g = np.full(len(pc), float(st['gloss']))
        s[eye] *= 0.2
        if st['crack']:
            e = worley_edge(pc * 4.2)
            m = e < 0.045
            if st['crack'] == 'dark':
                base[m] *= 0.45
            else:
                base[m] = srgb2lin('#D9A941') * 1.0
                s[m] = 1.0; g[m] = 60
                mm = np.zeros(len(pc), bool); mm[m] = True
                metal_idx = np.nonzero(clay)[0][mm]
                metal[metal_idx] = True
        # lamp cavity emissive
        lampd = sd_lamp_cavity(pc)
        depth = np.clip(-sd_body(pc) / 0.05, 0, 1) * (lampd < 0.02)
        em = np.outer(depth ** 1.5, V(1.0, 0.66, 0.26) * (2.2 * lamp))
        alb[clay] = base; spec[clay] = s; gloss[clay] = g; wrap[clay] = 0.35
        emissive[clay] = em
    sm = mat == M_SASH
    if sm.any():
        ps = p[sm]; u, vv = sash_uv(ps)
        base = np.tile(srgb2lin('#8A8072'), (len(ps), 1)) * (0.92 + 0.12 * vnoise(ps * 40))[:, None]
        stitch_cross = (np.abs(((u + 0.16) / 0.32) % 1 - 0.5) > 0.485) & ((vv / 0.035) % 1 < 0.55) & (np.abs(vv) < 0.145)
        stitch_mid = (np.abs(vv) < 0.006) & ((u / 0.035) % 1 < 0.55)
        edge = np.abs(vv) > 0.142
        base[stitch_cross | stitch_mid] *= 0.7
        base[edge] *= 0.78
        alb[sm] = base; spec[sm] = 0.03; gloss[sm] = 6; wrap[sm] = 0.25
    hm = mat == M_HEM
    if hm.any():
        ph = p[hm]
        base = np.tile(srgb2lin('#6E665B'), (len(ph), 1)) * (0.9 + 0.15 * vnoise(ph * 45))[:, None]
        top = np.abs(ph[:, 1] - 0.42) < 0.008
        ang = np.arctan2(ph[:, 2], ph[:, 0])
        base[top & ((ang * 40) % 1 < 0.55)] = srgb2lin('#C2B9A8')
        alb[hm] = base; spec[hm] = 0.03; gloss[hm] = 6; wrap[hm] = 0.25
    rm = mat == M_RING
    alb[rm] = srgb2lin('#C9A060'); spec[rm] = 0.9; gloss[rm] = 50; metal[rm] = True
    fm = mat == M_FLOOR
    if fm.any():
        pf = p[fm]
        r2 = pf[:, 0] ** 2 + (pf[:, 2] + 0.1) ** 2
        base = np.tile(srgb2lin('#3A302A'), (len(pf), 1)) * (0.75 + 0.25 * vnoise(pf * 3))[:, None]
        base *= np.exp(-r2 / 6.0)[:, None] * 0.9 + 0.1
        alb[fm] = base; spec[fm] = 0.08; gloss[fm] = 20

    def shade_light(ldir, lcol, shadow):
        ndl = np.sum(n * ldir, -1)
        diff = np.clip((ndl + wrap) / (1 + wrap), 0, 1)
        hvec = ldir + v; hvec /= length(hvec)[:, None]
        ndh = np.clip(np.sum(n * hvec, -1), 0, 1)
        sp = spec * (gloss + 8) / 25.0 * ndh ** gloss * (ndl > 0)
        dcol = alb * diff[:, None] * (~metal)[:, None]
        scol = np.where(metal[:, None], alb, 1.0) * sp[:, None]
        return (dcol + scol) * lcol[None, :] * shadow[:, None]

    c = shade_light(key_dir, key_col, sh_key)
    att = 1.0 / (1 + 0.35 * dist_c ** 2)
    c += shade_light(ld_c, candle_col, sh_c * att)
    # rim
    fres = np.clip(1 - np.sum(n * v, -1), 0, 1) ** 3
    rimd = np.clip(np.sum(n * rim_dir, -1), 0, 1)
    c += alb * (rim_col[None, :] * (rimd * fres)[:, None]) * 1.6
    # lamp light onto nearby surfaces
    lamp_p = LAMP_C + V(0, 0, -0.06)
    ldl = lamp_p - p; dl = length(ldl); ldl /= dl[:, None]
    lam = np.clip(np.sum(n * ldl, -1), 0, 1) / (1 + 60 * dl ** 2) * lamp
    c += alb * (V(1.0, 0.7, 0.3) * 1.6)[None, :] * lam[:, None]
    # ambient
    skyw = np.clip(0.5 + 0.5 * n[:, 1], 0, 1)
    amb = np.outer(skyw, sky) + np.outer(1 - skyw, ground_bounce)
    c += alb * amb * ao[:, None]
    # glaze env reflection
    gl = (spec > 0.3) & (mat == M_CLAY)
    if gl.any():
        rr = rd[idx][gl] - 2 * np.sum(rd[idx][gl] * n[gl], -1)[:, None] * n[gl]
        envw = np.exp(-((rr[:, 0] - 0.55) ** 2 + (rr[:, 1] - 0.15) ** 2 + (rr[:, 2] + 0.8) ** 2) / 0.08)
        env = np.outer(np.clip(rr[:, 1] * 0.5 + 0.5, 0, 1), V(0.08, 0.08, 0.09)) + np.outer(envw, V(1.0, 0.6, 0.3) * 1.5)
        fr = 0.04 + 0.96 * np.clip(1 - np.sum(n[gl] * v[gl], -1), 0, 1) ** 5
        c[gl] += env * (fr * 0.9 + 0.08)[:, None] * ao[gl][:, None]
    c += emissive
    col[idx] = c
    emb = np.zeros((N, 3)); emb[idx] = emissive

    # lamp glow bloom in screen space (cheap)
    img = col.reshape(H2, W2, 3)
    # tonemap (ACES fit)
    a, b, c_, d, e = 2.51, 0.03, 2.43, 0.59, 0.14
    x = img * 0.85
    img = np.clip((x * (a * x + b)) / (x * (c_ * x + d) + e), 0, 1)
    img = np.where(img <= 0.0031308, 12.92 * img, 1.055 * img ** (1 / 2.4) - 0.055)
    # vignette
    yy, xx = np.mgrid[0:H2, 0:W2]
    vig = 1 - 0.35 * (((xx / W2 - 0.5) ** 2 + (yy / H2 - 0.5) ** 2) * 2.2)
    img = np.clip(img * vig[..., None], 0, 1)
    from PIL import ImageFilter
    e = emb.reshape(H2, W2, 3)
    e = np.clip(e / max(e.max(), 1e-6), 0, 1)
    eim = Image.fromarray((e * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius=W2 / 45))
    e2 = np.asarray(eim).astype(np.float64) / 255
    eim2 = Image.fromarray((e * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius=W2 / 160))
    e3 = np.asarray(eim2).astype(np.float64) / 255
    img = 1 - (1 - img) * (1 - np.clip(e2 * 1.2 * lamp + e3 * 0.6 * lamp, 0, 1) * np.array([1.0, 0.72, 0.38]))
    im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    if ss > 1: im = im.resize((W, H), Image.LANCZOS)
    im.save(out)
    print(f'saved {out} in {time.time()-t0:.1f}s')

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--stage', default='bisque'); ap.add_argument('--yaw', type=float, default=0)
    ap.add_argument('--w', type=int, default=900); ap.add_argument('--h', type=int, default=1200)
    ap.add_argument('--ss', type=int, default=1); ap.add_argument('--out', default='out.png')
    ap.add_argument('--fov', type=float, default=25.0); ap.add_argument('--dist', type=float, default=9.0)
    ap.add_argument('--lamp', type=float, default=1.0)
    a = ap.parse_args()
    render(a.stage, a.yaw, a.w, a.h, a.out, dist=a.dist, fov=a.fov, lamp=a.lamp, ss=a.ss)
