"""Pixel-diff closed vs open renders: programmatic 'screenshot check'.
Usage: renderdiff.py <car> <renderdir> <a0suffix> <a1suffix>  (e.g. ferrari dir a0 a62)"""
import bpy, sys, numpy as np

CAR, DIR, S0, S1 = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
VIEWS = ["left", "right", "top", "fl34", "fr34"]
W, H = 780, 500

def load(path):
    img = bpy.data.images.load(path)
    px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)
    bpy.data.images.remove(img)
    return px[:, :, :3]

report = {}
for v in VIEWS:
    a = load(f"{DIR}/{CAR}_{S0}_{v}.png")
    b = load(f"{DIR}/{CAR}_{S1}_{v}.png")
    d = np.abs(a - b).max(axis=2)  # max channel diff per pixel
    changed = d > 0.06
    frac = changed.mean()
    ys, xs = np.where(changed)
    if len(xs):
        bbox = (int(xs.min()), int(xs.max()), int(ys.min()), int(ys.max()))
        cx = (xs.min() + xs.max()) / 2 / W  # 0=left edge,1=right edge
    else:
        bbox, cx = None, -1
    # bottom quarter of frame (wheels/rocker — should be near-static)
    bot = changed[int(H*0.72):, :].mean()
    report[v] = {"changed_frac": round(float(frac), 4), "bbox_x0x1y0y1": bbox,
                 "cx": round(float(cx), 3), "bottom_changed": round(float(bot), 4)}
    print(f"{v:6s} changed={frac*100:5.1f}%  bbox={bbox}  cx={cx:.2f}  bottom={bot*100:4.1f}%", flush=True)

ok = True
lr, rr = report["left"]["changed_frac"], report["right"]["changed_frac"]
if lr < 0.018 or rr < 0.018:
    print("FAIL: door barely visible in side views"); ok = False
if abs(lr - rr) > 0.55 * max(lr, rr, 1e-9) and max(lr, rr) > 0.05:
    print("WARN: asymmetric side-view change"); ok = False
if report["top"]["changed_frac"] < 0.02:
    print("FAIL: top view shows no door motion"); ok = False
for v in ("fl34", "fr34"):
    if report[v]["changed_frac"] < 0.010:
        print(f"FAIL: {v} close-up shows no change"); ok = False
if report["left"]["bottom_changed"] > 0.10 or report["right"]["bottom_changed"] > 0.10:
    print("WARN: unexpected change in lower body region")
print("RENDERDIFF:", "OK" if ok else "ISSUES")
