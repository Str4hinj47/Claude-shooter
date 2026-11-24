import bpy, json, math, sys, collections
from mathutils import Vector

CAR = sys.argv[1]
GLB = f"/home/user/Claude-shooter/public/models/{CAR}.glb"
ORIENTATION = {"golf": 0.0, "mercedes": 0.0, "audi": math.pi, "mustang": 0.0,
               "ferrari": math.pi + (13.5*math.pi/180), "r8": math.pi, "challenger": math.pi,
               "rangerover": math.pi, "semi": 0.0, "kraz": 0.0}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

# Blender world (bx,by,bz) -> glTF file (bx, bz, -by)
def gtf(v): return Vector((v.x, v.z, -v.y))

out = {"car": CAR, "orient_deg": round(math.degrees(ORIENTATION.get(CAR,0)),1), "mats": {}, "doors": {}}

# face-level material centroids in glTF file space
acc = collections.defaultdict(lambda: [0,0,0,0])  # sumx,y,z,count
for o in bpy.context.scene.objects:
    if o.type != 'MESH': continue
    me = o.data
    for poly in me.polygons:
        mats = o.material_slots
        name = mats[poly.material_index].material.name if mats and mats[poly.material_index].material else ""
        for pre in ("headlight", "taillight", "plate", "brake"):
            if name.startswith(pre):
                c = poly.center
                w = o.matrix_world @ Vector((c.x, c.y, c.z))
                g = gtf(w)
                a = acc[pre]
                a[0]+=g.x; a[1]+=g.y; a[2]+=g.z; a[3]+=1
                break
for pre, (sx, sy, sz, n) in acc.items():
    if n: out["mats"][pre] = {"cx": round(sx/n,2), "cy": round(sy/n,2), "cz": round(sz/n,2), "n": n}

doors = [o for o in bpy.context.scene.objects if o.name.startswith("door_") and o.type == 'EMPTY']
for d in sorted(doors, key=lambda x: x.name):
    dm = [c for c in d.children_recursive if c.type == 'MESH']
    pts = []
    for o in dm:
        for v in o.data.vertices:
            pts.append(gtf(o.matrix_world @ v.co))
    piv = gtf(d.matrix_world.translation)
    if pts:
        mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        out["doors"][d.name] = {"piv": [round(c,3) for c in piv],
            "mesh": [[round(c,3) for c in mn],[round(c,3) for c in mx]],
            "armZ": round((mn.z+mx.z)/2 - piv.z, 3), "n": len(dm), "nverts": len(pts)}
    else:
        out["doors"][d.name] = {"piv": [round(c,3) for c in piv], "n": 0}
print("JSON:" + json.dumps(out))
