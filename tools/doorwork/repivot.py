"""Move door pivot nodes to new positions, preserving mesh world transforms."""
import bpy, sys, math
from mathutils import Vector, Matrix

SRC = sys.argv[1]
DST = sys.argv[2]
MOVES = {}  # door name -> new glTF-file-space pivot (x, y, z)
for arg in sys.argv[3:]:
    name, rest = arg.split("=")
    x, y, z = rest.split(",")
    MOVES[name] = (float(x), float(y), float(z))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
for name, piv in MOVES.items():
    d = bpy.data.objects[name]
    # store children world matrices
    base = {c.name: c.matrix_world.copy() for c in d.children_recursive if c.type == 'MESH'}
    # glTF (x,y,z) -> Blender (x, -z, y)
    d.location = Vector((piv[0], -piv[2], piv[1]))
    d.rotation_euler = (0, 0, 0)
    d.scale = (1, 1, 1)
    bpy.context.view_layer.update()
    for c in d.children_recursive:
        if c.type == 'MESH':
            c.matrix_world = base[c.name]
    bpy.context.view_layer.update()
    print(f"[repivot] {name} -> {piv}", flush=True)

bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_yup=True, export_apply=False,
    export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False)
print("EXPORTED", DST, flush=True)
