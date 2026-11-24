import bpy
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath="/home/user/Claude-shooter/public/models/golf.glb")
bpy.ops.export_scene.gltf(filepath="/tmp/golf_roundtrip.glb",
    export_format='GLB', export_yup=True, export_apply=False,
    export_materials='EXPORT', export_keep_originals=True, export_image_format='AUTO',
    export_cameras=False, export_lights=False)
print("EXPORTED")
