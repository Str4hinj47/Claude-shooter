# VOSS // BLACK CONTRACT — Design & Campaign Bible

> **VOSS // BLACK CONTRACT** is a third-person tactical action & open-world espionage game built in Three.js + React + TypeScript.
> Players roam **Westgate Bay** from their **420 Crescent Safehouse** and deploy into **seven structured Black Contract operations (M0–M6)** across distinct biomes, times of day, weather conditions, and enemy factions.

---

## 1. World & Setting

**Westgate Bay** is a coastal metropolis divided into interconnected districts:

- **Old Quarter** — 420 Crescent Safehouse & Garage, tight alleys, neighborhood shops, and safehouse customization benches.
- **Downtown & Midtown** — corporate towers, financial avenues, traffic signals, speed traps, and high-rise penthouses.
- **West Coast & Foothills** — coastal highways, five architectural bridges, canyon switchbacks, stunt jumps, and wildlife.
- **Westgate Port & Airport** — shipping terminals, dockside cranes, surveillance boats, aircraft hangars, and heavy freight traffic.

Players can drive 16+ vehicles (with tuning, custom paint, wheel/tint/trim finishes, tire-slip audio, headlights, and radio), pilot speedboats and aircraft, run side contracts (surveillance, racing, speed traps, stunt jumps, hidden stashes), manage wanted heat, and launch story contracts directly from open-world dispatch points or the Contract Menu.

---

## 2. Key Characters

- **Voss (Player Operative)** — Ex-special forces contractor operating off-grid out of Westgate Bay. Supports **Vanguard Tactical** (`soldier.glb`, full modular armor/camo/visor/NVG/backpack/headset customization) alongside 11 Rocketbox character archetypes with uniform tinting.
- **Mara Vance ("Broker")** — Voss's handler and contract escrow fixer. Coordinates briefings, live mission comms, exfil windows, and Westgate Bay SkyPhone jobs.
- **Sergeant "Brick" Horvat** — Veteran heavy-weapons ally fighting alongside Voss in **Mission 5 (Hostile Takeover)**.
- **Contract Targets & Bosses**:
  - **Viktor Kroll** *(Mission 3 — Dead Drop)* — Corporate spy broker holding stolen prototype drives.
  - **Commander Ren** *(Mission 4 — Black Ledger)* — Rogue harbor enforcer protecting contraband manifests.
  - **Viktor Sorin** *(Mission 5 — Hostile Takeover)* — Apex Corporate Tower security chief.
  - **General Drago Kovač** *(Mission 6 — The Sovereign Contract)* — Commander of the 260m Ironridge Fortress black-site.

---

## 3. Campaign Operations (M0–M6)

| ID | Codename | Location | Client | Key Threat / Boss |
|---|---|---|---|---|
| **M0** | **CALIBRATION** | Private Safehouse Range | Mara Vance (Broker) | Live-fire weapons, stealth, and movement calibration |
| **M1** | **PAPER TRAIL** | Highland Estate Village | Senator Arthur Sterling | Syndicate safehouse raid, server scrub & witness extraction |
| **M2** | **GLASS VAULT** | Syndicate Construction Vault | Countess Elena Vane | Night infiltration, Blood Star Diamond heist & relay sabotage |
| **M3** | **DEAD DROP** | Downtown Financial District | Julian Mercer (Tech CEO) | Prototype drives, mainframe scrub, **rooftop snipers** & **Viktor Kroll** |
| **M4** | **BLACK LEDGER** | Westgate Harbor Docks | Victoria Thorne | Cargo ship manifests, dock patrols & **Commander Ren** |
| **M5** | **HOSTILE TAKEOVER** | Apex Corporate Tower | Anonymous Board Director | Thunderstorm assault with **Brick**, snipers, **heavy breachers** & **Viktor Sorin** |
| **M6** | **THE SOVEREIGN CONTRACT** | Mount Ironridge Fortress | The Consortium | 260m multi-zone fortress, relays, Sovereign Diamond & **General Drago Kovač** |

---

## 4. Tactical Systems & Progression

- **Threat Tiers (Difficulty):** **Operative** (`1.0×`), **Veteran** (`1.2×` HP, `+25%` damage/payout), and **Shadow** (`1.38×` HP, `+55%` damage, sharper optics, `+60%` payout).
- **Enemy Archetypes:**
  - **Guards / Patrol / Advance** — Foveal + peripheral vision cones, flashlight beams at night, corpse discovery, wall-occluded & unit-occluded LOS, ballistic gunfire, and tactical flanking.
  - **Snipers (`role: "sniper"`)** — Perched high-ground DMR marksmen with `1.45×` vision range, `64m` engagement envelope, and red tactical laser sightlines when alerted.
  - **Heavies (`role: "heavy"`)** — Titanium-armored breachers (`1.65×` HP, shotgun/carbine bursts, relentless close-quarters pressure).
- **Ballistics & Hit Zones:** Headshot (`2.0×` radial & vertical bounds), Torso (`1.0×`), and Limbs (`0.72×`), tracked with end-of-mission **S / A / B / C** debrief ranks, accuracy %, headshots, stealth kills, and Ghost (`0 alerts`) bonuses.
- **Armory & Loadout:** 5 weapon classes (**Pistol, Carbine, SMG, Shotgun, DMR**) with modular optics, muzzles (suppressed/compensator), underbarrels, magazines, Cerakote finishes, and reticle tints.
