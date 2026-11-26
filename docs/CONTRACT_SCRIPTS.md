# Westgate Bay — Open-World Surveillance & Ocean-Disposal Scripts

These three open-world contracts run live across Westgate Bay (`ContractSurveillanceSystem` in `src/game/city/ContractSurveillance.ts`). Each target has a physical residence, personal car, workplace, named colleagues, a 6-phase daily routine (`07:00–22:30` compressed to 18 real seconds per game hour; press `[Y]` or use SkyPhone `[+1h Stakeout]` to skip ahead), live overheard dialogue & stage directions, isolated strike windows, and full `BodyCarrySystem` + Starter Boat ocean disposal.

Starter Vehicle & Boat Access:
- **Car**: `Golf` (parked at your Old Quarter Safehouse garage `420 Mirror Park Crescent`, or summoned via SkyPhone -> *Johnny · Mechanic*).
- **Starter Boat**: `Bayliner Starter Skiff` (moored from the start at **Pacific Marina Dock** `(-726, 486)`, or summoned to the nearest coastline via SkyPhone -> *Harbor Master · Dock 1*).

---

## Contract H1: "The Port Auditor" — Marcus Bell

- **Target**: Marcus Bell, *Senior Customs Compliance Auditor*
- **Residence**: `418 Mirror Park Crescent`, Old Quarter `(-265, 510)`
- **Personal Car**: Silver Blista Compact (`compact`, `#cbd5e1`)
- **Workplace**: Downtown Customs Annex (`(34, -148)`) & Eastgate Seaport (`(682, 486)`)
- **Colleagues & Neighbor**:
  - **Clara Hayes** — Next-Door Neighbor (`(-282, 496)`)
  - **Devon Park** — Junior Customs Analyst (`(-261, -106)`)
  - **Nadia Chen** — Compliance Branch Lead (`(37, -151)`)
  - **Officer Hale** — Customs Plaza Security (`(24, -140)`)
  - **Eddie Cruz** — Eastgate Dock Foreman (`(576, 432)`)
- **Payout**: `$3,500` Base + `$1,500` Unseen Strike + `$1,000` Deep Sea Disposal

### Detailed Daily Script & Dialogue

#### `07:00 – 08:30` · Morning Porch & Neighbor Chat — *418 Mirror Park Crescent (Home)*
*Risk: Witnessed (Clara Hayes)*
- **Clara Hayes** *(waves over the white picket fence with a coffee mug)*: "Morning, Marcus! Heading down to the harbor early again?"
- **Marcus Bell** *(locks his front door and pats his briefcase)*: "Yeah, Clara. Three containers came off the night barge without stamped bills. Somebody's cooking Pier 4's books."
- **Clara Hayes** *(glances toward his silver Compact in the driveway)*: "Just don't work yourself into an early grave. Pick up dinner on your way home tonight."
- **Marcus Bell** *(checks his watch and walks toward his car)*: "Meeting Devon at the Midtown café first, then straight to the plaza. See you at seven, Clara."

#### `08:30 – 10:30` · Coffee Briefing with Analyst — *Midtown Del Sol Café Curb*
*Action: Marcus walks to his Silver Compact, drives north out of Old Quarter into Midtown, parks curbside, and meets Devon Park.*
*Risk: Witnessed (Devon Park + Midtown sidewalk traffic)*
- **Devon Park** *(glances around nervously and lowers his voice)*: "Marcus, please—tell me you didn't log container forty-seven into the federal portal yet."
- **Marcus Bell** *(sips espresso and taps the manila folder)*: "It's already drafted, Devon. Three tons of undeclared crates walked off Pier 4 last Tuesday."
- **Devon Park** *(leans against the café railing)*: "The people moving those crates don't write memos, man. Drop it before you drive out to Eastgate today."
- **Marcus Bell** *(snaps his briefcase shut)*: "I don't take threats over a latte. Meet Nadia at the annex—I'm pulling the physical seals after lunch."

#### `10:30 – 13:30` · Downtown Customs Annex Shift — *Legion Square Customs Courtyard*
*Action: Drives east along Westgate Central Boulevard to Legion Square, parks, and briefs Nadia Chen under Officer Hale's watch.*
*Risk: Guarded (Nadia Chen + Officer Hale)*
- **Nadia Chen** *(hands Marcus a stamped clipboard beside the marble steps)*: "City Hall called twice asking for your Pier 4 audit summary, Marcus. Guard Hale is logging visitors upstairs."
- **Marcus Bell** *(flips through manifests under the awning)*: "Tell the deputy mayor I'll have photos of the broken customs seals from the Eastgate quay by three."
- **Officer Hale** *(adjusts his radio earpiece while scanning the plaza)*: "Watch yourself out at the container yard, Bell. Port security doesn't cover the far east apron."
- **Marcus Bell** *(waves off Hale and checks his phone)*: "I'm only checking one row of containers with Eddie, then walking the canals to clear my head."

#### `13:30 – 16:30` · Isolated Eastgate Pier Inspection — *Eastgate Seaport · Outer East Quay*
*Action: Drives over Cypress Industrial Bascule Bridge to Eastgate Seaport. Speaks briefly with Foreman Eddie Cruz at the warehouse gate, then walks out alone to the isolated outer quay edge.*
**PERFECT STRIKE WINDOW #1 (Isolated — Steps from harbor water & trunk extraction)**
- **Eddie Cruz** *(points from the warehouse doorway toward the cranes)*: "Yard's quiet down on the east apron, Bell. I gotta check the crane winch inside—holler if you need a forklift."
- **Marcus Bell** *(walks out alone to the edge of the harbor quay)*: "Copy that, Eddie. Just snapping serial numbers out by the bollard line."
- **Marcus Bell (Phone)** *(speaks into his phone while staring across the harbor water)*: "Yeah, I'm out on the far end of the pier completely alone. Give me twenty minutes and I'm uploading the whole file."
- **Marcus Bell** *(crouches by a yellow mooring bollard taking photos)*: "Serial 47-Delta... bingo. Got everything I need."

#### `16:30 – 19:30` · Evening Venice Canals Stroll — *Venice Canals North Embankment*
*Action: Drives west across the city to Venice Canals, parks at the canal promenade, and strolls the quiet embankment at dusk.*
**PERFECT STRIKE WINDOW #2 (Isolated — Minutes from your Starter Boat at Pacific Marina)**
- **Marcus Bell (Phone)** *(paces slowly along the quiet canal wall at dusk)*: "No, Devon, I'm just walking along the Venice canals by myself before heading home. Nobody followed me."
- **Marcus Bell** *(leans against the canal balustrade watching the water)*: "Calm down. By Monday morning the port commission will clean house and we can finally sleep."

#### `19:30 – 22:30` · Drive Home & Night Porch — *418 Mirror Park Crescent (Home)*
*Action: Drives back to Mirror Park Crescent and greets Clara before looping.*
- **Clara Hayes** *(calls out from her porch swing)*: "You look beat, Marcus. Long day down at the docks?"
- **Marcus Bell** *(rubs his shoulders and smiles tiredly)*: "Longest week of my life, Clara. Tomorrow morning I turn the whole file in and take the weekend off."

---

## Contract H2: "The Pharma Fixer" — Dr. Victor Kaine

- **Target**: Dr. Victor Kaine, *Clinical Trial Director*
- **Residence**: `12 Venice Canal West`, West Coast `(-648, 245)`
- **Personal Car**: Midnight Blue Overtake SUV (`crossover`, `#1e3a8a`)
- **Workplace**: St. Jude's Medical Center, Midtown `(-146, -206)`
- **Colleagues & Neighbor**:
  - **Leo Navarro** — Canal Jogger Neighbor (`(-662, 234)`)
  - **Nurse Elena Morales** — Clinical Trial Coordinator (`(-140, -218)`)
  - **Mercer** — Private Executive Escort (`(-156, -204)`)
  - **Julian Cross** — Pharma Lobbyist (`(-134, 382)`)
- **Payout**: `$4,500` Base + `$2,000` Unseen Strike + `$1,200` Deep Sea Disposal

### Detailed Daily Script & Dialogue

#### `07:00 – 08:45` · Canal Villa Espresso & Neighbor — *12 Venice Canal West (Home)*
- **Leo Navarro** *(jogs in place in neon running gear outside Kaine's courtyard)*: "Morning, Doc! Taking the SUV up to St. Jude's or flying out tonight?"
- **Dr. Victor Kaine** *(adjusts silk cuffs and glances at his watch)*: "Hospital till noon, Leo, then one last board settlement before my flight. Keep an eye on the place."

#### `08:45 – 12:30` · St. Jude's Medical Courtyard — *Midtown*
*Risk: High (Mercer + Nurse Elena)*
- **Nurse Elena Morales** *(holds a tablet tightly and confronts Kaine by the planters)*: "Victor, the toxicology flags on batch nine weren't noise. You can't sign the clearance without a recall!"
- **Dr. Victor Kaine** *(speaks coldly while glancing back at Mercer)*: "I already signed it, Elena. Archive the raw charts and keep Mercer stationed at the ambulance bay—I'm meeting Julian alone at lunch."
- **Mercer** *(crosses arms beside the hospital steps)*: "Are you sure you don't want an escort over to Mirror Park, Doc?"
- **Dr. Victor Kaine** *(steps toward his parked blue SUV)*: "No, Mercer. Julian gets spooked by hired muscle. Stay on the hospital clock."

#### `12:30 – 14:15` · Gazebo Payoff with Lobbyist — *Mirror Central Park Gazebo*
*Risk: Witnessed while Julian Cross is present—wait until 14:15!*
- **Julian Cross** *(slides an encrypted hard drive across the park railing)*: "Two million wired to Cayman once you hand over the original lab backups, Victor."
- **Dr. Victor Kaine** *(pockets the drive inside his coat)*: "Half now, half after I verify the wire at sunset. Walk back to the street—I'm taking ten minutes by the pond alone."

#### `14:15 – 16:30` · Isolated Pond Reflection — *Mirror Park South Pond Edge*
**PERFECT STRIKE WINDOW #1 (Isolated)**
- **Dr. Victor Kaine (Phone)** *(stands at the secluded south pond edge checking Cayman banking)*: "Yeah, I shook Mercer at the hospital and Julian left. Nobody around the south pond at all—confirm the transfer."
- **Dr. Victor Kaine** *(chuckles quietly while feeding ducks)*: "Cleanest payday in Westgate."

#### `16:30 – 19:30` · Pacific Marina Breakwater Call — *Pacific Marina Pier Promenade*
**PERFECT STRIKE WINDOW #2 (Isolated — Literally steps from your Starter Boat!)**
- **Dr. Victor Kaine (Phone)** *(walks out along the wooden Pacific Marina slips)*: "Charter boat isn't docking until ten. I'm standing out by the empty yacht slips watching the Pacific."
- **Dr. Victor Kaine** *(gazes toward the open bay)*: "Everything's quiet out here. Tell the pilot to spin up at midnight."

#### `19:30 – 22:30` · Return to Canal Villa — *12 Venice Canal West (Home)*
- **Leo Navarro** *(waves from across the footbridge)*: "Welcome back, Victor. All packed for your trip?"
- **Dr. Victor Kaine** *(nods curtly from his gate)*: "Almost, Leo. Just waiting for dark."

---

## Contract H3: "The Syndicate Architect" — Damon Vale

- **Target**: Damon Vale, *Municipal Infrastructure Fixer*
- **Residence**: `204 Vinewood Crest Drive`, Northern Foothills `(-378, -835)`
- **Personal Car**: Obsidian Black Lux Sedan (`sedan`, `#0f172a`)
- **Workplace**: Midtown Tower Construction (`(-304, -106)`) & City Hall (`(132, -156)`)
- **Colleagues & Housekeeper**:
  - **Rosa Delgado** — Estate Housekeeper (`(-380, -818)`)
  - **Foreman Marco Silva** — Site Superintendent (`(-308, -104)`)
  - **Evelyn Shaw** — Deputy City Clerk (`(136, -158)`)
  - **Sergeant Briggs** — City Hall Security Detail (`(126, -148)`)
- **Payout**: `$5,500` Base + `$2,500` Unseen Strike + `$1,500` Deep Sea Disposal

### Detailed Daily Script & Dialogue

#### `07:00 – 08:45` · Vinewood Estate Briefing — *204 Vinewood Crest Drive (Home)*
- **Rosa Delgado** *(hands Vale his leather folio beside the stone balustrade)*: "Your suit is pressed for City Hall, Señor Vale. Will you be back before dark?"
- **Damon Vale** *(puts on aviator sunglasses overlooking the city smog)*: "Inspection at Midtown first, then Evelyn on the City Hall steps, then up to the Observatory to clear my head. Lock the gate behind me."

#### `08:45 – 12:00` · Midtown Site Shakedown — *Midtown Tower Construction*
- **Damon Vale** *(jabbing a finger at Marco's blueprint roll)*: "I didn't skim four hundred grand off the steel invoice so your crew could fall two weeks behind schedule, Marco!"
- **Foreman Marco Silva** *(pulls off his yellow hard hat wiping sweat)*: "The concrete inspector's sniffing around, Mr. Vale. If he tests those pillars, both of us go upstate!"
- **Damon Vale** *(lowers his voice into a cold whisper)*: "Then keep him off the site until I meet the feds tomorrow. I'm heading to City Hall."

#### `12:00 – 15:30` · City Hall Backroom Deal — *City Hall & Courthouse Steps*
- **Evelyn Shaw** *(slips a sealed envelope inside Vale's coat pocket)*: "Here are the immunity drafts the DA's office asked for, Damon. Sergeant Briggs is watching the street."
- **Damon Vale** *(pats the pocket and looks up at the City Hall pillars)*: "Smart girl, Evelyn. By morning everyone on the Westgate board takes the fall except us. I'm driving up to the Observatory alone to read these over."

#### `15:30 – 18:30` · Observatory West Terrace Overlook — *Westgate Observatory*
**PERFECT STRIKE WINDOW #1 (Isolated)**
- **Damon Vale (Phone)** *(leans over the stone parapet overlooking the entire bay)*: "I'm up at the Observatory west terrace completely alone. Tell the Marshal I'll sign the proffer at 9 AM."
- **Damon Vale** *(lights a cigar looking down over Downtown)*: "Look at them all down there. None of them see it coming."

#### `18:30 – 20:30` · Del Sol North Beach Cove — *Del Sol North Sand Cove*
**PERFECT STRIKE WINDOW #2 (Isolated — Steps from the surf!)**
- **Damon Vale (Phone)** *(walks barefoot along the deserted sunset waterline)*: "Just catching ocean air north of the pier before heading back up the canyon. Not a soul out here."

#### `20:30 – 22:30` · Return to Vinewood Estate — *204 Vinewood Crest Drive (Home)*
- **Rosa Delgado** *(opens the foyer door as Vale walks up the drive)*: "Dinner is warm inside, Señor Vale. Big day tomorrow?"
- **Damon Vale** *(nods grimly)*: "The biggest, Rosa. Make sure nobody enters the gate tonight."

---

## Ocean Disposal Loop (All Contracts)
1. **Strike** cleanly during an isolated window (suppressed shot or `[V]` stealth takedown) to secure the **Unseen Bonus**.
2. **Pick up** the target's body with `[G]`.
3. **Transport** the body: either stow it in your car trunk (`[G]` behind any car, including your Golf) or carry it directly onto your **Bayliner Starter Skiff** (`[F]` to board with body at Pacific Marina or summoned shoreline).
4. **Dump at Sea**: Sail out into deep Pacific water and press `[G]` to dump the body overboard for the **Deep Sea Disposal Bonus** and full contract payout.
