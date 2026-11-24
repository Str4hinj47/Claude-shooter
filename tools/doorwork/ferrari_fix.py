import bpy, bmesh, math
from mathutils import Vector, Matrix

SRC = "/home/user/Claude-shooter/tools/doorwork/original_models/ferrari.glb"
DST = "/home/user/Claude-shooter/public/models/ferrari.glb"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
def gtf(v): return Vector((v.x, v.z, -v.y))

# 1. bake de-skew: glTF Ry(+13.5 deg) about car center == Blender Rz about center
pts = [o.matrix_world @ Vector(c) for o in bpy.context.scene.objects if o.type == 'MESH' for c in o.bound_box]
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
cc = (mn + mx) * 0.5
R = Matrix.Translation(cc) @ Matrix.Rotation(math.radians(13.5), 4, 'Z') @ Matrix.Translation(-cc)
for o in [x for x in bpy.context.scene.objects if x.parent is None]:
    o.matrix_world = R @ o.matrix_world
bpy.context.view_layer.update()
print(f"[deskew] Ry(+13.5deg) about center, new bbox x[{mn.x:.2f},{mx.x:.2f}]", flush=True)

# 2. measure fl door skin (outer band) in file coords -> symmetric aperture region
dfl = bpy.data.objects["door_fl"]
fl_child = [c for c in dfl.children if c.type == 'MESH'][0]
zs, ys, xs = [], [], []
for p in fl_child.data.polygons:
    g = gtf(fl_child.matrix_world @ p.center)
    if abs(g.x) > 0.55:
        zs.append(g.z); ys.append(g.y); xs.append(g.x)
z0, z1, y0, y1, xmax = min(zs), max(zs), min(ys), max(ys), max(xs)
print(f"[fl] skin z[{z0:.3f},{z1:.3f}] y[{y0:.3f},{y1:.3f}] xmax {xmax:.3f} faces {len(zs)}", flush=True)

# 3. cut symmetric door apertures from the body (fl envelope mirrored, small insets)
body = bpy.data.objects["ferrari_car"]
ALLOW = ("paint__", "glass__", "trim__", "chrome__")
RZ0, RZ1, RY0, RY1, RXMIN = z0 + 0.03, z1 - 0.03, y0 + 0.02, y1 - 0.02, 0.55
hits = []
for i, p in enumerate(body.data.polygons):
    m = body.material_slots[p.material_index].material.name
    if not m.startswith(ALLOW): continue
    g = gtf(body.matrix_world @ p.center)
    if RZ0 <= g.z <= RZ1 and RY0 <= g.y <= RY1 and abs(g.x) >= RXMIN:
        hits.append(i)
bm = bmesh.new(); bm.from_mesh(body.data)
for i in sorted(hits, reverse=True):
    bm.faces.ensure_lookup_table()
    bm.faces.remove(bm.faces[i])
bm.to_mesh(body.data); bm.free()
print(f"[cut] removed {len(hits)} body faces (symmetric apertures)", flush=True)

# 4. delete ALL old door_fr children (door skin dup + engine-bay duplicate grab-bag)
dfr = bpy.data.objects["door_fr"]
for c in [x for x in dfr.children if x.type == 'MESH']:
    print(f"[fr] deleting old child {c.name} ({len(c.data.polygons)} faces)", flush=True)
    bpy.data.objects.remove(c, do_unlink=True)

# 5. repivot both doors: hinge at front edge (file z = z1), outer skin x, height 0.675
PIV_Y = 0.675
for dname, px in (("door_fl", xmax), ("door_fr", -xmax)):
    d = bpy.data.objects[dname]
    base = {c.name: c.matrix_world.copy() for c in d.children if c.type == 'MESH'}
    d.location = Vector((px, -z1, PIV_Y))  # Blender (x, -file_z, file_y)
    d.rotation_euler = (0, 0, 0)
    d.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    for c in d.children:
        if c.type == 'MESH': c.matrix_world = base[c.name]
    bpy.context.view_layer.update()
    print(f"[repivot] {dname} -> file (x={px:.3f}, y={PIV_Y}, z={z1:.3f})", flush=True)

# 6. rebuild door_fr as mirror of door_fl (copy mesh data -> UVs/materials preserved)
M = Matrix.Diagonal((-1.0, 1.0, 1.0, 1.0))
fl_wm = fl_child.matrix_world.copy()
dfr_wm = dfr.matrix_world.copy()
obj2 = fl_child.copy()
obj2.data = fl_child.data.copy()
obj2.name = "door_fr_ferrari_car_mirror"
bpy.context.collection.objects.link(obj2)
T = dfr_wm.inverted() @ M @ fl_wm  # world mirror -> door_fr-local
bm = bmesh.new(); bm.from_mesh(obj2.data)
bm.transform(T)
bm.normal_update()
bm.to_mesh(obj2.data); bm.free()
obj2.data.flip_normals()  # mirror inverts winding; restore outward normals
obj2.parent = dfr
obj2.matrix_parent_inverse = Matrix.Identity(4)
obj2.matrix_local = Matrix.Identity(4)
bpy.context.view_layer.update()
print(f"[mirror] door_fr rebuilt: {len(obj2.data.polygons)} faces, bbox world x"
      f"[{min((obj2.matrix_world @ v.co).x for v in obj2.data.vertices):.3f},"
      f"{max((obj2.matrix_world @ v.co).x for v in obj2.data.vertices):.3f}]", flush=True)

# 7. bake ALL mesh local transforms into vertices -> no object rotations remain
#    (tight bboxes for game centering; door empties keep only their pivot translation)
for o in [x for x in bpy.context.scene.objects if x.type == 'MESH']:
    if o.data.users > 1:
        o.data = o.data.copy()
    loc = o.matrix_local.copy()
    if loc == Matrix.Identity(4):
        continue
    bm = bmesh.new(); bm.from_mesh(o.data)
    bm.transform(loc)
    bm.normal_update()
    bm.to_mesh(o.data); bm.free()
    o.matrix_local = Matrix.Identity(4)
    print(f"[bake] {o.name}: transform baked into verts", flush=True)
bpy.context.view_layer.update()

bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_yup=True, export_apply=False,
    export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False)
print("EXPORTED", DST, flush=True)
