import bpy, bmesh
from mathutils import Vector, Matrix

SRC = "/home/user/Claude-shooter/tools/doorwork/original_models/challenger.glb"
DST = "/home/user/Claude-shooter/public/models/challenger.glb"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
def gtf(v): return Vector((v.x, v.z, -v.y))

# 1. trim door edge bands (vertex-based) leaving 2cm clearance to pillar frames
#    frames: front strip file z[0.75,0.87], rear strip file z[-0.55,-0.45]
for dname in ("door_fl", "door_fr"):
    d = bpy.data.objects[dname]
    for c in [x for x in d.children if x.type == 'MESH']:
        mw = c.matrix_world
        hits = []
        for i, p in enumerate(c.data.polygons):
            zmax = max(gtf(mw @ c.data.vertices[v].co).z for v in p.vertices)
            zmin = min(gtf(mw @ c.data.vertices[v].co).z for v in p.vertices)
            if zmax > 0.73 or zmin < -0.43:
                hits.append(i)
        if hits:
            bm = bmesh.new()
            bm.from_mesh(c.data)
            for i in sorted(hits, reverse=True):
                bm.faces.ensure_lookup_table()
                bm.faces.remove(bm.faces[i])
            bm.to_mesh(c.data)
            bm.free()
            print(f"[trim] {dname}/{c.name}: removed {len(hits)} edge-band faces", flush=True)

# 1b. remove mesh objects that became empty after trimming
for o in [x for x in bpy.context.scene.objects if x.type == 'MESH' and len(x.data.polygons) == 0]:
    print(f"[cleanup] removing empty mesh {o.name}", flush=True)
    bpy.data.objects.remove(o, do_unlink=True)

# 2. repivot doors to the trimmed leading edge z=0.73 (file)
for dname, x in (("door_fl", 0.88), ("door_fr", -0.88)):
    d = bpy.data.objects[dname]
    base = {c.name: c.matrix_world.copy() for c in d.children if c.type == 'MESH'}
    d.location = Vector((x, -0.73, 0.795))  # glTF (x, y=0.795, z=0.73) -> Blender (x, -z, y)
    d.rotation_euler = (0, 0, 0)
    d.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    for c in d.children:
        if c.type == 'MESH': c.matrix_world = base[c.name]
    print(f"[repivot] {dname} -> file (x={x}, y=0.795, z=0.73)", flush=True)
bpy.context.view_layer.update()

# 3. mirror fl door handle to fr (fr handle is missing most faces)
fl_handle = bpy.data.objects["door_fl_Plane.016_Plane.044"]
fr_door = bpy.data.objects["door_fr"]
src_mesh = fl_handle.data
verts = [(-v.co.x, v.co.y, v.co.z) for v in src_mesh.vertices]  # mirror local x
faces = [tuple(reversed(p.vertices)) for p in src_mesh.polygons]  # reverse winding for mirror
new_mesh = bpy.data.meshes.new("handle_mirror")
new_mesh.from_pydata(verts, [], faces)
copy = bpy.data.objects.new("door_fr_Plane.016_Plane.044_mirrored", new_mesh)
for slot in fl_handle.material_slots:
    copy.data.materials.append(slot.material)
copy.parent = fr_door
copy.matrix_local = fl_handle.matrix_local.copy()
bpy.context.scene.collection.objects.link(copy)
print("[mirror] handle copied to door_fr", flush=True)

# 4. remove the broken partial handle on fr (43 faces) to avoid z-fighting with mirrored one
old = bpy.data.objects.get("door_fr_Plane.016_Plane.044")
if old and len(old.data.polygons) < 100:
    bpy.data.objects.remove(old, do_unlink=True)
    print("[remove] broken fr handle mesh (43 faces)", flush=True)

bpy.context.view_layer.update()
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_yup=True, export_apply=False,
    export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False)
print("EXPORTED", DST, flush=True)
