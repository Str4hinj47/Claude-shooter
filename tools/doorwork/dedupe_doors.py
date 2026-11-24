"""Remove body faces that exactly duplicate door-mesh faces (double-skin fix)."""
import bpy, sys, collections
from mathutils import Vector

SRC = sys.argv[1]
DST = sys.argv[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

def face_key(obj, poly):
    mw = obj.matrix_world
    vs = []
    for i in poly.vertices:
        w = mw @ obj.data.vertices[i].co
        vs.append((round(w.x, 4), round(w.y, 4), round(w.z, 4)))
    vs.sort()
    return tuple(vs)

door_keys = set()
door_meshes = []
for o in bpy.context.scene.objects:
    if o.parent and o.parent.name.startswith("door_") and o.type == 'MESH':
        door_meshes.append(o)
for o in door_meshes:
    for p in o.data.polygons:
        door_keys.add(face_key(o, p))
print(f"door faces hashed: {len(door_keys)}", flush=True)

deleted_total = 0
for o in [x for x in bpy.context.scene.objects if x.type == 'MESH' and not (x.parent and x.parent.name.startswith('door_'))]:
    # spatial hash by vertex positions
    hits = []
    for i, p in enumerate(o.data.polygons):
        if face_key(o, p) in door_keys:
            hits.append(i)
    if hits:
        # delete via bmesh
        import bmesh
        bm = bmesh.new()
        bm.from_mesh(o.data)
        bm.faces.ensure_lookup_table()
        # map polygon order to bmesh order (same mesh, no prior edits)
        for i in hits:
            bm.faces[i].select_set(True) if False else None
        for i in sorted(hits, reverse=True):
            bm.faces.ensure_lookup_table()
            try:
                bm.faces[i].select = True
            except IndexError:
                pass
        # remove selected faces
        sel = [f for f in bm.faces if f.select]
        for f in sel:
            bm.faces.remove(f)
        bm.to_mesh(o.data)
        bm.free()
        deleted_total += len(hits)
        print(f"  deleted {len(hits):5d} duplicated faces from {o.name}", flush=True)
print(f"total deleted: {deleted_total}", flush=True)

bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_yup=True, export_apply=False,
    export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False)
print("EXPORTED", DST, flush=True)
