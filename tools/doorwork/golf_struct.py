import bpy, json, collections
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="/home/user/Claude-shooter/public/models/golf.glb")
def gtf(v): return Vector((v.x, v.z, -v.y))
for o in sorted(bpy.context.scene.objects, key=lambda x: x.name):
    if o.type != 'MESH': continue
    me = o.data
    per = collections.Counter()
    areas = collections.Counter()
    for p in me.polygons:
        mn = o.material_slots[p.material_index].material.name if o.material_slots else "?"
        per[mn] += 1; areas[mn] += round(p.area, 3)
    print(f"OBJECT {o.name}: verts={len(me.vertices)} polys={len(me.polygons)}")
    for m, c in per.most_common():
        print(f"   {m:40s} faces={c:6d} area={areas[m]:8.2f}")
    # bounds in glTF
    pts = [gtf(o.matrix_world @ v.co) for v in me.vertices]
    print(f"   bbox x[{min(p.x for p in pts):.2f},{max(p.x for p in pts):.2f}] y[{min(p.y for p in pts):.2f},{max(p.y for p in pts):.2f}] z[{min(p.z for p in pts):.2f},{max(p.z for p in pts):.2f}]")
