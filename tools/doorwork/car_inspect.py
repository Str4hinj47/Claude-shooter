import bpy, json, math, sys, os
from mathutils import Vector, Euler, Matrix

CAR = sys.argv[1]
OUT = sys.argv[2]
ANGLES = [float(a) for a in sys.argv[3].split(",")] if len(sys.argv) > 3 else [0.0, 62.0]
GLB = f"/home/user/Claude-shooter/public/models/{CAR}.glb"

ORIENTATION = {"golf": 0.0, "mercedes": 0.0, "audi": math.pi, "mustang": 0.0,
               "ferrari": math.pi, "r8": math.pi, "challenger": math.pi,
               "rangerover": math.pi, "semi": 0.0, "kraz": 0.0}

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)

# Importer bakes glTF (x,y,z)->Blender (x,-z,y)  == Rx(90) into object transforms.
# Build holder so Blender world == game wrapper space (glTF Y-up, front=-Z, centered, grounded).
holder = bpy.data.objects.new("holder", None)
bpy.context.scene.collection.objects.link(holder)
holder.matrix_world = Matrix.Rotation(math.radians(-90), 4, 'X')  # undo importer bake
bpy.context.view_layer.update()
roots = [o for o in bpy.context.scene.objects if o.parent is None and o.name != "holder"]
for o in roots:
    o.parent = holder
    o.matrix_parent_inverse = Matrix.Identity(4)
bpy.context.view_layer.update()

# apply game ORIENTATION (scene.rotation.y) then ground+center (x/z centered, min y -> 0)
bpy.context.view_layer.update()
all_meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']

def world_bbox(objs):
    pts = []
    for o in objs:
        if o.type != 'MESH': continue
        for corner in o.bound_box:
            pts.append(o.matrix_world @ Vector(corner))
    if not pts: return None, None
    return (Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
            Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))))

mn, mx = world_bbox(all_meshes)
center = (mn + mx) * 0.5
orient = ORIENTATION.get(CAR, 0.0)
M = Matrix.Translation(Vector((-center.x, -mn.y, -center.z))) @ Matrix.Rotation(orient, 4, 'Y')
holder.matrix_world = M @ holder.matrix_world
bpy.context.view_layer.update()
mn, mx = world_bbox(all_meshes)

info = {"car": CAR, "bbox_min": [round(c,3) for c in mn], "bbox_max": [round(c,3) for c in mx], "doors": {}}

door_objs = [o for o in bpy.context.scene.objects if o.name.startswith("door_") and o.type == 'EMPTY']
door_base = {}
for d in sorted(door_objs, key=lambda x: x.name):
    door_base[d.name] = d.matrix_world.copy()
    meshes = [c for c in d.children_recursive if c.type == 'MESH']
    dmn, dmx = world_bbox(meshes)
    piv = d.matrix_world.translation
    arm_z = ((dmn+dmx)*0.5).z - piv.z if dmn else 0
    info["doors"][d.name] = {
        "pivot": [round(c, 3) for c in piv],
        "mesh_bbox_min": [round(c, 3) for c in dmn] if dmn else None,
        "mesh_bbox_max": [round(c, 3) for c in dmx] if dmx else None,
        "armZ": round(arm_z, 3),
        "n_meshes": len(meshes),
    }
print(json.dumps(info, indent=1), flush=True)

# --- lights ---
if not bpy.data.worlds:
    bpy.data.worlds.new("World")
world = bpy.data.worlds[0]
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.04, 0.04, 0.06, 1)
bpy.context.scene.world = world
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", 'SUN'))
sun.data.energy = 3.0
sun.rotation_euler = Euler((math.radians(50), 0, math.radians(25)), 'XYZ')
bpy.context.scene.collection.objects.link(sun)
fill = bpy.data.objects.new("fill", bpy.data.lights.new("fill", 'AREA'))
fill.data.energy = 300; fill.data.size = 14
fill.location = (0, 8, 9); fill.rotation_euler = Euler((math.radians(115), 0, 0), 'XYZ')
bpy.context.scene.collection.objects.link(fill)

scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.render.resolution_x = 780
scene.render.resolution_y = 500
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'Standard'

cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
bpy.context.scene.collection.objects.link(cam)
scene.camera = cam
cam.data.type = 'ORTHO'
car_len = mx.z - mn.z
car_w = mx.x - mn.x
car_h = mx.y - mn.y

views = {
    "left":   (Vector((-car_w*1.8 - 1.5, car_h*0.75, 0)), Vector((0, car_h*0.45, 0))),
    "right":  (Vector(( car_w*1.8 + 1.5, car_h*0.75, 0)), Vector((0, car_h*0.45, 0))),
    "top":    (Vector((0, car_len*2.0 + 2.5, 0.02)), Vector((0, 0, 0))),
    "fl34":   (Vector((-car_w*2.6, car_h*0.9, -car_len*0.9)), Vector((0, car_h*0.3, 0))),
    "fr34":   (Vector(( car_w*2.6, car_h*0.9, -car_len*0.9)), Vector((0, car_h*0.3, 0))),
}

def look_at(obj, target):
    d = target - obj.location
    obj.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

def render_all(suffix):
    for vname, (pos, tgt) in views.items():
        cam.location = pos
        look_at(cam, tgt)
        cam.data.ortho_scale = (car_len * 1.18) if vname != "top" else (car_w * 2.35)
        scene.render.filepath = f"{OUT}/{CAR}_{suffix}_{vname}.png"
        bpy.ops.render.render(write_still=True)

for angle in ANGLES:
    for d in door_objs:
        base = door_base[d.name]
        piv = base.translation
        side = 1 if piv.x > 0 else -1
        R = Matrix.Translation(piv) @ Matrix.Rotation(math.radians(side * angle), 4, 'Y') @ Matrix.Translation(-piv)
        d.matrix_world = R @ base
    bpy.context.view_layer.update()
    render_all(f"a{int(angle)}")
print("RENDERED", CAR, flush=True)
