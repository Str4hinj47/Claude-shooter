#!/usr/bin/env python3
"""Merge a Rocketbox character GLB with locomotion clips from an anims GLB.

- Renames Bip01 bones to Mixamo names (mixamorig:*) so SoldierRig works.
- Copies only Idle/Walk/Run animations (channels remapped by bone name).
- Sets the root transform (Z-up cm -> Y-up m) like the original soldier.

Usage: python3 scripts/merge-rocketbox.py <character.glb> <anims.glb> <out.glb>
"""
import json, struct, copy, sys

CHAR, ANIMS, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
KEEP = {'idle': 'Idle', 'walk': 'Walk', 'run': 'Run'}

def read_glb(path):
    with open(path, 'rb') as f:
        data = f.read()
    magic, ver, length = struct.unpack('<III', data[:12])
    assert magic == 0x46546C67, 'not glb'
    off = 12
    jlen, jtype = struct.unpack('<II', data[off:off+8]); off += 8
    js = json.loads(data[off:off+jlen]); off += jlen
    bin_data = b''
    if off < len(data):
        blen, btype = struct.unpack('<II', data[off:off+8]); off += 8
        bin_data = data[off:off+blen]
    return js, bin_data

def write_glb(path, js, bin_data):
    j = json.dumps(js, separators=(',', ':')).encode()
    j += b' ' * ((4 - len(j) % 4) % 4)
    b = bin_data + b'\x00' * ((4 - len(bin_data) % 4) % 4)
    total = 12 + 8 + len(j) + 8 + len(b)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, total))
        f.write(struct.pack('<II', len(j), 0x4E4F534A)); f.write(j)
        f.write(struct.pack('<II', len(b), 0x004E4942)); f.write(b)

def bip_to_mix(name):
    if not name or not name.startswith('Bip01') or 'Nub' in name:
        return name
    rest = name[5:]
    for side, pre in (('_L_', 'Left'), ('_R_', 'Right')):
        if rest.startswith(side + 'Finger'):
            f = rest[len(side + 'Finger'):]
            fmap = {'0': 'Thumb', '1': 'Index', '2': 'Middle', '3': 'Ring', '4': 'Pinky'}
            if f and f[0] in fmap and (f[1:] == '' or f[1:].isdigit()):
                seg = f[1:]
                segnum = '' if seg == '' else str(int(seg))
                return 'mixamorig:' + f'{pre}Hand{fmap[f[0]]}{segnum}'
    simple = {
        '_Pelvis': 'Hips', '_Spine': 'Spine', '_Spine1': 'Spine1', '_Spine2': 'Spine2',
        '_Neck': 'Neck', '_Head': 'Head',
        '_L_Clavicle': 'LeftShoulder', '_R_Clavicle': 'RightShoulder',
        '_L_UpperArm': 'LeftArm', '_R_UpperArm': 'RightArm',
        '_L_Forearm': 'LeftForeArm', '_R_Forearm': 'RightForeArm',
        '_L_Hand': 'LeftHand', '_R_Hand': 'RightHand',
        '_L_Thigh': 'LeftUpLeg', '_R_Thigh': 'RightUpLeg',
        '_L_Calf': 'LeftLeg', '_R_Calf': 'RightLeg',
        '_L_Foot': 'LeftFoot', '_R_Foot': 'RightFoot',
        '_L_Toe0': 'LeftToeBase', '_R_Toe0': 'RightToeBase',
    }
    return 'mixamorig:' + simple[rest] if rest in simple else name

char, char_bin = read_glb(CHAR)
anims, anims_bin = read_glb(ANIMS)

for js in (char, anims):
    for n in js['nodes']:
        if 'name' in n:
            n['name'] = bip_to_mix(n['name'])

name2idx = {}
for i, n in enumerate(char['nodes']):
    if 'name' in n and n['name'] not in name2idx:
        name2idx[n['name']] = i

required = ['mixamorig:Hips','mixamorig:Spine','mixamorig:Spine1','mixamorig:Spine2','mixamorig:Neck','mixamorig:Head',
            'mixamorig:LeftArm','mixamorig:LeftForeArm','mixamorig:LeftHand','mixamorig:RightArm','mixamorig:RightForeArm','mixamorig:RightHand',
            'mixamorig:LeftUpLeg','mixamorig:LeftLeg','mixamorig:LeftFoot','mixamorig:RightUpLeg','mixamorig:RightLeg','mixamorig:RightFoot']
missing = [r for r in required if r not in name2idx]
if missing:
    print(f"ERROR: missing bones {missing} in {CHAR}"); sys.exit(1)

kept = [a for a in anims.get('animations', []) if a.get('name','').lower() in KEEP]
if len(kept) != 3:
    print(f"ERROR: expected 3 anims, found {[a.get('name') for a in kept]}"); sys.exit(1)
ref_acc = set()
for a in kept:
    for s in a['samplers']:
        ref_acc.add(s['input']); ref_acc.add(s['output'])
ref_bv = set()
for ai in ref_acc:
    bv = anims['accessors'][ai].get('bufferView')
    if bv is not None:
        ref_bv.add(bv)

pad = (4 - len(char_bin) % 4) % 4
merged_bin = char_bin + b'\x00' * pad
bv_map = {}
for old in sorted(ref_bv):
    bv = anims['bufferViews'][old]
    start = bv.get('byteOffset', 0)
    nb = copy.deepcopy(bv)
    nb['byteOffset'] = len(merged_bin)
    bv_map[old] = len(char['bufferViews'])
    char['bufferViews'].append(nb)
    merged_bin += anims_bin[start:start+bv['byteLength']]
    merged_bin += b'\x00' * ((4 - len(merged_bin) % 4) % 4)
acc_map = {}
for old in sorted(ref_acc):
    na = copy.deepcopy(anims['accessors'][old])
    if 'bufferView' in na:
        na['bufferView'] = bv_map[na['bufferView']]
    acc_map[old] = len(char['accessors'])
    char['accessors'].append(na)
char['buffers'][0]['byteLength'] = len(merged_bin)

new_anims = []
for a in kept:
    na = copy.deepcopy(a)
    na['name'] = KEEP[a['name'].lower()]
    for s in na['samplers']:
        s['input'] = acc_map[s['input']]
        s['output'] = acc_map[s['output']]
    kept_ch = []
    for ch in na['channels']:
        node_name = anims['nodes'][ch['target']['node']].get('name')
        if node_name not in name2idx:
            continue
        ch['target']['node'] = name2idx[node_name]
        kept_ch.append(ch)
    na['channels'] = kept_ch
    new_anims.append(na)
char['animations'] = new_anims

root = char['nodes'][0]
root['rotation'] = [-0.7071067690849304, 0, 0, 0.7071067690849304]
root['scale'] = [0.01, 0.01, 0.01]

# Rocketbox GLBs from game-forge have textures exported right-side-up (flipY=false)
# while TEXCOORD_0 retains bottom-up OpenGL V coordinates. Flip V -> 1 - V so
# standard glTF loaders render face, suit, boots, and hands accurately.
merged_ba = bytearray(merged_bin)
uv_accs = set()
for m in char.get('meshes', []):
    for p in m.get('primitives', []):
        if 'TEXCOORD_0' in p.get('attributes', {}):
            uv_accs.add(p['attributes']['TEXCOORD_0'])
for ai in sorted(uv_accs):
    acc = char['accessors'][ai]
    if acc.get('componentType') != 5126 or acc.get('type') != 'VEC2':
        continue
    bv = char['bufferViews'][acc['bufferView']]
    stride = bv.get('byteStride', 8)
    base = bv.get('byteOffset', 0) + acc.get('byteOffset', 0)
    for i in range(acc['count']):
        pos = base + i * stride + 4
        v, = struct.unpack_from('<f', merged_ba, pos)
        struct.pack_into('<f', merged_ba, pos, 1.0 - v)
    if 'min' in acc and 'max' in acc and len(acc['min']) >= 2 and len(acc['max']) >= 2:
        mn, mx = acc['min'][1], acc['max'][1]
        acc['min'][1], acc['max'][1] = 1.0 - mx, 1.0 - mn
merged_bin = bytes(merged_ba)

write_glb(OUT, char, merged_bin)
print(f"wrote {OUT} ({len(merged_bin)} bin bytes, anims: {[a['name'] for a in new_anims]})")
