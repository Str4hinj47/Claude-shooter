import bpy, json, collections
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="/home/user/Claude-shooter/public/models/golf.glb")

def region_report(obj, matfilter, zr, yr, xr, label):
    me = obj.data
    mw = obj.matrix_world
    per = collections.Counter(); areas = collections.Counter()
    pts = []
    for p in me.polygons:
        m = obj.material_slots[p.material_index].material.name if obj.material_slots else "?"
        c = mw @ p.center
        # glTF-space coords for intuitive z/y/x
        g = Vector((c.x, c.z, -c.y))
        if not (zr[0] <= g.z <= zr[1] and yr[0] <= g.y <= yr[1] and xr[0] <= g.x <= xr[1]): continue
        if m not in matfilter: continue
        per[m] += 1; areas[m] += round(p.area, 2)
        pts.append(g)
    print(f"== {label}: total faces={sum(per.values())}")
    for m, c in per.most_common():
        print(f"     {m:35s} faces={c:6d} area={areas[m]:7.2f}")
    if pts:
        print(f"     bbox x[{min(p.x for p in pts):.3f},{max(p.x for p in pts):.3f}] y[{min(p.y for p in pts):.3f},{max(p.y for p in pts):.3f}] z[{min(p.z for p in pts):.3f},{max(p.z for p in pts):.3f}]")

body = bpy.data.objects["golf_car"]
ALLOWED = {"trim__Black-plastic","paint__Carpaint","glass__Windows-glass","chrome__Wing-mirror","chrome__Chrome","trim__Golf-door-card"}
region_report(body, ALLOWED, (-0.75, 0.34), (0.26, 1.23), (0.55, 2.0), "DOOR_FR skin (body, x>0.55)")
region_report(body, ALLOWED, (0.40, 1.06), (0.26, 1.23), (-2.0, -0.55), "DOOR_RL skin (body, x<-0.55)")
# rear card faces in golf_interior_rear
rear = bpy.data.objects["golf_interior_rear"]
region_report(rear, {"trim__Golf-door-card"}, (0.40, 1.06), (0.26, 1.23), (-2.0, -0.55), "DOOR_RL card (interior_rear)")
region_report(rear, {"trim__Golf-door-card"}, (0.40, 1.06), (0.26, 1.23), (0.55, 2.0), "DOOR_RR card (interior_rear)")
# also full material inventory of rear object with bboxes
print("== golf_interior_rear material bboxes:")
for m in {s.material.name for s in rear.material_slots}:
    pts = [Vector(((mw := rear.matrix_world) @ p.center).x, (mw @ p.center).z, -(mw @ p.center).y) for p in rear.polygons if rear.material_slots[p.material_index].material.name == m]
    if pts:
        print(f"   {m:35s} n={len(pts):4d} x[{min(p.x for p in pts):.2f},{max(p.x for p in pts):.2f}] y[{min(p.y for p in pts):.2f},{max(p.y for p in pts):.2f}] z[{min(p.z for p in pts):.2f},{max(p.z for p in pts):.2f}]")
