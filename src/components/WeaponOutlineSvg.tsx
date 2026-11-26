import React from "react";
import { WEAPONS, type WeaponId } from "../character/rifle";

interface WeaponOutlineSvgProps {
  weaponIndex: number;
  holstered?: boolean;
  suppressed?: boolean;
}

/**
 * Clean 2D tactical outline silhouette of the currently equipped weapon
 * displayed in the bottom-right HUD above the weapon name & ammo readout.
 */
export const WeaponOutlineSvg: React.FC<WeaponOutlineSvgProps> = ({
  weaponIndex,
  holstered = false,
  suppressed = true,
}) => {
  const spec = WEAPONS[weaponIndex] ?? WEAPONS[0];
  const weaponId: WeaponId = spec?.id ?? "pistol";

  const strokeMain = holstered ? "#7a8499" : "#f2efe9";
  const strokeDetail = holstered ? "#525b6e" : "#cfd4de";
  const strokeAccent = holstered ? "#38bdf8" : suppressed ? "#2dd4bf" : "#e5a93c";
  const fillTint = holstered ? "rgba(56,189,248,0.06)" : "rgba(242,239,233,0.08)";

  return (
    <div
      className={`flex items-center justify-end transition-opacity duration-150 ${
        holstered ? "opacity-55" : "opacity-100"
      }`}
      aria-label={holstered ? `${spec?.name ?? "Weapon"} (Holstered)` : spec?.name ?? "Equipped Weapon"}
    >
      <svg
        viewBox="0 0 220 68"
        className="h-12 w-44 drop-shadow-[0_2px_8px_rgba(0,0,0,0.9)]"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {weaponId === "pistol" && (
          <g strokeLinecap="round" strokeLinejoin="round">
            {/* Slide + upper frame (Apex P226-SD) */}
            <path
              d="M72 22 H134 V31 H97 L92 38 H84 L79 56 H64 L69 36 L65 30 Z"
              fill={fillTint}
              stroke={strokeMain}
              strokeWidth="1.9"
            />
            {/* Suppressor */}
            {suppressed ? (
              <rect
                x="136"
                y="22"
                width="34"
                height="7.5"
                rx="1.5"
                fill={fillTint}
                stroke={strokeAccent}
                strokeWidth="1.7"
              />
            ) : (
              <rect x="134" y="23.5" width="7" height="4.5" stroke={strokeMain} strokeWidth="1.6" />
            )}
            {/* Front & rear iron sights + reflex dot */}
            <path d="M75 22 V19 H79 V22 M127 22 V19.5 H130 V22" stroke={strokeDetail} strokeWidth="1.5" />
            {/* Slide serrations */}
            <path d="M77 24.5 V29 M80 24.5 V29 M83 24.5 V29" stroke={strokeDetail} strokeWidth="1.2" />
            {/* Trigger guard & trigger */}
            <path d="M90 31 H103 C104 37 100 39 91 39" stroke={strokeMain} strokeWidth="1.6" />
            <path d="M95 31.5 C94 34 95 36 96.5 36.5" stroke={strokeDetail} strokeWidth="1.3" />
            {/* Underbarrel tactical light */}
            <rect x="111" y="31" width="18" height="5.5" rx="1" stroke={strokeDetail} strokeWidth="1.4" />
            {/* Grip texture & mag baseplate */}
            <path d="M62 56 H81 L80 59 H61 Z" stroke={strokeDetail} strokeWidth="1.4" />
          </g>
        )}

        {weaponId === "carbine" && (
          <g strokeLinecap="round" strokeLinejoin="round">
            {/* Stock + buffer tube (Vanguard M4A1-S) */}
            <path
              d="M14 25 L36 22 H54 V31 H36 L22 44 H14 Z"
              fill={fillTint}
              stroke={strokeMain}
              strokeWidth="1.8"
            />
            <rect x="38" y="23" width="18" height="6" stroke={strokeDetail} strokeWidth="1.3" />
            {/* Receiver + handguard */}
            <path
              d="M54 22 H134 V31 H102 L98 36 H82 L76 34 L67 52 H56 L62 34 L54 32 Z"
              fill={fillTint}
              stroke={strokeMain}
              strokeWidth="1.8"
            />
            {/* Barrel + Suppressor */}
            <path d="M134 25 H150 V28.5 H134" stroke={strokeMain} strokeWidth="1.6" />
            {suppressed ? (
              <rect
                x="150"
                y="23"
                width="36"
                height="7.5"
                rx="1.5"
                fill={fillTint}
                stroke={strokeAccent}
                strokeWidth="1.7"
              />
            ) : (
              <path d="M150 24.5 H160 V29 H150 Z" stroke={strokeMain} strokeWidth="1.6" />
            )}
            {/* Holo / Red-dot optic */}
            <path d="M68 22 V15 H84 V22" fill={fillTint} stroke={strokeAccent} strokeWidth="1.6" />
            <circle cx="76" cy="18.5" r="1.3" fill={strokeAccent} />
            {/* Curved 30-rd STANAG magazine */}
            <path
              d="M84 35 H97 L101 56 L89 58 L84 35 Z"
              fill={fillTint}
              stroke={strokeMain}
              strokeWidth="1.7"
            />
            {/* Trigger guard + vertical foregrip */}
            <path d="M74 34 H84 V40 H73" stroke={strokeDetail} strokeWidth="1.4" />
            <path d="M114 31 H121 L120 44 H115 Z" fill={fillTint} stroke={strokeDetail} strokeWidth="1.5" />
            {/* M-LOK / rail slots */}
            <path d="M104 26 H128" stroke={strokeDetail} strokeWidth="1.3" strokeDasharray="3 2" />
          </g>
        )}

        {weaponId === "smg" && (
          <g strokeLinecap="round" strokeLinejoin="round">
            {/* Folding wire / compact PDW stock (Kobra MP-9 SD) */}
            <path d="M36 25 H56 M36 25 L34 39 H39 L43 32 H56" stroke={strokeMain} strokeWidth="1.8" />
            <path d="M31 23 V41 H35 V23 Z" fill={fillTint} stroke={strokeMain} strokeWidth="1.6" />
            {/* Compact SMG receiver */}
            <path
              d="M56 21 H124 V34 H96 L91 37 H78 L72 54 H61 L66 36 L56 34 Z"
              fill={fillTint}
              stroke={strokeMain}
              strokeWidth="1.9"
            />
            {/* Integrally styled / stubby suppressor */}
            {suppressed ? (
              <rect
                x="124"
                y="22.5"
                width="32"
                height="8.5"
                rx="1.8"
                fill={fillTint}
                stroke={strokeAccent}
                strokeWidth="1.7"
              />
            ) : (
              <rect x="124" y="24.5" width="12" height="4.5" stroke={strokeMain} strokeWidth="1.6" />
            )}
            {/* Micro reflex sight */}
            <path d="M74 21 L77 16 H88 L90 21" fill={fillTint} stroke={strokeAccent} strokeWidth="1.5" />
            {/* Straight/slightly canted SMG stick mag inside/forward of grip */}
            <path
              d="M84 35 H93 L97 58 L88 59 L84 35 Z"
              fill={fillTint}
              stroke={strokeMain}
              strokeWidth="1.7"
            />
            {/* Angled foregrip & trigger guard */}
            <path d="M73 35 H83 V41 H71" stroke={strokeDetail} strokeWidth="1.4" />
            <path d="M107 34 L112 42 H118 L115 34" stroke={strokeDetail} strokeWidth="1.5" />
          </g>
        )}

        {weaponId === "shotgun" && (
          <g strokeLinecap="round" strokeLinejoin="round">
            {/* Classic tactical stock + pistol grip (Breacher M870-S) */}
            <path
              d="M16 32 L50 26 H64 V35 H44 L22 47 H14 Z"
              fill={fillTint}
              stroke={strokeMain}
              strokeWidth="1.8"
            />
            {/* Receiver */}
            <path
              d="M64 23 H102 V34 H64 Z"
              fill={fillTint}
              stroke={strokeMain}
              strokeWidth="1.8"
            />
            {/* Long barrel + under-barrel tube magazine */}
            <path d="M102 24 H158 V27.5 H102" stroke={strokeMain} strokeWidth="1.7" />
            <path d="M102 29 H152 V32.5 H102" stroke={strokeDetail} strokeWidth="1.5" />
            {/* Pump-action forend */}
            <rect
              x="108"
              y="28.5"
              width="28"
              height="6.5"
              rx="1.5"
              fill={fillTint}
              stroke={strokeMain}
              strokeWidth="1.7"
            />
            <path d="M113 30 V33.5 M118 30 V33.5 M123 30 V33.5 M128 30 V33.5" stroke={strokeDetail} strokeWidth="1.2" />
            {/* Large rectangular shotgun suppressor */}
            {suppressed ? (
              <rect
                x="158"
                y="22.5"
                width="34"
                height="8.5"
                rx="1.5"
                fill={fillTint}
                stroke={strokeAccent}
                strokeWidth="1.7"
              />
            ) : (
              <rect x="158" y="24" width="8" height="4" stroke={strokeMain} strokeWidth="1.5" />
            )}
            {/* Ghost-ring sight & trigger guard */}
            <path d="M74 23 V20 H84 V23" stroke={strokeAccent} strokeWidth="1.5" />
            <path d="M68 34 H79 V40 H67" stroke={strokeDetail} strokeWidth="1.4" />
            {/* Side saddle shell carrier */}
            <path d="M74 26 V31 M79 26 V31 M84 26 V31 M89 26 V31" stroke={strokeDetail} strokeWidth="1.4" />
          </g>
        )}

        {weaponId === "dmr" && (
          <g strokeLinecap="round" strokeLinejoin="round">
            {/* Precision marksman stock with cheek riser (Falcon Mk14-SD) */}
            <path
              d="M12 24 H48 V33 H32 L18 44 H12 Z"
              fill={fillTint}
              stroke={strokeMain}
              strokeWidth="1.8"
            />
            <path d="M22 24 V20.5 H39 V24" stroke={strokeDetail} strokeWidth="1.5" />
            {/* Heavy receiver + chassis + vented handguard */}
            <path
              d="M48 22 H138 V33 H102 L96 36 H78 L72 52 H60 L66 35 L48 33 Z"
              fill={fillTint}
              stroke={strokeMain}
              strokeWidth="1.8"
            />
            {/* Long precision barrel + large DMR suppressor */}
            <path d="M138 25 H162 V28 H138" stroke={strokeMain} strokeWidth="1.6" />
            {suppressed ? (
              <rect
                x="162"
                y="23"
                width="42"
                height="7.5"
                rx="1.5"
                fill={fillTint}
                stroke={strokeAccent}
                strokeWidth="1.7"
              />
            ) : (
              <path d="M162 24 H174 L172 29 H162 Z" stroke={strokeMain} strokeWidth="1.6" />
            )}
            {/* Magnified marksman scope + mount rings */}
            <path
              d="M62 12 H106 L112 10 V19 L106 17 H62 L57 18.5 V10.5 Z"
              fill={fillTint}
              stroke={strokeAccent}
              strokeWidth="1.6"
            />
            <path d="M72 17 V22 M94 17 V22" stroke={strokeDetail} strokeWidth="1.6" />
            {/* 7.62 box magazine */}
            <path
              d="M84 35 H99 L100 50 H85 Z"
              fill={fillTint}
              stroke={strokeMain}
              strokeWidth="1.7"
            />
            {/* Folded bipod legs under handguard */}
            <path d="M126 33 V37 H144" stroke={strokeDetail} strokeWidth="1.5" />
            <circle cx="145" cy="37" r="1.4" stroke={strokeDetail} strokeWidth="1.3" />
          </g>
        )}

        {/* Diagonal tactical holster indicator slash when holstered */}
        {holstered && (
          <line
            x1="28"
            y1="56"
            x2="192"
            y2="12"
            stroke="#38bdf8"
            strokeWidth="1.6"
            strokeDasharray="4 3"
            opacity="0.75"
          />
        )}
      </svg>
    </div>
  );
};
