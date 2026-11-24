import bpy, bmesh, math
from mathutils import Vector, Matrix

SRC = "/home/user/Claude-shooter/public/models/audi.glb"
DST = "/home/user/Claude-shooter/public/models/audi.glb"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

# purge stray wrapper objects from a previous bad export
for bad in [o for o in bpy.data.objects if o.name.startswith("holder") or o.name.startswith("_wrap")]:
    bpy.data.objects.remove(bad, do_unlink=True)

# wrapper space setup (same as verify.py)
holder = bpy.data.objects.new("_wrap", None)
bpy.context.scene.collection.objects.link(holder)
holder.matrix_world = Matrix.Rotation(math.radians(-90), 4, 'X')
bpy.context.view_layer.update()
for o in [o for o in bpy.context.scene.objects if o.parent is None and o.name != "_wrap"]:
    o.parent = holder; o.matrix_parent_inverse = Matrix.Identity(4)
bpy.context.view_layer.update()
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
center = (mn + mx) * 0.5
holder.matrix_world = Matrix.Translation(Vector((-center.x, -mn.y, -center.z))) @ Matrix.Rotation(math.pi, 4, 'Y') @ holder.matrix_world
bpy.context.view_layer.update()

body = bpy.data.objects["audi_car"]
bmw = body.matrix_world

# region: rim-material faces over the front-door aperture band (wrapper coords)
# fl side: x < -0.70 ; fr side: x > 0.70 ; y > 0.90 ; z in [-0.85, 0.15]
def in_region(g, side):
    return (g.x < -0.70 if side == "L" else g.x > 0.70) and g.y > 0.90 and -0.85 <= g.z <= 0.15

for side, dname in (("L", "door_fl"), ("R", "door_fr")):
    door = bpy.data.objects[dname]
    sel = []
    rim_slot = None
    for i, p in enumerate(body.data.polygons):
        mname = body.material_slots[p.material_index].material.name
        if not mname.startswith("rim"):
            continue
        g = bmw @ p.center
        if in_region(g, side):
            sel.append(i)
            rim_slot = p.material_index
    if not sel:
        print(f"[{dname}] no rim faces found?!", flush=True)
        continue
    mat = body.material_slots[rim_slot].material

    # extract faces into a new mesh (body-local coords), then delete from body
    vset = {}
    for i in sel:
        for vi in body.data.polygons[i].vertices:
            vset[vi] = None
    vold = sorted(vset)
    vidx = {v: k for k, v in enumerate(vold)}
    verts = [body.data.vertices[v].co.copy() for v in vold]
    faces = [[vidx[vi] for vi in body.data.polygons[i].vertices] for i in sel]

    me = bpy.data.meshes.new(f"{dname}_frametrim")
    me.from_pydata(verts, [], faces)
    me.materials.append(mat)
    obj = bpy.data.objects.new(f"{dname}_frametrim", me)
    bpy.context.collection.objects.link(obj)
    obj.matrix_world = bmw.copy()

    bm = bmesh.new(); bm.from_mesh(body.data)
    for i in sorted(sel, reverse=True):
        bm.faces.ensure_lookup_table()
        bm.faces.remove(bm.faces[i])
    bm.to_mesh(body.data); bm.free()

    # parent under the door node, preserving world transform
    obj.parent = door
    obj.matrix_parent_inverse = Matrix.Identity(4)
    obj.matrix_local = door.matrix_world.inverted() @ bmw
    bpy.context.view_layer.update()
    print(f"[{dname}] transferred {len(sel)} rim faces (frame trim) to door", flush=True)

# remove the wrapper holder from the scene before export!
h = bpy.data.objects.get("_wrap")
if h:
    bpy.data.objects.remove(h, do_unlink=True)
    print("[cleanup] removed holder from scene", flush=True)
bpy.context.view_layer.update()

bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_yup=True, export_apply=False,
    export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False)
print("EXPORTED", DST, flush=True)
