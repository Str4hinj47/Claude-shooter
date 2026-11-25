import { useEffect, useRef, useState } from "react";
import type { HudState } from "../game/Game";

interface WeaponWheelProps {
  open: boolean;
  weaponIndex: number;
  holstered: boolean;
  weapons: HudState["weapons"];
  onCommitWeapon: (idx: number) => void;
  onCommitHolster: () => void;
  onClose: () => void;
}

type WheelSlot =
  | { kind: "weapon"; index: number; angleDeg: number; label: string; sub: string; mag: number; reserve: number }
  | { kind: "holster"; index: number; angleDeg: number; label: string; sub: string };

function degToRad(d: number) {
  return (d * Math.PI) / 180;
}

function sectorPath(cx: number, cy: number, rIn: number, rOut: number, a0: number, a1: number): string {
  const x0o = cx + Math.cos(a0) * rOut;
  const y0o = cy + Math.sin(a0) * rOut;
  const x1o = cx + Math.cos(a1) * rOut;
  const y1o = cy + Math.sin(a1) * rOut;
  const x1i = cx + Math.cos(a1) * rIn;
  const y1i = cy + Math.sin(a1) * rIn;
  const x0i = cx + Math.cos(a0) * rIn;
  const y0i = cy + Math.sin(a0) * rIn;
  return `M ${x0o} ${y0o} A ${rOut} ${rOut} 0 0 1 ${x1o} ${y1o} L ${x1i} ${y1i} A ${rIn} ${rIn} 0 0 0 ${x0i} ${y0i} Z`;
}

export function WeaponWheel({
  open,
  weaponIndex,
  holstered,
  weapons,
  onCommitWeapon,
  onCommitHolster,
  onClose,
}: WeaponWheelProps) {
  const vecRef = useRef({ x: 0, y: 0, lastClientX: null as number | null, lastClientY: null as number | null });
  const activeSectorRef = useRef<number>(holstered ? 4 : weaponIndex);
  const [vecUi, setVecUi] = useState({ x: 0, y: 0 });
  const [hoveredSector, setHoveredSector] = useState<number>(holstered ? 4 : weaponIndex);
  const wasOpenRef = useRef(false);

  const slots: WheelSlot[] = [
    {
      kind: "weapon",
      index: 0,
      angleDeg: -90,
      label: weapons[0]?.shortName ?? "P226-SD",
      sub: weapons[0]?.category ?? "Pistol",
      mag: weapons[0]?.mag ?? 15,
      reserve: weapons[0]?.reserve ?? 90,
    },
    {
      kind: "weapon",
      index: 1,
      angleDeg: -30,
      label: weapons[1]?.shortName ?? "M4A1-S",
      sub: weapons[1]?.category ?? "Carbine",
      mag: weapons[1]?.mag ?? 30,
      reserve: weapons[1]?.reserve ?? 120,
    },
    {
      kind: "weapon",
      index: 2,
      angleDeg: 30,
      label: weapons[2]?.shortName ?? "MP-9 SD",
      sub: weapons[2]?.category ?? "SMG",
      mag: weapons[2]?.mag ?? 32,
      reserve: weapons[2]?.reserve ?? 160,
    },
    {
      kind: "weapon",
      index: 3,
      angleDeg: 90,
      label: weapons[3]?.shortName ?? "M870-S",
      sub: weapons[3]?.category ?? "Shotgun",
      mag: weapons[3]?.mag ?? 8,
      reserve: weapons[3]?.reserve ?? 40,
    },
    {
      kind: "weapon",
      index: 4,
      angleDeg: 150,
      label: weapons[4]?.shortName ?? "MK14-SD",
      sub: weapons[4]?.category ?? "DMR",
      mag: weapons[4]?.mag ?? 12,
      reserve: weapons[4]?.reserve ?? 60,
    },
    {
      kind: "holster",
      index: 5,
      angleDeg: 210,
      label: "HOLSTER",
      sub: "Hide Weapon · [H]",
    },
  ];

  const onCommitWeaponRef = useRef(onCommitWeapon);
  const onCommitHolsterRef = useRef(onCommitHolster);
  const onCloseRef = useRef(onClose);
  onCommitWeaponRef.current = onCommitWeapon;
  onCommitHolsterRef.current = onCommitHolster;
  onCloseRef.current = onClose;

  const initSlotRef = useRef(holstered ? 5 : weaponIndex);
  initSlotRef.current = holstered ? 5 : weaponIndex;

  // Commit selection when Tab releases (open transitions true -> false)
  useEffect(() => {
    if (open && !wasOpenRef.current) {
      const init = initSlotRef.current;
      activeSectorRef.current = init;
      setHoveredSector(init);
      vecRef.current = { x: 0, y: 0, lastClientX: null, lastClientY: null };
      setVecUi({ x: 0, y: 0 });
    } else if (!open && wasOpenRef.current) {
      const pick = activeSectorRef.current;
      if (pick === 5) onCommitHolsterRef.current();
      else onCommitWeaponRef.current(pick);
    }
    wasOpenRef.current = open;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const prevBodyCursor = document.body.style.cursor;
    document.body.style.cursor = "none";

    const onMove = (e: MouseEvent) => {
      const v = vecRef.current;
      let dx = e.movementX || 0;
      let dy = e.movementY || 0;
      if (dx === 0 && dy === 0 && v.lastClientX !== null && v.lastClientY !== null) {
        dx = e.clientX - v.lastClientX;
        dy = e.clientY - v.lastClientY;
      }
      v.lastClientX = e.clientX;
      v.lastClientY = e.clientY;

      v.x += dx;
      v.y += dy;
      const maxR = 110;
      const dist = Math.hypot(v.x, v.y);
      if (dist > maxR) {
        v.x = (v.x / dist) * maxR;
        v.y = (v.y / dist) * maxR;
      }
      setVecUi({ x: v.x, y: v.y });

      if (dist > 18) {
        const ang = (Math.atan2(v.y, v.x) * 180) / Math.PI;
        let bestIdx = 0;
        let bestDiff = 999;
        for (let i = 0; i < slots.length; i++) {
          let diff = Math.abs(((ang - slots[i].angleDeg + 540) % 360) - 180);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestIdx = i;
          }
        }
        activeSectorRef.current = bestIdx;
        setHoveredSector(bestIdx);
      }
    };

    const onDown = (e: MouseEvent) => {
      if (e.button === 0) {
        e.preventDefault();
        e.stopPropagation();
        onCloseRef.current();
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mousedown", onDown, true);
    return () => {
      document.body.style.cursor = prevBodyCursor;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mousedown", onDown, true);
    };
  }, [open]);

  if (!open) return null;

  const active = slots[hoveredSector] ?? slots[0];
  const CX = 240;
  const CY = 240;
  const R_IN = 82;
  const R_OUT = 212;
  const STEP = 60;

  return (
    <div
      className="fixed inset-0 z-50 flex cursor-none items-center justify-center bg-[#07080b]/45 backdrop-blur-[3px]"
      style={{ cursor: "none" }}
    >
      <div className="relative flex h-[480px] w-[480px] items-center justify-center select-none">
        <svg viewBox="0 0 480 480" className="h-full w-full overflow-visible drop-shadow-[0_20px_50px_rgba(0,0,0,0.85)]">
          {/* Outer guide ring */}
          <circle cx={CX} cy={CY} r={R_OUT + 10} fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="4 6" />

          {slots.map((slot, idx) => {
            const a0 = degToRad(slot.angleDeg - STEP / 2 + 2.4);
            const a1 = degToRad(slot.angleDeg + STEP / 2 - 2.4);
            const mid = degToRad(slot.angleDeg);
            const isHovered = hoveredSector === idx;
            const isEquipped = (slot.kind === "holster" && holstered) || (slot.kind === "weapon" && !holstered && weaponIndex === slot.index);
            const rLabel = (R_IN + R_OUT) * 0.54;
            const lx = CX + Math.cos(mid) * rLabel;
            const ly = CY + Math.sin(mid) * rLabel;

            return (
              <g key={slot.label}>
                <path
                  d={sectorPath(CX, CY, R_IN, isHovered ? R_OUT + 8 : R_OUT, a0, a1)}
                  fill={
                    isHovered
                      ? slot.kind === "holster"
                        ? "rgba(56, 189, 248, 0.28)"
                        : "rgba(255, 59, 48, 0.26)"
                      : isEquipped
                        ? "rgba(229, 169, 60, 0.14)"
                        : "rgba(11, 13, 19, 0.88)"
                  }
                  stroke={
                    isHovered
                      ? slot.kind === "holster"
                        ? "#38bdf8"
                        : "#ff3b30"
                      : isEquipped
                        ? "#e5a93c"
                        : "rgba(242, 239, 233, 0.18)"
                  }
                  strokeWidth={isHovered ? 2 : 1.1}
                />
                <text
                  x={lx}
                  y={ly - 10}
                  textAnchor="middle"
                  fill={isHovered ? "#ffffff" : "#8a909e"}
                  fontSize="10"
                  fontFamily="ui-monospace, monospace"
                  fontWeight="700"
                  letterSpacing="2"
                >
                  {slot.kind === "holster" ? "STOW" : `0${slot.index + 1}`}
                </text>
                <text
                  x={lx}
                  y={ly + 8}
                  textAnchor="middle"
                  fill="#f2efe9"
                  fontSize="16"
                  fontWeight="800"
                  letterSpacing="1"
                >
                  {slot.label}
                </text>
                <text
                  x={lx}
                  y={ly + 25}
                  textAnchor="middle"
                  fill={isHovered ? "#38bdf8" : "#8a909e"}
                  fontSize="10"
                  fontFamily="ui-monospace, monospace"
                >
                  {slot.kind === "weapon" ? `${slot.mag} / ${slot.reserve}` : "UNARMED"}
                </text>
              </g>
            );
          })}

          {/* Inner hub + relative directional vector indicator */}
          <circle cx={CX} cy={CY} r={R_IN - 8} fill="rgba(8, 10, 15, 0.94)" stroke="rgba(255,255,255,0.22)" strokeWidth="1.5" />
          <line
            x1={CX}
            y1={CY}
            x2={CX + vecUi.x * 0.52}
            y2={CY + vecUi.y * 0.52}
            stroke={active.kind === "holster" ? "#38bdf8" : "#ff3b30"}
            strokeWidth="2"
            opacity="0.85"
          />
          <circle
            cx={CX + vecUi.x * 0.52}
            cy={CY + vecUi.y * 0.52}
            r="4.5"
            fill={active.kind === "holster" ? "#38bdf8" : "#ff3b30"}
          />
        </svg>

        {/* Center Hub Readout */}
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <div className="font-mono text-[9px] font-bold uppercase tracking-[0.26em] text-[#8a909e]">
            {active.kind === "holster" ? "WEAPON STANCE" : "ARMORY SLOT"}
          </div>
          <div className="mt-0.5 font-display text-xl font-extrabold uppercase tracking-wider text-[#f2efe9]">
            {active.label}
          </div>
          <div className="font-mono text-[9px] uppercase tracking-wider text-[#38bdf8]">
            {active.sub}
          </div>
          <div className="mt-2 font-mono text-[8px] uppercase tracking-[0.22em] text-[#64748b]">
            RELEASE [TAB]
          </div>
        </div>
      </div>
    </div>
  );
}
