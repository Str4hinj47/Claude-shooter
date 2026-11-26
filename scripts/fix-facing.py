#!/usr/bin/env python3
"""Add a 180-degree Y wrapper node so a +Z-facing model matches the rig's
-Z-facing convention (SoldierRig.setup applies model.rotation.y = PI).
Usage: python3 scripts/fix-facing.py <input.glb> <output.glb>
Run AFTER gltf-transform optimize (which flattens the scene graph)."""
import json, struct, sys

inp, outp = sys.argv[1], sys.argv[2]
with open(inp, 'rb') as f:
    data = f.read()
struct.unpack('<III', data[:12])
clen, ct = struct.unpack('<II', data[12:20])
js = json.loads(data[20:20+clen])
off = 20 + clen
blen, bt = struct.unpack('<II', data[off:off+8])
bin_data = data[off+8:off+8+blen]
roots = js['scenes'][0]['nodes']
js['nodes'].append({"name": "Character", "rotation": [0, 1, 0, 0], "children": roots})
js['scenes'][0]['nodes'] = [len(js['nodes']) - 1]
j = json.dumps(js, separators=(',', ':')).encode()
j += b' ' * ((4 - len(j) % 4) % 4)
b = bin_data + b'\x00' * ((4 - len(bin_data) % 4) % 4)
total = 12 + 8 + len(j) + 8 + len(b)
with open(outp, 'wb') as f:
    f.write(struct.pack('<III', 0x46546C67, 2, total))
    f.write(struct.pack('<II', len(j), 0x4E4F534A)); f.write(j)
    f.write(struct.pack('<II', len(b), 0x004E4942)); f.write(b)
print(f"wrote {outp}")
