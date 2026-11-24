"""Render ONE door in isolation, closed vs open, side view. Usage: render_door.py <car> <doorname> <outdir>"""
import bpy, math, sys
from mathutils import Vector, Euler, Matrix
CAR, DOOR, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
GLB = f"/home/user/Claude-shooter/public/models/{CAR}.glb"
ORIENTATION = {"golf": 0.0, "mercedes": 0.0, "audi": math.pi, "mustang": 0.0,
               "ferrari": math.pi, "r8": math.pi, "challenger": math.pi,
               "rangerover": math.pi, "semi": 0.0, "kraz": 0.0}
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
holder = bpy.data.objects.new("holder", None)
bpy.context.scene.collection.objects.link(holder)
holder.matrix_world = Matrix.Rotation(math.radians(-90), 4, 'X')
bpy.context.view_layer.update()
for o in [o for o in bpy.context.scene.objects if o.parent is None and o.name != "holder"]:
    o.parent = holder; o.matrix_parent_inverse = Matrix.Identity(4)
bpy.context.view_layer.update()
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
center = (mn + mx) * 0.5
holder.matrix_world = Matrix.Translation(Vector((-center.x, -mn.y, -center.z))) @ Matrix.Rotation(ORIENTATION.get(CAR, 0.0), 4, 'Y') @ holder.matrix_world
bpy.context.view_layer.update()

door = bpy.data.objects[DOOR]
side = 1 if door.matrix_world.translation.x > 0 else -1
camx = side * 3.2  # camera on the door's side (side=-1 left, +1 right)
# hide everything except this door
for o in bpy.context.scene.objects:
    if o.type == 'MESH': o.hide_render = True
for c in door.children_recursive:
    if c.type == 'MESH': c.hide_render = False

scene = bpy.context.scene
scene.render.engine = 'CYCLES'; scene.cycles.samples = 16
scene.render.resolution_x = 500; scene.render.resolution_y = 400
scene.render.image_settings.file_format = 'PNG'
scene.view_settings.view_transform = 'Standard'
world = bpy.data.worlds.new("W"); world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.05, 0.05, 0.07, 1)
scene.world = world
sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", 'SUN'))
sun.data.energy = 3.0; sun.rotation_euler = Euler((math.radians(50), 0, math.radians(25)), 'XYZ')
scene.collection.objects.link(sun)
cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
scene.collection.objects.link(cam); scene.camera = cam
cam.data.type = 'ORTHO'; cam.data.ortho_scale = 2.6
cam.location = Vector((camx, 1.2, door.matrix_world.translation.z))
tgt = Vector((door.matrix_world.translation.x*0.3, 0.45, door.matrix_world.translation.z))
d = tgt - cam.location
cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()

base = door.matrix_world.copy()
piv = base.translation
for suffix, ang in (("closed", 0.0), ("open", 62.0)):
    R = Matrix.Translation(piv) @ Matrix.Rotation(math.radians(side * ang), 4, 'Y') @ Matrix.Translation(-piv)
    door.matrix_world = R @ base
    bpy.context.view_layer.update()
    scene.render.filepath = f"{OUT}/{CAR}_{DOOR}_{suffix}.png"
    bpy.ops.render.render(write_still=True)
print("DONE", DOOR)
