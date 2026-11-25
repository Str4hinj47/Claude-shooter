# Asset attribution

## public/characters/*.glb — Microsoft Rocketbox characters (MIT)

Character meshes, skeletons and textures: Microsoft Rocketbox library
(https://github.com/microsoft/Microsoft-Rocketbox), converted to GLB by
npmiaman/game-forge (https://github.com/npmiaman/game-forge,
`assets/models/rocketbox/`). Animation clips (Idle/Walk/Run) merged from
`anims-male.glb` / `anims-female.glb` in the same folder. Bip01 bones renamed
to Mixamo names, meshes optimized with glTF-Transform. Rebuild with
`scripts/build-characters.sh` (see `scripts/merge-rocketbox.py` and
`scripts/fix-facing.py`).

MIT License — Copyright (c) 2020 Microsoft. The full license text is in
`assets/models/rocketbox/LICENSE.md` of the game-forge repo; the copyright
and permission notices are included here per the license terms.

## Aircraft, Watercraft & Pickup GLBs (`public/models/`)

- `heli.glb`: `swift502/Sketchbook` (`build/assets/heli.glb`), MIT License.
- `plane.glb`, `jet.glb`: `daranjacquet/open-road` (`public/models/{plane,jet}.glb`), MIT License.
- `airliner_737.glb` (`models/B737_nologo.glb`): `amvlab/aircraft-models`, CC-BY-4.0 (Copyright 2026 amvlab).
- `bird.glb` (`examples/models/gltf/Stork.glb`): `mrdoob/three.js`, MIT License.
- `speedboat.glb` ("ZEFIRO" by angelo raffaele catalano) & `cruiser_boat.glb` ("Assault Boat" by tnnv): sourced via `bob6664569/open-water`, CC-BY-4.0.
- `fuel_tank.glb` (`PropaneTank.glb`), `medkit.glb` (`FirstAidKit_Hard.glb`), `stash_bag.glb` (`Gold_Ingots.glb`): Quaternius packs via `trebeljahr/quaternius-showcase`, CC0 1.0 Universal.

## Everyday NPC Traffic GLBs (`public/models/`)

- `sedan.glb` ("Thunderbolt '96 - Low Poly Model" by Daniel Zhabotinsky) & `offroad.glb` ("Bokaroo '67 - Low poly model" by Daniel Zhabotinsky): reworked models via `daranjacquet/open-road` (`public/models/{sedan,offroad}.glb`), CC-BY-4.0.
- `compact.glb` (`q-cars-normalcar1.glb`), `hatch.glb` (`q-cars-normalcar2.glb`), `crossover.glb` (`q-cars-suv.glb`), `taxi.glb` (`q-cars-taxi.glb`), `police_cruiser.glb` (`q-cars-cop.glb`): Quaternius Vehicle Pack via `Touhid-HZ/shooter-asset-library`, CC0 1.0 Universal.
- `van.glb`, `delivery.glb`, `garbage_truck.glb`, `ambulance.glb`, `firetruck.glb`, `loader_tractor.glb`, `traffic_cone.glb`: Kenney Car Kit (`Arslan12216775/kenney_car-kit`, with embedded `Textures/colormap.png`), CC0 1.0 Universal.

## City Props, Trees, Landmarks, Wildlife & Interiors (`public/models/`)

- `cruise_ship.glb` (`CruiseShip.glb`), `pos_terminal.glb` (`Computer.glb`), `store_shelf.glb` (`Shelf_Large.glb`), `gas_can.glb` (`GasCan.glb`), `rooftop_ac.glb` (`AC_Stacked.glb`), `antenna.glb` (`Antenna_1.glb`), `trash_bin.glb` (`Trashcan_Green.glb`), `tree_palm.glb` (`PalmTree_1.glb`), `tree_oak.glb` (`CommonTree_1.glb`), `tree_pine.glb` (`PineTree_1.glb`), `bush.glb` (`Bush_1.glb`), `rock.glb` (`Rock_1.glb`), `sign_stop.glb` (`Sign_Stop.glb`), `trashcan_metal.glb` (`Trashcan.glb`), `park_bench.glb` (`Bench_1.glb`), `dumpster_bin.glb` (`Trashcan_Large.glb`), `dog_husky.glb` (`Husky.glb`), `deer.glb` (`Deer.glb`), `int_bed.glb` (`Bed_King.glb`), `int_couch_l.glb` (`Couch_L.glb`), `int_chair.glb` (`Chair_1.glb`), `int_table.glb` (`Table_RoundLarge.glb`), `int_cabinet.glb` (`Kitchen_Cabinet1.glb`), `int_fridge.glb` (`Kitchen_Fridge.glb`), `int_oven.glb` (`Kitchen_Oven.glb`), `int_sink.glb` (`Kitchen_Sink.glb`), `int_nightstand.glb` (`NightStand_1.glb`), `int_lamp.glb` (`Light_Floor1.glb`), `int_bookshelf.glb` (`Bookshelf.glb`), `int_plant.glb` (`Houseplant_1.glb`), `int_tv.glb` (`TV_1.glb`): Quaternius packs via `trebeljahr/quaternius-showcase` (MIT License / CC0 1.0 Universal).

## Open-Source Houses & Residential Buildings (`public/models/houses/`)

- `kenney-suburban/` (40 GLBs: `building-type-a.glb`..`u.glb` plus fences, driveways, paths & planters): Kenney City Kit (Suburban) 2.0 via `binhozer09/MAPA-NOVO` (`buildings/kenney-city-kit-suburban`), with `Textures/colormap.png` embedded into each GLB, CC0 1.0 Universal.
- `kenney-modular/` (108 GLBs: `building-sample-house-a..c.glb`, `building-sample-tower-a..d.glb` & modular architectural walls/windows/doors/roofs): Kenney Modular Buildings 2.1 via `binhozer09/MAPA-NOVO` (`buildings/kenney-modular-buildings`), with `Textures/colormap.png` embedded into each GLB, CC0 1.0 Universal.
- `quaternius-buildings-2/` (9 GLBs: `House1.glb`, `House2.glb`, `Building1_Large.glb`..`Building4.glb`): Quaternius Buildings Pack 2 via `trebeljahr/quaternius-showcase` (`public/glb/buildings_pack_2`), CC0 1.0 Universal / MIT License.
- `quaternius-buildings-3/` (26 GLBs: `1Story_*.glb`, `2Story_*.glb`, `3Story_*.glb`, `4Story_*.glb`, `6Story_Stack_Mat.glb`): Quaternius Buildings Pack 3 via `trebeljahr/quaternius-showcase` (`public/glb/buildings_pack_3`), CC0 1.0 Universal / MIT License.
- `quaternius-medieval/` (10 GLBs: `House_1.glb`..`House_4.glb`, `Inn.glb`, `Mill.glb`, `Sawmill.glb`, `Stable.glb`, `Blacksmith.glb`, `Bell_Tower.glb`): Quaternius Medieval Village Pack via `trebeljahr/quaternius-showcase` (`public/glb/medieval_village_pack`), CC0 1.0 Universal / MIT License.



