import bpy, json, math, sys
from mathutils import Vector, Euler, Matrix

CAR = sys.argv[1]
GLB = f"/home/user/Claude-shooter/public/models/{CAR}.glb"
ORIENTATION = {"golf": 0.0, "mercedes": 0.0, "audi": math.pi, "mustang": 0.0,
               "ferrari": math.pi + (13.5*math.pi/180), "r8": math.pi, "challenger": math.pi,
               "rangerover": math.pi, "semi": 0.0, "kraz": 0.0}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

# FILE-space analysis (no orientation flip): importer space == Rx(90)@glTF file space
# glTF file coords from Blender world: (bx, -bz, by)
def gtf(v):
    return Vector((v.x, -v.z, v.y))

meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
def bbox(objs):
    pts = []
    for o in objs:
        if o.type != 'MESH': continue
        for c in o.bound_box:
            pts.append(gtf(o.matrix_world @ Vector(c)))
    if not pts: return None, None
    return (Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
            Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))))

mn, mx = bbox(meshes)
out = {"car": CAR, "orient_deg": round(math.degrees(ORIENTATION.get(CAR,0)),1),
       "file_bbox": [[round(c,3) for c in mn], [round(c,3) for c in mx]], "doors": {}, "front": {}}

# material-group z centroids in glTF file space
import collections
mats = collections.defaultdict(list)
for o in meshes:
    for slot in o.material_slots:
        if slot.material is None: continue
        name = slot.material.name
        for pre in ("headlight", "taillight", "tire", "rim", "brake"):
            if name.startswith(pre):
                for c in o.bound_box:
                    mats[pre].append(gtf(o.matrix_world @ Vector(c)))
                break
for pre, pts in mats.items():
    zs = [p.z for p in pts]
    out["front"][pre] = {"zmin": round(min(zs),2), "zmax": round(max(zs),2)}

doors = [o for o in bpy.context.scene.objects if o.name.startswith("door_") and o.type == 'EMPTY']
for d in sorted(doors, key=lambda x: x.name):
    dm = [c for c in d.children_recursive if c.type == 'MESH']
    dmn, dmx = bbox(dm)
    piv = gtf(d.matrix_world.translation)
    out["doors"][d.name] = {
        "pivot": [round(c,3) for c in piv],
        "mesh_min": [round(c,3) for c in dmn] if dmn else None,
        "mesh_max": [round(c,3) for c in dmx] if dmx else None,
        "armZ": round(((dmn+dmx)*0.5).z - piv.z, 3) if dmn else None,
        "n": len(dm),
    }
print(json.dumps(out))
