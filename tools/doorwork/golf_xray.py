import bpy
from mathutils import Vector
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="/home/user/Claude-shooter/public/models/golf.glb")
def gtf(v): return Vector((v.x, v.z, -v.y))
body = bpy.data.objects["golf_car"]
me = body.data
# grid over (z, y) for LEFT side outer shell; classify by material
# z 0.0..1.7, y 0.2..1.5
W, H = 85, 26
grid = [[0]*W for _ in range(H)]
mat_grid = [[" "]*W for _ in range(H)]
def cell(z, y):
    ci = int((z - 0.0) / 1.7 * (W-1))
    ri = int((y - 0.2) / 1.3 * (H-1))
    return ri, ci
for p in me.polygons:
    m = body.material_slots[p.material_index].material.name
    c = gtf(body.matrix_world @ p.center)
    if c.x > -0.6: continue  # left outer shell only
    if not (0.0 <= c.z <= 1.7 and 0.2 <= c.y <= 1.5): continue
    r, ci = cell(c.z, c.y)
    if 0 <= r < H and 0 <= ci < W:
        grid[r][ci] += 1
        ch = {"paint__Carpaint":"#", "glass__Windows-glass":"G", "trim__Black-plastic":"t", "taillight__Rear-lights":"L", "plate__Plates":"P"}.get(m, ".")
        if mat_grid[r][ci] == " " or ch == "G":
            mat_grid[r][ci] = ch
print("LEFT SIDE (z -> 0..1.7 horizontal, y 0.2 bottom .. 1.5 top)  #=paint G=glass t=trim L=taillight")
for r in range(H-1, -1, -1):
    print(f"y={0.2 + r/ (H-1) * 1.3:4.2f} " + "".join(mat_grid[r]))
print("z-axis: 0.00 " + " " * 0 + "".join(f"{i/ (W-1) * 1.7:4.1f}" if i % 5 == 0 else "    " for i in range(W)))
