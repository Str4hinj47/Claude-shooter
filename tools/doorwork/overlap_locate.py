import bpy, math, sys, bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
CAR = sys.argv[1]; DOOR = sys.argv[2]; ANGLE = float(sys.argv[3])
GLB = f"/home/user/Claude-shooter/public/models/{CAR}.glb"
ORIENTATION = {"golf": 0.0, "mercedes": 0.0, "audi": math.pi, "mustang": 0.0,
               "ferrari": math.pi + (13.5*math.pi/180), "r8": math.pi, "challenger": math.pi,
               "rangerover": math.pi, "semi": 0.0, "kraz": 0.0}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
holder = bpy.data.objects.new("holder", None)
bpy.context.scene.collection.objects.link(holder)
holder.matrix_world = Matrix.Rotation(math.radians(-90), 4, 'X')
bpy.context.view_layer.update()
roots = [o for o in bpy.context.scene.objects if o.parent is None and o.name != "holder"]
for o in roots:
    o.parent = holder; o.matrix_parent_inverse = Matrix.Identity(4)
bpy.context.view_layer.update()
meshes_all = [o for o in bpy.context.scene.objects if o.type == 'MESH']
pts = []
for o in meshes_all:
    for c in o.bound_box: pts.append(o.matrix_world @ Vector(c))
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
center = (mn + mx) * 0.5
holder.matrix_world = Matrix.Translation(Vector((-center.x, -mn.y, -center.z))) @ Matrix.Rotation(ORIENTATION.get(CAR, 0.0), 4, 'Y') @ holder.matrix_world
bpy.context.view_layer.update()

def make_tree_mapped(o):
    """returns (tree, faces) where faces[i] = (world_center, matname) for BVH triangle i"""
    bm = bmesh.new()
    vmap = [bm.verts.new(o.matrix_world @ v.co) for v in o.data.vertices]
    faces = []
    for p in o.data.polygons:
        try:
            f = bm.faces.new([vmap[i] for i in p.vertices])
            mw = o.matrix_world
            mat = o.material_slots[p.material_index].material.name if o.material_slots else "?"
            faces.append((mw @ p.center, mat))
        except ValueError:
            pass
    t = BVHTree.FromBMesh(bm, epsilon=0.001)
    bm.free()
    return t, faces

d = bpy.data.objects[DOOR]
piv = d.matrix_world.translation.copy()
side = 1 if piv.x > 0 else -1
R = Matrix.Translation(piv) @ Matrix.Rotation(math.radians(side * ANGLE), 4, 'Y') @ Matrix.Translation(-piv)
for c in d.children_recursive:
    if c.type == 'MESH': c.matrix_world = R @ c.matrix_world
bpy.context.view_layer.update()
body_trees = []
for o in meshes_all:
    if o.parent and o.parent.name.startswith("door_"): continue
    t, f = make_tree_mapped(o)
    body_trees.append((o.name, t, f))
for c in d.children_recursive:
    if c.type != 'MESH': continue
    t1, f1 = make_tree_mapped(c)
    for bn, t2, f2 in body_trees:
        ov = t1.overlap(t2)
        for i1, i2 in ov:
            w, m = f1[i1]
            w2, m2 = f2[i2]
            print(f"OVERLAP door[{c.name} {m}] at ({w.x:.3f},{w.y:.3f},{w.z:.3f})  <-- body[{bn} {m2}] at ({w2.x:.3f},{w2.y:.3f},{w2.z:.3f})")
