"""Verify a car GLB's door rigging in game wrapper space (glTF Y-up, front=-Z).
Usage: verify.py <car> [--angles 62,30]"""
import bpy, math, sys, bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

CAR = sys.argv[1]
GLB = f"/home/user/Claude-shooter/public/models/{CAR}.glb"
ORIENTATION = {"golf": 0.0, "mercedes": 0.0, "audi": math.pi, "mustang": 0.0,
               "ferrari": math.pi, "r8": math.pi, "challenger": math.pi,
               "rangerover": math.pi, "semi": 0.0, "kraz": 0.0}
ANGLES = [62.0]
if "--angles" in sys.argv:
    ANGLES = [float(a) for a in sys.argv[sys.argv.index("--angles")+1].split(",")]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

# Blender world == glTF wrapper space after holder flip + ORIENTATION + ground/center
holder = bpy.data.objects.new("holder", None)
bpy.context.scene.collection.objects.link(holder)
holder.matrix_world = Matrix.Rotation(math.radians(-90), 4, 'X')
bpy.context.view_layer.update()
roots = [o for o in bpy.context.scene.objects if o.parent is None and o.name != "holder"]
for o in roots:
    o.parent = holder
    o.matrix_parent_inverse = Matrix.Identity(4)
bpy.context.view_layer.update()
meshes_all = [o for o in bpy.context.scene.objects if o.type == 'MESH']

def wbbox(objs):
    pts = []
    for o in objs:
        if o.type != 'MESH': continue
        for c in o.bound_box:
            pts.append(o.matrix_world @ Vector(c))
    if not pts: return None, None
    return (Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
            Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))))

def cbbox(objs):
    pts = []
    for o in objs:
        if o.type != 'MESH': continue
        mw = o.matrix_world
        for p in o.data.polygons:
            pts.append(mw @ p.center)
    if not pts: return None, None
    return (Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
            Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))))

def make_tree(o):
    bm = bmesh.new()
    vmap = [bm.verts.new(o.matrix_world @ v.co) for v in o.data.vertices]
    for p in o.data.polygons:
        try:
            bm.faces.new([vmap[i] for i in p.vertices])
        except ValueError:
            pass
    t = BVHTree.FromBMesh(bm, epsilon=0.001)
    bm.free()
    return t

mn, mx = wbbox(meshes_all)
center = (mn + mx) * 0.5
M = Matrix.Translation(Vector((-center.x, -mn.y, -center.z))) @ Matrix.Rotation(ORIENTATION.get(CAR, 0.0), 4, 'Y')
holder.matrix_world = M @ holder.matrix_world
bpy.context.view_layer.update()
mn, mx = wbbox(meshes_all)

report = {"car": CAR, "doors": {}, "issues": []}
print(f"### {CAR}: wrapper bbox x[{mn.x:.2f},{mx.x:.2f}] y[{mn.y:.2f},{mx.y:.2f}] z[{mn.z:.2f},{mx.z:.2f}]")

doors = [o for o in bpy.context.scene.objects if o.name.startswith("door_") and o.type == 'EMPTY']

# 1. door geometry/hinge
for d in sorted(doors, key=lambda x: x.name):
    dm = [c for c in d.children_recursive if c.type == 'MESH']
    key = d.name.replace("door_", "")
    if not dm:
        report["issues"].append(f"{d.name}: no meshes")
        continue
    dmn, dmx = wbbox(dm)
    piv = d.matrix_world.translation
    armZ = (dmn.z + dmx.z)/2 - piv.z
    side = "L" if piv.x < 0 else "R"
    front_hinged = armZ > 0
    report["doors"][key] = {"piv": [round(c,3) for c in piv], "side": side,
             "mesh_z": [round(dmn.z,3), round(dmx.z,3)], "armZ": round(armZ,3),
             "n": len(dm), "front_hinged": front_hinged}
    print(f"  {d.name}: side={side} piv=({piv.x:.2f},{piv.z:.2f}) meshz[{dmn.z:.2f},{dmx.z:.2f}] armZ={armZ:.2f} meshes={len(dm)} front_hinged={front_hinged}")
    if not front_hinged:
        report["issues"].append(f"{d.name}: NOT front-hinged (armZ={armZ:.2f})")

# 2. aperture: outer shell band must be free of body faces in door region
ALLOW = ("paint__", "glass__", "trim__", "chrome__", "carbon__")
for d in sorted(doors, key=lambda x: x.name):
    if not d.children: continue
    dm = [c for c in d.children_recursive if c.type == 'MESH']
    dmn, dmx = cbbox(dm)
    door_left = dmn.x < 0
    outer = max(abs(dmn.x), abs(dmx.x))
    count = 0
    for o in meshes_all:
        if o.parent and o.parent.name.startswith("door_"): continue
        mw = o.matrix_world
        for p in o.data.polygons:
            m = o.material_slots[p.material_index].material.name if o.material_slots else ""
            if not m.startswith(ALLOW): continue
            g = mw @ p.center
            if not (dmn.z + 0.06 <= g.z <= dmx.z - 0.06): continue
            if not (dmn.y + 0.06 <= g.y <= dmx.y - 0.06): continue
            if abs(g.x) < 0.75 * outer: continue
            count += 1
    key = d.name.replace("door_", "")
    report["doors"].setdefault(key, {})["body_faces_left"] = count
    status = "OK" if count == 0 else "APERTURE-CLOGGED"
    print(f"  aperture {d.name}: {count} body faces remain in door region -> {status}")
    if count > 0:
        report["issues"].append(f"{d.name}: body still has {count} faces in door aperture")

# 3. intersection at open angles
for angle in ANGLES:
    print(f"  --- open {angle} deg: door vs body intersection ---")
    body_trees = []
    for o in meshes_all:
        if o.parent and o.parent.name.startswith("door_"): continue
        body_trees.append((o.name, make_tree(o)))
    for d in sorted(doors, key=lambda x: x.name):
        if not d.children: continue
        piv = d.matrix_world.translation.copy()
        side = 1 if piv.x > 0 else -1
        R = Matrix.Translation(piv) @ Matrix.Rotation(math.radians(side * angle), 4, 'Y') @ Matrix.Translation(-piv)
        base = {c.name: c.matrix_world.copy() for c in d.children_recursive if c.type == 'MESH'}
        for c in d.children_recursive:
            if c.type == 'MESH': c.matrix_world = R @ base[c.name]
        bpy.context.view_layer.update()
        total = 0
        worst = ("", 0)
        for c in d.children_recursive:
            if c.type != 'MESH': continue
            t1 = make_tree(c)
            for bn, t2 in body_trees:
                ov = t1.overlap(t2)
                if ov:
                    total += len(ov)
                    if len(ov) > worst[1]: worst = (bn, len(ov))
        key = d.name.replace("door_", "")
        report["doors"].setdefault(key, {})[f"clash_{int(angle)}"] = total
        print(f"    {d.name}: overlapping tri pairs = {total}" + (f" (worst: {worst[0]} {worst[1]})" if total else ""))
        if total > 40:
            report["issues"].append(f"{d.name} clips body at {angle}deg ({total} pairs)")
        for c in d.children_recursive:
            if c.type == 'MESH': c.matrix_world = base[c.name]
        bpy.context.view_layer.update()

print("ISSUES:", report["issues"] if report["issues"] else "NONE")
