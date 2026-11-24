import bpy, math, collections, bmesh
from mathutils import Vector, Matrix

SRC = "/home/user/Claude-shooter/tools/doorwork/original_models/golf.glb"
DST = "/home/user/Claude-shooter/public/models/golf.glb"

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
for o in bpy.context.scene.objects: o.select_set(False)
body = bpy.data.objects["golf_car"]
rear = bpy.data.objects["golf_interior_rear"]

ALLOWED_SKIN = {"trim__Black-plastic","paint__Carpaint","glass__Windows-glass","chrome__Wing-mirror","chrome__Chrome"}

def gtf(v): return Vector((v.x, v.z, -v.y))

def face_region_test(obj):
    """return dict face_index -> (gltf_coord, matname)"""
    mw = obj.matrix_world
    out = {}
    for i, p in enumerate(obj.data.polygons):
        m = obj.material_slots[p.material_index].material.name if obj.material_slots else "?"
        out[i] = (gtf(mw @ p.center), m)
    return out

def separate_region(obj, test, name):
    """test: fn(gltf_coord, matname) -> bool. Splits matching faces into new object `name`."""
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bm = bmesh.from_edit_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    bm.select_mode = {'FACE'}
    mw = obj.matrix_world
    keep = 0
    for f in bm.faces:
        m = obj.material_slots[f.material_index].material.name if obj.material_slots else "?"
        g = gtf(mw @ f.calc_center_median())
        f.select = bool(test(g, m))
        if f.select: keep += 1
    bm.select_flush_mode()
    before = set(bpy.data.objects)
    bpy.ops.mesh.separate(type='SELECTED')
    bpy.ops.object.mode_set(mode='OBJECT')
    new = [o for o in bpy.data.objects if o not in before]
    assert len(new) == 1, [o.name for o in new]
    new[0].name = name
    obj.select_set(False)
    new[0].select_set(False)
    print(f"[separate {name}] moved {keep} faces", flush=True)
    return new[0]

def parent_under(door_name, mesh_objs, pivot_gltf):
    empty = bpy.data.objects.new(door_name, None)
    bpy.context.scene.collection.objects.link(empty)
    empty.location = Vector((pivot_gltf[0], -pivot_gltf[2], pivot_gltf[1]))
    bpy.context.view_layer.update()
    for mesh in mesh_objs:
        keep = empty.matrix_world.inverted() @ mesh.matrix_world
        mesh.parent = empty
        mesh.matrix_parent_inverse = Matrix.Identity(4)
        mesh.matrix_basis = keep
    print(f"[pivot {door_name}] glTF={pivot_gltf}", flush=True)

def front_door_test(g, m):
    return m in ALLOWED_SKIN and 0.55 <= g.x and -0.75 <= g.z <= 0.34 and 0.26 <= g.y <= 1.23

def rear_door_test(g, m):
    if m not in ALLOWED_SKIN: return False
    if not (-2.0 <= g.x <= -0.55 and 0.40 <= g.z <= 1.02 and 0.26 <= g.y <= 1.23): return False
    if g.y > 0.93 and g.z > 0.98: return False   # C-pillar diagonal
    return True

def rear_door_test_r(g, m):
    g2 = Vector((-g.x, g.y, g.z))
    return rear_door_test(g2, m)

def card_test(g, m):
    return m == "trim__Golf-door-card" and -2.0 <= g.x <= -0.55 and 0.40 <= g.z <= 1.02 and 0.26 <= g.y <= 1.23

def card_test_r(g, m):
    return card_test(Vector((-g.x, g.y, g.z)), m)

skin_fr = separate_region(body, front_door_test, "door_fr_golf_car")
skin_rl = separate_region(body, rear_door_test, "door_rl_golf_car")
skin_rr = separate_region(body, rear_door_test_r, "door_rr_golf_car")
card_rl = separate_region(rear, card_test, "door_rl_card")
card_rr = separate_region(rear, card_test_r, "door_rr_card")

parent_under("door_fr", [skin_fr], (0.79, 0.78, -0.75))
parent_under("door_rl", [skin_rl, card_rl], (-0.79, 0.78, 0.40))
parent_under("door_rr", [skin_rr, card_rr], (0.79, 0.78, 0.40))

bpy.context.view_layer.update()

# quick leftover check: any allowed-material faces still in door regions of body?
info = face_region_test(body)
for key, test in (("fr", front_door_test), ("rl", rear_door_test), ("rr", rear_door_test_r)):
    left = sum(1 for g, m in info.values() if test(g, m))
    print(f"[leftover {key}] {left} faces remain in body", flush=True)

bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', export_yup=True, export_apply=False,
    export_materials='EXPORT', export_image_format='AUTO', export_cameras=False, export_lights=False)
print("EXPORTED", DST, flush=True)
