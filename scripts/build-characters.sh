#!/usr/bin/env bash
# Build all selectable characters from game-forge Rocketbox GLBs.
# Pipeline per character: merge (bone rename + Idle/Walk/Run) -> optimize
# (gltf-transform) -> fix-facing (180-degree wrapper). Output goes to
# public/characters/<id>.glb (+ preview PNG for the menu).
# Usage: ./scripts/build-characters.sh [game-forge-checkout-dir]
set -euo pipefail
GF="${1:-/tmp/game-forge}"
RB="$GF/assets/models/rocketbox"
OUT="public/characters"
mkdir -p "$OUT/previews"

# id | source glb | anims glb | preview png | display name
CHARACTERS=(
  "military|military-male-01.glb|anims-male.glb|military-male-01.png|Military"
  "civilian|male-adult-07.glb|anims-male.glb|male-adult-07.png|Civilian"
  "police|police-male-01.glb|anims-male.glb|police-male-01.png|Police"
  "security|security-male-01.glb|anims-male.glb|security-male-01.png|Security"
  "construction|construction-male-01.glb|anims-male.glb|construction-male-01.png|Construction"
  "firefighter|fire-male-01.glb|anims-male.glb|fire-male-01.png|Firefighter"
  "business|business-male-01.glb|anims-male.glb|business-male-01.png|Business"
  "sports|sports-male-01.glb|anims-male.glb|sports-male-01.png|Sports"
  "delivery|delivery-male-01.glb|anims-male.glb|delivery-male-01.png|Delivery"
)

for entry in "${CHARACTERS[@]}"; do
  IFS='|' read -r id src anims preview name <<< "$entry"
  echo "==> $name ($id)"
  python3 scripts/merge-rocketbox.py "$RB/$src" "$RB/$anims" "/tmp/char-merged.glb"
  npx -y @gltf-transform/cli optimize /tmp/char-merged.glb /tmp/char-opt.glb \
    --texture-size 2048 --weld true --prune true --compress quantize \
    --simplify false --palette false --texture-compress auto >/dev/null 2>&1
  python3 scripts/fix-facing.py /tmp/char-opt.glb "$OUT/$id.glb"
  cp "$RB/_preview/$preview" "$OUT/previews/$id.png"
  ls -lh "$OUT/$id.glb" | awk '{print "    ", $9, $5}'
done
echo "Done. Characters in $OUT/"
