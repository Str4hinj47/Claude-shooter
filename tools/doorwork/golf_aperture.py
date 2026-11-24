import bpy, math, json
from mathutils import Vector

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="/home/user/Claude-shooter/public/models/golf.glb")
def gtf(v): return Vector((v.x, v.z, -v.y))

body = bpy.data.objects.get("golf_car")
me = body.data
regions = {
    "fl": dict(xr=(-0.95, -0.55), zr=(-0.75, 0.34), yr=(0.26, 1.23)),
    "fr": dict(xr=( 0.55,  0.95), zr=(-0.75, 0.34), yr=(0.26, 1.23)),
    "rl": dict(xr=(-0.95, -0.55), zr=( 0.34, 1.30), yr=(0.26, 1.23)),
    "rr": dict(xr=( 0.55,  0.95), zr=( 0.34, 1.30), yr=(0.26, 1.23)),
}
counts = {k: 0 for k in regions}
areas = {k: 0.0 for k in regions}
for poly in me.polygons:
    c = gtf(body.matrix_world @ poly.center)
    for k, r in regions.items():
        if r["xr"][0] <= c.x <= r["xr"][1] and r["zr"][0] <= c.z <= r["zr"][1] and r["yr"][0] <= c.y <= r["yr"][1]:
            counts[k] += 1
            areas[k] += poly.area
            break
print("JSON:" + json.dumps({k: {"faces": counts[k], "area_m2": round(areas[k],3)} for k in regions}))
