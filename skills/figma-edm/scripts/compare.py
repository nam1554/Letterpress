#!/usr/bin/env python3
"""Render an HTML at 700px width via headless Chrome, compare to figma_full.png band-by-band."""
import subprocess, sys, os, json
from PIL import Image
import numpy as np

SP = os.environ.get("EDM_DIR", os.getcwd())
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BG = (236, 238, 243)  # body bg #eceef3

def render(html_path, out_png, width=700, height=2600):
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars",
        "--force-device-scale-factor=1", f"--window-size={width},{height}",
        f"--screenshot={out_png}", "--virtual-time-budget=3000",
        f"file://{html_path}"], check=True, capture_output=True)

def autocrop(img, bg=BG, tol=6):
    a = np.asarray(img.convert("RGB")).astype(int)
    nonbg = np.abs(a - np.array(bg)).max(axis=2) > tol
    rows = np.where(nonbg.any(axis=1))[0]
    cols = np.where(nonbg.any(axis=0))[0]      # trim left/right gray gutters (headless scrollbar artifact)
    if len(rows) == 0 or len(cols) == 0: return img
    return img.crop((cols[0], 0, cols[-1] + 1, rows[-1] + 1))

def compare(my_png, ref_png="figma_full.png", bands=None):
    my = autocrop(Image.open(os.path.join(SP, my_png)))
    ref = Image.open(os.path.join(SP, ref_png)).convert("RGB")
    height_delta = my.height - ref.height
    print(f"my render : {my.size}")
    print(f"figma ref : {ref.size}")
    print(f"height Δ  : {height_delta:+d}px")
    # align to same width
    if my.width != ref.width:
        my = my.resize((ref.width, int(my.height*ref.width/my.width)))
    W = ref.width
    H = min(my.height, ref.height)
    a = np.asarray(my.crop((0,0,W,H)).convert("RGB")).astype(int)
    b = np.asarray(ref.crop((0,0,W,H)).convert("RGB")).astype(int)
    diff = np.abs(a-b).max(axis=2)               # per-pixel max channel diff
    # similarity = fraction of pixels within tolerance 24 (AA-insensitive)
    def sim(region_diff, tol=24):
        return 100.0*(region_diff <= tol).mean()
    print(f"\nOVERALL similarity (tol24): {sim(diff):.2f}%   mean|Δ|: {np.abs(a-b).mean():.2f}")
    passed = abs(height_delta) <= 5   # PASS bar criterion D
    bands_out = []
    if bands:
        print("\nBAND               y-range        sim%   meanΔ  shift status")
        for name, y0, y1 in bands:
            y1 = min(y1, H)
            # find best vertical shift in [-8,8] minimising mean|Δ| (shift-tolerant)
            best=None
            for sh in range(-8,9):
                aa0=max(y0+sh,0); aa1=min(y1+sh,H)
                bb0=aa0-sh; bb1=aa1-sh
                n=min(aa1-aa0, bb1-bb0)
                if n<=0: continue
                seg=np.abs(a[aa0:aa0+n]-b[bb0:bb0+n]).max(axis=2)
                sc=100.0*(seg<=24).mean(); mn=np.abs(a[aa0:aa0+n]-b[bb0:bb0+n]).mean()
                if best is None or sc>best[0]: best=(sc,mn,sh)
            s,mn,sh=best
            thr = 99 if name.startswith("img:") else 93
            ok = s>=thr
            passed = passed and ok
            bands_out.append({"name": name, "sim": round(s, 2), "shift": sh, "ok": ok})
            print(f"{name:18s} {y0:4d}-{y1:<4d}   {s:6.2f}   {mn:5.2f}  {sh:+3d}  {'OK' if ok else 'FAIL(<'+str(thr)+')'}")
    print("\nRESULT:", "PASS ✅" if passed else "FAIL ❌")
    # machine-readable verdict for tooling (e.g. the Letterpress quality gate)
    with open(os.path.join(SP, "verify.json"), "w") as f:
        json.dump({"result": "PASS" if passed else "FAIL",
                   "overall": round(sim(diff), 2),
                   "mean_delta": round(float(np.abs(a-b).mean()), 2),
                   "height_delta": int(height_delta),
                   "bands": bands_out}, f, ensure_ascii=False, indent=1)
    # write side-by-side + heatmap
    heat = (np.clip(diff,0,80)/80*255).astype(np.uint8)
    Image.fromarray(heat).save(os.path.join(SP,"diff_heat.png"))
    sbs = Image.new("RGB",(W*2+20, H),(255,255,255))
    sbs.paste(my.crop((0,0,W,H)),(0,0)); sbs.paste(ref.crop((0,0,W,H)),(W+20,0))
    sbs.save(os.path.join(SP,"side_by_side.png"))
    return sim(diff)

# section bands in figma reference coordinates (700x2181)
BANDS = [
    ("header",        0,   85),
    ("img:hero",      85,  470),
    ("intro",        470,  760),
    ("cards-head",   760,  850),
    ("card1",        850,  986),
    ("card2",        986, 1140),
    ("card3",       1140, 1294),
    ("card4",       1294, 1448),
    ("img:darkban", 1479, 1666),
    ("cta",         1666, 1961),
    ("footer",      1961, 2181),
]

if __name__ == "__main__":
    html = sys.argv[1] if len(sys.argv)>1 else os.path.expanduser("~/Downloads/aisurfer_newsletter.html")
    out = sys.argv[2] if len(sys.argv)>2 else "my_full.png"
    render(html, os.path.join(SP,out), width=820)
    compare(out, bands=BANDS)
