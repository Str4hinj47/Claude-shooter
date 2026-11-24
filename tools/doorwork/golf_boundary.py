import bpy, json
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="/home/user/Claude-shooter/public/models/golf.glb")
def gtf(v): return Vector((v.x, v.z, -v.y))
door = bpy.data.objects["door_fl_golf_car"]
me = door.data
# boundary edges = edges used by exactly 1 polygon
edge_use = {}
for p in me.polygons:
    for e in p.edge_keys:
        edge_use[e] = edge_use.get(e, 0) + 1
boundary = [e for e, n in edge_use.items() if n == 1]
bverts = set()
for e in boundary:
    bverts.add(e[0]); bverts.add(e[1])
pts = [gtf(door.matrix_world @ me.vertices[i].co) for i in bverts]
print("boundary edges:", len(boundary), "verts:", len(bverts))
# cluster boundary verts by z (leading edge should be vertical line at z ~ -0.75)
import collections
zc = collections.Counter(round(p.z, 2) for p in pts)
print("z distribution of boundary verts (top 12):", zc.most_common(12))
# look at the leading edge: verts with z < -0.70
lead = [p for p in pts if p.z < -0.70]
if lead:
    print(f"leading edge: n={len(lead)} z[{min(p.z for p in lead):.3f},{max(p.z for p in lead):.3f}] x[{min(p.x for p in lead):.3f},{max(p.x for p in lead):.3f}] y[{min(p.y for p in lead):.3f},{max(p.y for p in lead):.3f}]")
    ys = sorted(round(p.y,2) for p in lead)
    print("leading-edge y samples:", ys[:8], "...", ys[-4:])
trail = [p for p in pts if p.z > 0.25]
if trail:
    print(f"trailing edge: n={len(trail)} z[{min(p.z for p in trail):.3f},{max(p.z for p in trail):.3f}] x[{min(p.x for p in trail):.3f},{max(p.x for p in trail):.3f}] y[{min(p.y for p in trail):.3f},{max(p.y for p in trail):.3f}]")
# and the hole in the body: body faces near the fl door window frame?
