"""泥生 · posed storyboard renders (extends nisheng3d). Usage:
python nisheng_pose.py --pose incense --out a.png --w 900 --h 1200
poses: pray, incense, prostrate, return
"""
import argparse, math, time
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from nisheng3d import (V, norm, length, srgb2lin, smin, smax, sd_ellipsoid, sd_capsule,
                       body_r, sd_body, HEAD_C, HEAD_R, sd_eyes, sd_lamp_cavity, sd_petals, LAMP_C,
                       HAND_C, HAND_R, sd_sash, sash_uv, sd_hem, sd_ring, FEET, vnoise, worley_edge,
                       STAGES, soft_shadow as _unused)

# ---------------- rig helpers ----------------
def rotx(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, s], [0, -s, c]], dtype=np.float64)

class Frame:
    def __init__(self, R=None, P0=None, T=None):
        self.R = np.eye(3) if R is None else R
        self.P0 = V(0, 0, 0) if P0 is None else P0
        self.T = V(0, 0, 0) if T is None else T
    def to_local(self, p): return (p - self.P0 - self.T) @ self.R + self.P0
    def to_world(self, x): return (x - self.P0) @ self.R.T + self.P0 + self.T

def sd_joined(q):
    h = sd_ellipsoid(q, HAND_C, HAND_R)
    seam = np.maximum(np.abs(q[:, 0]) - 0.005, -(q[:, 2] + 0.70))
    h = smax(h, -np.maximum(seam, np.abs(q[:, 1] - 1.83) - 0.14), 0.004)
    thumbs = sd_capsule(q, V(0, 1.55, -0.76), V(0, 1.66, -0.77), 0.045)
    return smin(h, thumbs, 0.02)

def sd_ell_rot(p, c, M, r):
    return sd_ellipsoid((p - c) @ M, V(0, 0, 0), r)

def sd_torus_xy(p, c, R, r):
    q = p - c
    return length(np.stack([np.sqrt(q[:, 0] ** 2 + q[:, 1] ** 2) - R, q[:, 2]], -1)) - r
def sd_torus_xz(p, c, R, r):
    q = p - c
    return length(np.stack([np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2) - R, q[:, 1]], -1)) - r

# material ids
M_CLAY, M_SASH, M_HEM, M_RING, M_FLOOR, M_BRONZE, M_STICK, M_ASH, M_CUSH = range(9)

# ---------------- props ----------------
def make_burner(B):
    def f(p):
        q = p - B
        bowl = sd_ellipsoid(q, V(0, 0.60, 0), V(0.46, 0.36, 0.46))
        inner = sd_ellipsoid(q, V(0, 0.60, 0), V(0.41, 0.31, 0.41))
        shell = smax(bowl, -inner, 0.01)
        shell = smax(shell, q[:, 1] - 0.80, 0.01)
        rim = sd_torus_xz(q, V(0, 0.80, 0), 0.40, 0.035)
        legs = 1e9
        for k in range(3):
            a = math.radians(90 + 120 * k)
            top = V(0.24 * math.cos(a), 0.40, 0.24 * math.sin(a))
            bot = V(0.34 * math.cos(a), 0.03, 0.34 * math.sin(a))
            legs = np.minimum(legs, sd_capsule(q, top, bot, 0.05))
        ears = np.minimum(sd_torus_xy(q, V(-0.40, 0.96, 0), 0.10, 0.028), sd_torus_xy(q, V(0.40, 0.96, 0), 0.10, 0.028))
        ears = smax(ears, 0.86 - q[:, 1], 0.01)
        bronze = smin(smin(smin(shell, rim, 0.02), legs, 0.04), ears, 0.02)
        ash = smax(inner + 0.004, q[:, 1] - 0.72, 0.01)
        return bronze, ash
    return f

def stick_segments(base, dirv, n, spread, L):
    segs = []
    side = norm(np.cross(dirv, V(0, 0, 1))) if abs(dirv[2]) < 0.9 else V(1, 0, 0)
    for i in range(n):
        o = side * spread * (i - (n - 1) / 2)
        a = base + o; b = a + dirv * L * (1 - 0.04 * abs(i - (n - 1) / 2))
        segs.append((a, b))
    return segs

def sd_cushion(p, C, R=0.98, h=0.18):
    q = p - C
    rr = np.sqrt(q[:, 0] ** 2 + q[:, 2] ** 2)
    top = h - 0.03 * (rr / R) ** 2
    d2 = np.stack([np.maximum(rr - (R - 0.08), 0), np.maximum(np.abs(q[:, 1] - top / 2) - (top / 2 - 0.08), 0)], -1)
    return length(d2) - 0.08

# ---------------- poses ----------------
def make_pose(name):
    P = dict(name=name, split=None, up=Frame(), lo=Frame(), head=Frame(), arms=[], joined=None,
             hands=[], burner=None, sticks=[], cushion=None, feet=True, particles=False,
             stage='bisque', lamp=1.0)
    S0 = lambda s: V(0.42 * s, 1.92, -0.14)
    if name == 'pray':
        for s in (-1, 1):
            P['arms'].append((S0(s), V(0.47 * s, 1.40, -0.44), V(0.10 * s, 1.58, -0.64)))
        P['joined'] = V(0, 0, 0)
    elif name == 'incense':
        P['head'] = Frame(rotx(math.radians(13)), V(0, 2.12, 0))
        for s in (-1, 1):
            P['arms'].append((S0(s), V(0.47 * s, 1.47, -0.50), V(0.10 * s, 1.70, -0.70)))
        P['joined'] = V(0, 0.10, -0.05)
        dirv = norm(V(0.0, 1.0, -0.42))
        P['sticks'] += stick_segments(V(0, 1.72, -0.78), dirv, 3, 0.045, 1.05)
        B = V(-0.55, 0, -2.15)
        P['burner'] = (B, make_burner(B))
        for i, dx in enumerate((-0.11, 0.0, 0.12)):
            a = B + V(dx, 0.70, 0.04 * (i - 1))
            P['sticks'].append((a, a + norm(V(dx * 0.4, 1, 0)) * (0.62 + 0.08 * (i == 1))))
    elif name == 'prostrate':
        P['split'] = 0.95
        ang = math.radians(104)
        up = Frame(rotx(ang), V(0, 0.95, 0.05))
        # find head lowest point, rest it on cushion
        th = np.linspace(0, 2 * np.pi, 60); ph = np.linspace(0, np.pi, 30)
        T, PH = np.meshgrid(th, ph)
        pts = np.stack([HEAD_R[0] * np.sin(PH) * np.cos(T), HEAD_R[1] * np.cos(PH), HEAD_R[2] * np.sin(PH) * np.sin(T)], -1).reshape(-1, 3) + HEAD_C
        w = up.to_world(pts)
        cush_top = 0.17
        up.T = V(0, cush_top - w[:, 1].min() - 0.015, 0)
        P['up'] = up
        Hc = up.to_world(HEAD_C)
        P['cushion'] = V(0, 0, Hc[2] + 0.05)
        for s in (-1, 1):
            S = up.to_world(S0(s))
            E = V(0.80 * s, cush_top + 0.09, Hc[2] + 0.42)
            W = V(0.70 * s, cush_top + 0.07, Hc[2] - 0.22)
            P['arms'].append((S, E, W))
            b = norm(V(-0.10 * s, 0, -1)); c = V(0, 1, 0); a = np.cross(b, c)
            M = np.stack([a, b, c], 1)
            P['hands'].append((W + b * 0.20 + V(0, -0.005, 0), M, V(0.14, 0.22, 0.05)))
            P['hands'].append(('thumb', W + b * 0.10 + a * 0.11 * (-s), W + b * 0.24 + a * 0.15 * (-s)))
        P['feet'] = False
    elif name == 'return':
        P['stage'] = 'kintsugi'; P['lamp'] = 1.9; P['particles'] = True
        P['head'] = Frame(rotx(math.radians(-8)), V(0, 2.12, 0))
        for s in (-1, 1):
            S = S0(s); E = V(0.74 * s, 1.40, -0.32); W = V(0.84 * s, 1.30, -0.64)
            P['arms'].append((S, E, W))
            b = norm(V(0.22 * s, 0.30, -1.0)); c = norm(V(-0.25 * s, 1.0, 0.30))
            c = norm(c - (c @ b) * b); a = np.cross(b, c)
            M = np.stack([a, b, c], 1)
            P['hands'].append((W + b * 0.19, M, V(0.135, 0.21, 0.055)))
            out = V(s, 0, 0); out = norm(out - (out @ b) * b - (out @ c) * c)
            P['hands'].append(('thumb', W + b * 0.07 + out * 0.10, W + b * 0.20 + out * 0.17 + c * 0.03))
    return P

POSE = make_pose('pray')
SPLIT_K = 0.22

def parts(pl, ph, upper=True, lower=True):
    db = sd_body(pl)
    clay = db
    if upper:
        head = sd_ellipsoid(ph, HEAD_C, HEAD_R)
        clay = smin(clay, head, 0.05)
        clay = smax(clay, -sd_lamp_cavity(pl), 0.015)
        clay = smax(clay, -sd_eyes(ph), 0.008)
        clay = smax(clay, -sd_petals(pl), 0.006)
    if lower and POSE['feet']:
        for c, r in FEET:
            clay = smin(clay, sd_ellipsoid(pl, c, r), 0.03)
    sash = sd_sash(pl, db)
    hem = sd_hem(pl, db) if lower else np.full(len(pl), 1e9)
    ring = sd_ring(pl) if upper else np.full(len(pl), 1e9)
    return clay, sash, hem, ring

def scene(p, want_mat=False):
    up = POSE['up']; hf = POSE['head']
    pl_up = up.to_local(p); ph = hf.to_local(pl_up)
    S = POSE['split']
    if S is None:
        clay, sash, hem, ring = parts(pl_up, ph)
        pl = pl_up
    else:
        pl_lo = POSE['lo'].to_local(p)
        c1, s1, h1, _ = parts(pl_lo, pl_lo, upper=False, lower=True)
        c2, s2, _, r2 = parts(pl_up, ph, upper=True, lower=False)
        c1 = smax(c1, pl_lo[:, 1] - S, 0.03); s1 = np.maximum(s1, pl_lo[:, 1] - S)
        c2 = smax(c2, S - pl_up[:, 1], 0.03); s2 = np.maximum(s2, S - pl_up[:, 1])
        clay = smin(c1, c2, SPLIT_K); sash = np.minimum(s1, s2); hem = h1; ring = r2
        if want_mat:
            pl = np.where((np.minimum(c2, s2) < np.minimum(c1, s1))[:, None], pl_up, pl_lo)
    # arms + hands (world)
    limbs = np.full(len(p), 1e9)
    for A, E, W in POSE['arms']:
        limbs = np.minimum(limbs, smin(sd_capsule(p, A, E, 0.115), sd_capsule(p, E, W, 0.10), 0.05))
    if POSE['joined'] is not None:
        limbs = smin(limbs, sd_joined(pl_up - POSE['joined']), 0.035)
    for h in POSE['hands']:
        if isinstance(h[0], str):
            limbs = smin(limbs, sd_capsule(p, h[1], h[2], 0.042), 0.03)
        else:
            limbs = smin(limbs, sd_ell_rot(p, *h), 0.04)
    clay = smin(clay, limbs, 0.035)
    floor = p[:, 1]
    ds = [clay, sash, hem, ring, floor]
    bronze = ash = stick = cush = np.full(len(p), 1e9)
    if POSE['burner'] is not None:
        bronze, ash = POSE['burner'][1](p)
    if POSE['sticks']:
        stick = np.min([sd_capsule(p, a, b, 0.013) for a, b in POSE['sticks']], axis=0)
    if POSE['cushion'] is not None:
        cush = sd_cushion(p, POSE['cushion'])
    ds += [bronze, stick, ash, cush]
    d = np.minimum.reduce(ds)
    if not want_mat: return d
    mat = np.full(len(p), M_CLAY)
    for m, dd in ((M_SASH, sash), (M_HEM, hem), (M_RING, ring), (M_FLOOR, floor), (M_BRONZE, bronze),
                  (M_ASH, ash), (M_CUSH, cush), (M_STICK, stick), (M_CLAY, clay)):
        mat[dd <= d + 1e-5] = m
    return d, mat, pl, ph

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

BUMP = 0.10
def render(W=900, H=1200, out='out.png', yaw=0.0, dist=9.0, look=(0, 1.72, 0), cam_y=2.1, fov=25.0, ss=1, seed=3):
    t0 = time.time()
    st = STAGES[POSE['stage']]; stage = POSE['stage']; lamp = POSE['lamp']
    W2, H2 = W * ss, H * ss
    yr = math.radians(yaw)
    target = V(*look)
    cam = V(target[0] + dist * math.sin(yr), cam_y, target[2] - dist * math.cos(yr))
    fwd = norm(target - cam); right = norm(np.cross(V(0, 1, 0), fwd))
    up_v = np.cross(fwd, right)
    if up_v[1] < 0: up_v = -up_v
    th = math.tan(math.radians(fov) / 2)
    asp = W2 / H2
    xs = (np.arange(W2) + 0.5) / W2 * 2 - 1; ys = 1 - (np.arange(H2) + 0.5) / H2 * 2
    X, Y = np.meshgrid(xs * th * asp, ys * th)
    rd = fwd[None, :] + X.reshape(-1, 1) * right[None, :] + Y.reshape(-1, 1) * up_v[None, :]
    rd /= length(rd)[:, None]
    N = len(rd)

    def project(P3):
        d = P3 - cam; z = d @ fwd
        x = (d @ right) / z / (th * asp); y = (d @ up_v) / z / th
        return np.stack([(x + 1) / 2 * W2, (1 - y) / 2 * H2], -1), z

    t = np.full(N, 2.0); hit = np.zeros(N, bool); alive = np.ones(N, bool)
    for it in range(240):
        idx = np.nonzero(alive)[0]
        if len(idx) == 0: break
        p = cam + rd[idx] * t[idx, None]
        d = scene(p)
        t[idx] += d * 0.85
        h = d < 0.0006 * t[idx] / 9
        hit[idx[h]] = True
        alive[idx] = (~h) & (t[idx] < 24)
    print(f'march {time.time()-t0:.1f}s, hits {hit.sum()}')

    by = (Y.reshape(-1) / th + 1) / 2
    bx = X.reshape(-1) / th
    bg = (np.outer(1 - by, srgb2lin('#2A221D')) + np.outer(by, srgb2lin('#141110')))
    glow = np.exp(-((bx - 0.15) ** 2 + (by - 0.55) ** 2) / 0.25)[:, None] * srgb2lin('#4A3426') * 0.6
    col = bg + glow

    idx = np.nonzero(hit)[0]
    p = cam + rd[idx] * t[idx, None]
    _, mat, pl, ph = scene(p, True)
    n = calc_normal(p)
    v = -rd[idx]
    ao = ambient_occ(p, n)
    cm = (mat == M_CLAY)
    if cm.any():
        q = pl[cm] * 38.0
        bump = np.stack([vnoise(q), vnoise(q + 13.1), vnoise(q + 27.7)], -1) - 0.5
        q2 = pl[cm] * 9.0
        bump += 0.6 * (np.stack([vnoise(q2), vnoise(q2 + 5.3), vnoise(q2 + 9.1)], -1) - 0.5)
        nn = n[cm] + BUMP * bump * (0.35 if st['gloss'] > 50 else 1.0)
        n[cm] = nn / length(nn)[:, None]
    print(f'normals/ao {time.time()-t0:.1f}s')

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
        pc = pl[clay]; phc = ph[clay]
        nlow = vnoise(pc * 5.0); nfine = vnoise(pc * 55.0)
        c0 = srgb2lin(st['c0']); c1 = srgb2lin(st['c1'])
        base = np.outer(nlow, c0) + np.outer(1 - nlow, c1)
        base *= (1 - st['grain'] * 0.5 + st['grain'] * nfine)[:, None]
        if stage in ('raw', 'bisque'):
            for cx in (-0.36, 0.36):
                w = np.exp(-length(phc - V(cx, 2.64, -0.46)) ** 2 / 0.006)
                base = base * (1 - 0.35 * w[:, None]) + srgb2lin('#E07A5F')[None, :] * 0.35 * w[:, None]
        eye = sd_eyes(phc) < 0.03
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
                metal[np.nonzero(clay)[0][m]] = True
                # faint glow along gold seams
                emissive_gold = np.zeros((len(pc), 3)); emissive_gold[m] = V(1.0, 0.7, 0.25) * 0.12
        lampd = sd_lamp_cavity(pc)
        depth = np.clip(-sd_body(pc) / 0.05, 0, 1) * (lampd < 0.02)
        em = np.outer(depth ** 1.5, V(1.0, 0.66, 0.26) * (2.2 * lamp))
        if st['crack'] == 'gold': em += emissive_gold
        alb[clay] = base; spec[clay] = s; gloss[clay] = g; wrap[clay] = 0.35
        emissive[clay] = em
    sm = mat == M_SASH
    if sm.any():
        ps = pl[sm]; u, vv = sash_uv(ps)
        base = np.tile(srgb2lin('#8A8072'), (len(ps), 1)) * (0.92 + 0.12 * vnoise(ps * 40))[:, None]
        stitch_cross = (np.abs(((u + 0.16) / 0.32) % 1 - 0.5) > 0.485) & ((vv / 0.035) % 1 < 0.55) & (np.abs(vv) < 0.145)
        stitch_mid = (np.abs(vv) < 0.006) & ((u / 0.035) % 1 < 0.55)
        edge = np.abs(vv) > 0.142
        base[stitch_cross | stitch_mid] *= 0.7
        base[edge] *= 0.78
        alb[sm] = base; spec[sm] = 0.03; gloss[sm] = 6; wrap[sm] = 0.25
    hm = mat == M_HEM
    if hm.any():
        phm = pl[hm]
        base = np.tile(srgb2lin('#6E665B'), (len(phm), 1)) * (0.9 + 0.15 * vnoise(phm * 45))[:, None]
        top = np.abs(phm[:, 1] - 0.42) < 0.008
        ang = np.arctan2(phm[:, 2], phm[:, 0])
        base[top & ((ang * 40) % 1 < 0.55)] = srgb2lin('#C2B9A8')
        alb[hm] = base; spec[hm] = 0.03; gloss[hm] = 6; wrap[hm] = 0.25
    rm = mat == M_RING
    alb[rm] = srgb2lin('#C9A060'); spec[rm] = 0.9; gloss[rm] = 50; metal[rm] = True
    bm = mat == M_BRONZE
    if bm.any():
        pb = p[bm]
        pat = np.clip((vnoise(pb * 7.0) - 0.45) * 2.5, 0, 1)[:, None]
        base = srgb2lin('#7A5A34')[None, :] * (1 - pat) + srgb2lin('#4F6A5C')[None, :] * pat
        base *= (0.85 + 0.2 * vnoise(pb * 40))[:, None]
        alb[bm] = base; spec[bm] = 0.75 * (1 - 0.7 * pat[:, 0]); gloss[bm] = 35; metal[bm] = pat[:, 0] < 0.5
        wrap[bm] = 0.1
    am = mat == M_ASH
    if am.any():
        pa = p[am]
        alb[am] = srgb2lin('#8E8983')[None, :] * (0.8 + 0.3 * vnoise(pa * 60))[:, None]; spec[am] = 0.02; gloss[am] = 4
    km = mat == M_STICK
    if km.any():
        pk = p[km]
        alb[km] = srgb2lin('#7E2F1E'); spec[km] = 0.05; gloss[km] = 10
        tips = np.array([b for a, b in POSE['sticks']])
        dt = np.min(length(pk[:, None, :] - tips[None, :, :]), axis=1)
        hot = np.clip(1 - dt / 0.045, 0, 1) ** 1.5
        emissive[km] = np.outer(hot, V(1.0, 0.32, 0.08) * 6.0)
        alb[km] *= (1 - 0.8 * hot)[:, None]
        # ash grey just below tip
        grey = (dt > 0.045) & (dt < 0.075)
        sub = alb[km]; sub[grey] = srgb2lin('#9A938B'); alb[km] = sub
    um = mat == M_CUSH
    if um.any():
        pu = p[um] - POSE['cushion']
        rr = np.sqrt(pu[:, 0] ** 2 + pu[:, 2] ** 2); ang = np.arctan2(pu[:, 2], pu[:, 0])
        base = np.tile(srgb2lin('#9A6A3C'), (len(pu), 1)) * (0.85 + 0.25 * vnoise(p[um] * 30))[:, None]
        weave = 0.92 + 0.08 * np.sin(rr * 160)
        base *= weave[:, None]
        ring_st = (np.abs(rr - 0.45) < 0.008) & ((ang * 45) % 1 < 0.5)
        base[ring_st] = srgb2lin('#B89A6A')
        alb[um] = base; spec[um] = 0.03; gloss[um] = 6; wrap[um] = 0.3
    fm = mat == M_FLOOR
    if fm.any():
        pf = p[fm]
        r2 = (pf[:, 0] - target[0]) ** 2 + (pf[:, 2] - target[2] + 0.4) ** 2
        base = np.tile(srgb2lin('#3A302A'), (len(pf), 1)) * (0.75 + 0.25 * vnoise(pf * 3))[:, None]
        base *= np.exp(-r2 / 8.0)[:, None] * 0.9 + 0.1
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
    fres = np.clip(1 - np.sum(n * v, -1), 0, 1) ** 3
    rimd = np.clip(np.sum(n * rim_dir, -1), 0, 1)
    c += alb * (rim_col[None, :] * (rimd * fres)[:, None]) * 1.6
    lamp_p = POSE['up'].to_world(LAMP_C + V(0, 0, -0.06))
    ldl = lamp_p - p; dl = length(ldl); ldl /= dl[:, None]
    lam = np.clip(np.sum(n * ldl, -1), 0, 1) / (1 + 60 * dl ** 2) * lamp
    c += alb * (V(1.0, 0.7, 0.3) * 1.6)[None, :] * lam[:, None]
    # incense tip glow onto nearby surfaces
    for a, b in POSE['sticks']:
        ldt = b - p; dtt = length(ldt); ldt /= dtt[:, None]
        g = np.clip(np.sum(n * ldt, -1), 0, 1) / (1 + 400 * dtt ** 2) * 0.6
        c += alb * V(1.0, 0.4, 0.12)[None, :] * g[:, None]
    skyw = np.clip(0.5 + 0.5 * n[:, 1], 0, 1)
    amb = np.outer(skyw, sky) + np.outer(1 - skyw, ground_bounce)
    c += alb * amb * ao[:, None]
    gl = ((spec > 0.3) & (mat == M_CLAY)) | (mat == M_BRONZE)
    if gl.any():
        rr = rd[idx][gl] - 2 * np.sum(rd[idx][gl] * n[gl], -1)[:, None] * n[gl]
        envw = np.exp(-((rr[:, 0] - 0.55) ** 2 + (rr[:, 1] - 0.15) ** 2 + (rr[:, 2] + 0.8) ** 2) / 0.08)
        env = np.outer(np.clip(rr[:, 1] * 0.5 + 0.5, 0, 1), V(0.08, 0.08, 0.09)) + np.outer(envw, V(1.0, 0.6, 0.3) * 1.5)
        fr = 0.04 + 0.96 * np.clip(1 - np.sum(n[gl] * v[gl], -1), 0, 1) ** 5
        k = np.where(mat[gl] == M_BRONZE, 0.35, 1.0)
        c[gl] += env * ((fr * 0.9 + 0.08) * k)[:, None] * ao[gl][:, None]
    c += emissive
    col[idx] = c
    emb = np.zeros((N, 3)); emb[idx] = emissive
    depth_buf = np.full(N, 1e9); depth_buf[idx] = t[idx]

    img = col.reshape(H2, W2, 3)
    a_, b_, c_, d_, e_ = 2.51, 0.03, 2.43, 0.59, 0.14
    x = img * 0.85
    img = np.clip((x * (a_ * x + b_)) / (x * (c_ * x + d_) + e_), 0, 1)
    img = np.where(img <= 0.0031308, 12.92 * img, 1.055 * img ** (1 / 2.4) - 0.055)
    yy, xx = np.mgrid[0:H2, 0:W2]
    vig = 1 - 0.35 * (((xx / W2 - 0.5) ** 2 + (yy / H2 - 0.5) ** 2) * 2.2)
    img = np.clip(img * vig[..., None], 0, 1)

    rng = np.random.default_rng(seed)
    dbuf = depth_buf.reshape(H2, W2)
    # smoke from incense tips
    if POSE['sticks']:
        layer = Image.new('L', (W2, H2), 0); dr = ImageDraw.Draw(layer)
        for i, (a, b) in enumerate(POSE['sticks']):
            ph0 = rng.uniform(0, 6.28)
            for k in range(220):
                s = k / 220
                hgt = 1.5 * s
                P3 = b + V(0.10 * math.sin(4.0 * hgt + ph0) * (0.3 + s) + 0.25 * s ** 1.6,
                           hgt, 0.06 * math.cos(3.1 * hgt + ph0) * s)
                (sx, sy), z = project(P3[None, :])[0][0], project(P3[None, :])[1][0]
                ix, iy = int(sx), int(sy)
                if 0 <= ix < W2 and 0 <= iy < H2 and dbuf[iy, ix] < z - 0.05:
                    continue
                r = (0.006 + 0.05 * s) / z / th * H2 / 2
                alpha = int(70 * (1 - s) ** 1.2 * min(1, s * 12))
                dr.ellipse([sx - r, sy - r, sx + r, sy + r], fill=None, outline=None)
                dr.ellipse([sx - r, sy - r, sx + r, sy + r], fill=min(255, alpha))
        sm_ = np.asarray(layer.filter(ImageFilter.GaussianBlur(radius=W2 / 300))).astype(np.float64) / 255
        sm_ = np.clip(sm_ * 1.4, 0, 1)
        img = img * (1 - sm_[..., None] * 0.55) + sm_[..., None] * 0.55 * np.array([0.78, 0.76, 0.74])
    # gold dust
    if POSE['particles']:
        layer = Image.new('L', (W2, H2), 0); dr = ImageDraw.Draw(layer)
        for k in range(150):
            r = rng.uniform(1.1, 2.2); a = rng.uniform(0, 2 * np.pi); hgt = rng.uniform(0.3, 3.6)
            P3 = V(r * math.cos(a), hgt, r * math.sin(a) * 0.9)
            (sx, sy), z = project(P3[None, :])[0][0], project(P3[None, :])[1][0]
            ix, iy = int(sx), int(sy)
            if not (0 <= ix < W2 and 0 <= iy < H2) or dbuf[iy, ix] < z: continue
            rad = rng.uniform(0.004, 0.011) / z / th * H2 / 2
            dr.ellipse([sx - rad, sy - rad, sx + rad, sy + rad], fill=int(rng.uniform(120, 255)))
        g1 = np.asarray(layer.filter(ImageFilter.GaussianBlur(radius=W2 / 900))).astype(np.float64) / 255
        g2 = np.asarray(layer.filter(ImageFilter.GaussianBlur(radius=W2 / 160))).astype(np.float64) / 255
        gd = np.clip(g1 * 1.3 + g2 * 1.6, 0, 1)
        img = 1 - (1 - img) * (1 - gd[..., None] * np.array([1.0, 0.78, 0.38]))
    e = emb.reshape(H2, W2, 3)
    e = np.clip(e / max(np.percentile(e[e > 0], 99.5) if (e > 0).any() else 1, 1e-6), 0, 1)
    eim = Image.fromarray((e * 255).astype(np.uint8))
    e2 = np.asarray(eim.filter(ImageFilter.GaussianBlur(radius=W2 / 45))).astype(np.float64) / 255
    e3 = np.asarray(eim.filter(ImageFilter.GaussianBlur(radius=W2 / 160))).astype(np.float64) / 255
    img = 1 - (1 - img) * (1 - np.clip(e2 * 1.2 * min(lamp, 1.3) + e3 * 0.6, 0, 1) * np.array([1.0, 0.72, 0.38]))
    im = Image.fromarray((np.clip(img, 0, 1) * 255).astype(np.uint8))
    if ss > 1: im = im.resize((W, H), Image.LANCZOS)
    im.save(out)
    print(f'saved {out} in {time.time()-t0:.1f}s')

CAMS = {
    'pray':      dict(yaw=0, dist=9.0, look=(0, 1.72, 0), cam_y=2.1, fov=25),
    'incense':   dict(yaw=32, dist=10.5, look=(-0.35, 1.55, -0.9), cam_y=2.2, fov=26),
    'prostrate': dict(yaw=48, dist=10.0, look=(0, 0.8, -1.1), cam_y=2.7, fov=25),
    'return':    dict(yaw=14, dist=9.6, look=(0, 1.78, 0), cam_y=2.0, fov=27),
}

if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--pose', default='pray'); ap.add_argument('--out', default='out.png')
    ap.add_argument('--w', type=int, default=900); ap.add_argument('--h', type=int, default=1200)
    ap.add_argument('--ss', type=int, default=1); ap.add_argument('--yaw', type=float, default=None)
    a = ap.parse_args()
    POSE.update(make_pose(a.pose))
    cfg = dict(CAMS[a.pose])
    if a.yaw is not None: cfg['yaw'] = a.yaw
    render(a.w, a.h, a.out, ss=a.ss, **cfg)
