import bpy, sys
from mathutils import Vector
CAR = sys.argv[1]
GLB = f"/home/user/Claude-shooter/public/models/{CAR}.glb"
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=GLB)
def gtf(v): return Vector((v.x, v.z, -v.y))

# X-ray of one side: door meshes vs body, projected on (z,y), outer band only
doors = [o for o in bpy.context.scene.objects if o.name.startswith("door_") and o.type == 'EMPTY']
side_sign = -1 if (doors and gtf(doors[0].matrix_world.translation).x < 0) else 1
print(f"side x sign: {side_sign}")
W, H = 76, 22
Z0, Z1 = -1.6, 1.6
Y0, Y1 = 0.1, 1.45
grid = [[" "]*W for _ in range(H)]
door_faces = []
for d in doors:
    for c in d.children_recursive:
        if c.type != 'MESH': continue
        for p in c.data.polygons:
            g = gtf(c.matrix_world @ p.center)
            door_faces.append(g)
for o in bpy.context.scene.objects:
    if o.type != 'MESH' or (o.parent and o.parent.name.startswith("door_")): continue
    for p in o.data.polygons:
        g = gtf(o.matrix_world @ p.center)
        if g.x * side_sign < 0.45: continue  # outer band on door side
        ci = int((g.z - Z0)/(Z1-Z0)*(W-1)); ri = int((g.y - Y0)/(Y1-Y0)*(H-1))
        if 0 <= ri < H and 0 <= ci < W:
            m = o.material_slots[p.material_index].material.name if o.material_slots else "?"
            ch = {"paint":"#","glass":"G","taillight":"L","headlight":"H","chrome":"c","trim":"t"}.get(m.split("__")[0], ".")
            if grid[ri][ci] == " " or ch in "#GH": grid[ri][ci] = ch
for g in door_faces:
    ci = int((g.z - Z0)/(Z1-Z0)*(W-1)); ri = int((g.y - Y0)/(Y1-Y0)*(H-1))
    if 0 <= ri < H and 0 <= ci < W:
        grid[ri][ci] = "D" if grid[ri][ci] == " " else "X"   # X = overlap door+body
print(f"{CAR} DOOR(X=door+body overlap, D=door only) side view (z {Z0}..{Z1} ->, y up):")
for r in range(H-1, -1, -1):
    print(f"y={Y0 + r/(H-1)*(Y1-Y0):4.2f} " + "".join(grid[r]))
