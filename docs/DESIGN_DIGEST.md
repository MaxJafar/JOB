# (Source digest for docs/ROADMAP.md — synthesized by a 10-reader workflow from the two books; 195 raw principles distilled.)

# J.O.B — Early Access Design Digest
*Synthesized from Schell's "The Art of Game Design" and Killick's "Game Design: How Games Are Made" — duplicates merged, generic advice cut, everything mapped to the v1.0 roadmap.*

---

## 1. Pacing & Difficulty

**1.1 — Build the run as a fractal interest curve (Schell, Lens 68/69; Alexander's levels of scale)**
Three nested arcs: wave (spawn buildup → peak → cleanup), floor (hook fight → loot lull → escalating waves → elevator finale), run (4 floors strictly escalating to the Penthouse). Audit that no floor finale outshines the CEO fight. The AI director scripts wave-level mini-arcs instead of applying flat time-scaled pressure.

**1.2 — Sawtooth flow: guarantee tasted power spikes (Schell, Lens 21)**
Every draft pick and rare drop must produce a felt 30–60s window of visibly mowing down mobs. Suppress the time-scaling difficulty tick for ~20s after elevator events and upgrade picks so the reward isn't instantly cancelled. This is the single most common failure in RoR-likes.

**1.3 — Director-enforced rest valleys (Killick "smell the grass"; L4D relax phases)**
After every wave arena and elevator event: a hard 30–60s no-spawn lull for looting, KPI turn-ins, and draft reading. Time-scaling must never flatten these valleys — spikes only read as spikes against quiet.

**1.4 — Escalate composition, not HP (Killick, enemy tiers; no bullet sponges)**
Time-scaling should raise the tier MIX — count first, then speed, then archetype complexity (Intern → armored Senior → specials) — with a hard cap on raw HP multipliers. Past the cap, elites gain a visible, breakable guard bar fed by combo pressure. A 25-minute run must feel different in kind, not in TTK.

**1.5 — One self-balancing rule per wave (Schell, natural balance / Space Invaders)**
Remaining mobs "panic" and gain speed/aggression as a wave thins — every wave auto-generates a crescendo finish at zero scripting cost, and dangerous back-line targets drop visibly better loot to punish corner-camping.

**1.6 — Design session length with a forced climax (Schell, Minotaur's Armageddon)**
Time-scaling lets skilled players loop into flabby 2-hour runs that end in boredom. Add a "security purge" escalation past ~35–45 min that outscales any build, so every run ends spectacularly. Validate with deaths-over-time telemetry: the graph should be a rising sawtooth peaking at the Penthouse.

---

## 2. Level Design (corridor + wave + arena hybrid)

**2.1 — Corridors = compression, arenas = release (Schell/Alexander: Void & Contrast; nested spaces)**
Arenas are bounded sub-spaces with unmistakable thresholds (door frame, lighting shift, music layer). Bosses and elevator events stage in large stripped rooms entered from tight cubicle corridors — the spatial contrast IS the fanfare. Spatial language is a contract: open bullpens host hordes, narrow server rooms host exactly one dangerous special, never the reverse.

**2.2 — Corridors must carry tension or choice, never transit (Schell, Aladdin shortcut; Killick, traversal)**
Salt corridors with vaultable desks, hazards, mob trickles that feed the combo meter, and next-arena teases. Any corridor with 10+ dead seconds gets compressed or gains a shortcut (vents, freight elevator). If playtesters sprint through blank-faced, cut — don't add.

**2.3 — Weenie + guide line + landmarks (Schell, indirect control; Colossal Cave problem)**
One dominant landmark per floor visible from most arenas (stock ticker / neon logo / leaderboard / golden elevator), floor-level guidance (carpet strips, emergency lighting) toward the objective, and 1–2 unique landmark props per generated chunk set ("regroup at the aquarium!"). Procedural office floors are maximum-risk for "twisty little passages, all alike."

**2.4 — Make the elevator the Pac-Man dot (Schell, Lens 49: Elegance)**
Exit + teleporter event + difficulty spike + loot shower + floor-grade scoreboard + always-visible navigation beacon: one element, six purposes. Apply the same audit to every v0.1 system — anything serving one purpose absorbs more jobs or dies.

**2.5 — Greybox against a metrics kit before art (Killick; Schell's paper Halo)**
Fix 1 unit = 1m, build interiors at ~1.25–1.5x real scale (third-person distortion fix — extra space doubles as kiting room). Define corridor width in co-op player-widths, arena diameter vs longest-range projectile, cover depth vs melee reach. Grey-box all four floors and paper-sketch layouts before committing artists to vibrant arenas.

**2.6 — Asymmetric routes, paid dead ends, colluding AI (Killick; Schell, Lens 82)**
Every floor: one fast/risky vs slow/safe route, side rooms behind elite guards with visible chests, no empty dead ends (minimum: a destructible that drops something). When a wave is nearly cleared, surviving specials retreat toward the next arena, dragging players along the intended route; if a floor runs long, the finale comes to the players. Use position heatmaps during EA to pave the desire paths.

---

## 3. Loot / Equipment & Build System

**3.1 — Endogenous value: the detour test (Schell, Lens 7 — Bubsy vs Sonic)**
If the combo meter and KPI quests don't change survival or build power, players will learn to ignore them. Wire them in: combo tier raises next-drop rarity, KPI completion pays in rerolls/slot unlocks/elevator discounts. Playtest criterion: do players physically detour for it? If not, rewire or delete.

**3.2 — Triangularity everywhere (Schell, Lens 40)**
Schell: 8 of 10 "not fun" prototypes lack risk/reward forks. Elevator: "leave now" vs "hold 60s for a bonus crate." Rare fleeing briefcase-courier mob. Combo meter multiplies loot/XP so staying in the fight is a gamble. Balance so EV(risky) ≈ EV(safe).

**3.3 — Variable-ratio rewards with perception guards (Schell, reward schedules + perceived probability)**
Most kills drop nothing; occasional jackpot bursts (2/3 nothing, 1/3 triple), escalating magnitude per floor. But protect perception: guarantee item procs on first hit after pickup, pity timers on rare gear, and roll stats from 2–3 summed dice so god-rolls are genuinely rare (Monte Carlo–verify drop curves before shipping).

**3.4 — Gift-wrap and earn the drop (Schell, anticipation + D&D Online framing; Killick, visible rewards)**
Telegraph stakes before risk ("Hold the lobby — earn a RARE briefcase"), ritualize the reveal (rarity-colored briefcase opening), and gate the best gear behind risk moments (elevator events, specials, KPI completion) — never mid-corridor vending. Each floor boss guarantees a signature drop derived from its own mechanic: a deterministic jackpot over the random layer.

**3.5 — Items amplify skill and cross systems (Schell, real vs virtual skill; Lens 30)**
Equipment should be system-crossers (combo-decay extension that also charges specials), not stat sticks, and combo/positioning must stay decisive at high item counts or late runs become screensavers. Log draft pick/win rates from v0.1: >50% pick rate = dominant, <10% = dead — fix both before streamers broadcast the solved build. Keep drafts at exactly 3 curated cards.

**3.6 — Gear must be visible on the body (Killick — twice; Schell, Lens 97)**
Render every equipped slot on the low-poly model with rarity-tier visual escalation. In co-op, builds readable at a glance are trophies, social proof, and free HUD.

---

## 4. Character Archetypes

**4.1 — Function-first roster design (Schell, Lens 86)**
Fix the combat-function grid first (2 melee / 2 short / 2 long; mobs: patroller, chaser, shooter, guardian, flyer, teleporter, blocker), then skin with office archetypes. This prevents two classes that play the same with different hats — the most expensive art mistake on the roadmap.

**4.2 — Signature ability + three words + one designed weakness (Killick)**
Each archetype keeps one fixed ability loot never replaces (only passive + special slots are loot-driven), a three-word identity ("Accountant: precise, patient, explosive"), and one explicit mechanical weakness (melee: no answer to flyers; sniper: helpless in swarm range). Drafting becomes "patch my weakness vs amplify my strength" — the core of build identity.

**4.3 — Distinct demanded skills ARE the identity (Schell, Lens 34)**
Write the skill list per archetype (melee = spacing/commitment; short = risk management; long = kiting/priority). If two archetypes test the same skills, redesign one — numbers don't differentiate, demands do.

**4.4 — Value model + rock-paper-scissors specials (Schell, fairness)**
Spreadsheet all 12 classes with equal attribute totals; expect range/safety to prove worth ~2x and compensate melee with sustain/loot access. Compute EV against actual per-floor HP pools (overkill wastes melee damage on trash — give cleave or tune HP). Each special mob should be hardest for one range band, easiest for another, so co-op composition matters.

**4.5 — One true support, ally-only (Schell, Toontown healing)**
One archetype whose heals/shields apply only to allies, never self — forced L4D-style interdependence, a home for non-DPS players, and a low-APM/high-value seat so mixed-skill friend groups survive together. Co-op groups that need each other re-queue together.

---

## 5. Game Feel / Juice / Animation

**5.1 — Pass the Toy Test before spending on content (Schell, Lens 17)**
Strip to a no-objective sandbox floor: movement, attacks, combo, destructible clutter. If players don't grin for 10 minutes with zero quests, fix feel first — no KPI system saves a core loop that isn't inherently fun. This is the acceptance test for the whole VFX/SFX/animation pass.

**5.2 — The 100ms law (Schell, Lens 63/64; Killick, frame-1 attacks)**
Hard rule: input to first visible/audible response under 100ms. Basic attacks fire frame 1; windups only on heavy special-slot swings. Special pressed on cooldown gets a denied flash + SFX, never silence. Dashes must visibly clear AoE circles. Frame drops during big waves are retention bugs, not perf niceties — budget real three.js profiling.

**5.3 — Every hit stacks channels (Killick; Schell, feedback)**
Simultaneously: 1–3 frame hitstop, flash, flinch/stagger, particle burst, damage number, tiered SFX, combo tick, subtle shake, rumble; slow-mo punch on wave-enders and combo milestones. Second-order motion is cheap in three.js — papers, mugs, and chairs scattering make movement itself fun.

**5.4 — Audio is the cheapest quality multiplier (Schell, sound study; Killick)**
Players rate identical graphics higher with good sound. Priority order: hit-confirm SFX → combo-meter audio escalation (pitch rises with tier) → signature audio identity per special mob heard *before* it's seen (the L4D clicker pattern — dread, fairness, and co-op callouts in one). Ship placeholders in v0.1 now.

**5.5 — Readability law on the low-poly style (Schell, Charlie Brown effect)**
The triangular style is a scientific asset — commit fully with snappy exaggerated animation, never mocap-smooth (uncanny valley). But enforce: looks different = works different. Unique silhouette + color + audio per special, one rarity-color language across drops/VFX/HUD, no behavior-changing reskins. Encode status into animation: elites strut and claim space, interns scurry and flinch.

**5.6 — Telegraphs and eventful deaths (Killick)**
Every special attack gets a 1-beat signature windup escapable with a single dash; every kill gets a fat death moment (paperwork burst, orbs, ragdoll). Spawns are diegetic — elevator ding, vent burst, cubicle eruption — never pop-in. Fairness is feel.

---

## 6. HUD & Clarity

**6.1 — Rank information by need (Schell, information channels)**
Always: HP, combo, special charge. Periodic: KPI progress, cash. Behind pause: equipment/clothing. Keep screen center clear. Encode magnitude in dressing (small white → big red crits).

**6.2 — Introduce HUD elements gradually (Killick, God of War compass)**
Run 1 shows only HP + combo; KPI tracker, equipment panel, and cooldowns appear the first time each system is encountered. Contrast-test every element against the actual vibrant arenas — HUD-vanishes-in-bright-scenes is a common, real failure.

**6.3 — Theme the interface as corporate software (Schell, Lens 11)**
Excel-style KPI panel, email popups, Outlook-flavored notifications, tactile office SFX (keyboard clack, stapler). Theme unity plus touch-through-sound, nearly free.

**6.4 — Mode changes must be unmistakable (Schell, Lens 67; Sid Meier's rule)**
Corridor / wave / elevator each get a hard signal (music state, HUD banner, door slam). When loot swaps the special-attack slot, change the weapon model, crosshair, and audio layer. Cap sub-modes so KPI quests never make a player forget where they were going.

**6.5 — Peripheral-readable state (Schell, Doom face; Killick, damage states)**
A small class portrait that degrades with HP and lights with combo state reads faster than bars mid-wave. Low-HP: vignette + slumped posture + audio muffle, tuned so the arena stays readable — a dying player who can't see is a feedback failure. Directional damage indicators for co-op.

---

## 7. Onboarding / First Session

**7.1 — Hook inside 60 seconds (Schell, Lens 70)**
Drop the new player into a short loud lobby brawl — staplers flying, desks exploding — before any menus or explanations. The same moment opens the Steam trailer. Teach systems after the hook, never before.

**7.2 — Floor 1 is the invisible tutorial (Killick, Super Meat Boy model; Schell, no written rules)**
First corridor teaches movement/dash on harmless drones, first mini-arena force-teaches the combo meter on a dense easy crowd, first hazard and first special each appear alone, first elevator event is scripted lighter. Zero text walls, under 3 minutes to first kill. Gate the floor-1 elevator on demonstrated skill: hit a combo threshold and draft one upgrade.

**7.3 — Trivially easy opening with explicit funnel targets (Schell, challenge vs success)**
The director stays nearly flat for the first ~5 minutes; a first-timer who's never played RoR should reach the first elevator event. Pick numbers now and check via demo telemetry: "60% of first-run players reach Floor 2; 25% ever beat the CEO." Without a target you can't tune the curve. Consider a free auto-revive on Floor 1 for a player's first runs (Spy Hunter).

**7.4 — Four-word goal and a goal ladder (Schell, Lens 32)**
"Fire the CEO" on the title screen. HUD always shows the current-floor objective. Ladder: keep combo alive (seconds) → clear floor (minutes) → beat CEO (run) → unlock archetypes (meta). Any player asked "what are you doing?" must answer instantly.

**7.5 — The tutorial is your playtest speech; build the polished version last (Schell Ch. 27; Killick)**
Every phrase you're forced to repeat before playtests is a missing in-game cue; when the speech converges, convert it line-by-line into contextual prompts. Don't build a scripted tutorial while archetypes and slots are still moving — ship drip-fed tooltips in EA, budget the real onboarding floor for the 1.0 push.

**7.6 — Telegraph the weird in-world (Schell, Lens 77)**
Warning posters ("Sentient copiers reported on Floor 2"), HR memos, PA announcements introduce specials before contact — tutorialization, world-building, and fairness in one. And enforce prop consistency: if one desk breaks, all identical desks break.

---

## 8. Retention & Session Length

**8.1 — The end screen is the most important retention surface (Schell, residual interest + loss aversion; Killick)**
Never end on a bare stats table. Death screen = near-miss converter ("87% to the Sales elevator"), banked meta-currency, one concrete unlock progressed, a tease of what was missed, a suggested next class. The player must quit with at least three open questions.

**8.2 — The Performance Review: fair judgment as theme-perfect feature (Schell, Lens 25; Rico Medellin)**
Letter-graded end-of-run screen (damage, combo mastery, KPIs, time) with deltas vs personal bests — J.O.B's judgment engine, self-challenge loop, and natural share object. Hard prerequisite: every death attributable (telegraphs, no off-screen one-shots, death recap). "Unfair death" is the phrase that poisons roguelite EA reviews.

**8.3 — Wanna, never hafta (Schell, motivation; addiction section)**
All meta-progression additive; failed runs still bank something; no daily logins, decay, or FOMO. Return hooks are aspiration: new archetypes, build experiments, difficulty tiers, weekly seeds. The satire only works if playing J.O.B never feels like a job.

**8.4 — Be a story-generating machine (Schell, Lens 73; Wright's epidemiology)**
Emergent-anecdote item interactions, multi-solution KPI quests, shareable end-of-run cards (build name, combo record, weirdest stat), and weekly seeded mutator runs. Players spread the game only while engaged — doubling the engagement window can 10x word-of-mouth, and word-of-mouth is the only affordable indie acquisition channel.

**8.5 — Plan the elder game and the three tiers (Schell, Ch. 24)**
Novices get the teaching floor; players get the build game; elders get post-win stacking modifiers (Monsoon/Eclipse-style), weekly leaderboards, per-archetype mastery with earned-only cosmetics as proof of skill. Elders are your patch feedback and your streamers — losing them mid-EA kills the review stream.

**8.6 — Co-op glue by design (Schell, Toontown; Killick, raid rewards)**
Instanced loot (no ninja-ing), damage-share credit, soft collision in doorways, contribution-scaled boss bonuses (revives count), post-run per-player awards that manufacture a conversation moment, one-click rematch and persistent lobby codes. Consider legacy persistence (the tower remembers damage, rescued NPCs return as vendors) as a differentiating long-term hook.

---

## 9. EA Launch Strategy & Playtesting

**9.1 — Exploit the stack: hot-reloadable everything (Schell, Rule of the Loop + fast-loop engine)**
Move all tuning — spawn tables, director curves, item/class stats, wave comps — into hot-reload JSON with an in-game debug panel (floor select, grant-any-loot, force events, time-scale override). This is the single highest-leverage engineering task of the whole EA period: it multiplies every loop that follows. Tune by double-or-halve, never 10%.

**9.2 — Risk-first, ugly prototypes (Schell, spiral model; foundational vs decorational)**
Kill-risk list now: (1) is corridor+wave actually fun; (2) can three.js hold 60fps at max wave density in networked co-op; (3) do 6 archetypes × slots produce broken/boring builds; (4) does self-hosted co-op friction kill session starts. Greybox-test each before committing artists to 12 characters and 4 vibrant arenas — juice amplifies a working core, it cannot substitute for one. Balance the loot economy as physical cards in an afternoon before coding drop tables.

**9.3 — Vertical slice + cut-safe scope (Schell, Cerny's Method + 50% rules; Killick)**
Bring Finance alone to true release quality — final art, loot, waves, HUD, juice — to learn cost-per-floor and set a believable roadmap. Define cut-safe v1.0 now (e.g., 3 of 6 archetypes, 2 new specials, equipment system = shippable; rest is upside). All systems playable by mid-EA; the back half is purely polish and balance. Launch EA with a polished slice, not everything rough — first-week impressions crystallize the algorithm and reviews.

**9.4 — Question-driven playtests with the right cohorts (Schell, Ch. 27 — merged)**
Every session answers written questions ("do players engage KPIs unprompted?", "does anyone pick melee and survive?"). Never ask testers to design ("should melee be buffed?") — ask for the three worst moments and "did that death feel unfair?". Cohorts: RoR2/L4D veterans AND genre novices with separate funnels, plus a standing repeat cohort (same people, 5–10 sessions) because a roguelite's product is run #20, and flow can't be judged in 10 minutes. Watch faces, not screens; predict expected behavior in advance so dominant-strategy surprises stand out.

**9.5 — Telemetry + one-line feedback box from v0.1 (Schell, Bererton; retention vocabulary)**
Auto-log per run: class, drafts offered vs taken, time per floor, death cause/position, combo peaks, KPIs, solo vs co-op. Define the dashboard before launch: D1/D7/D30, median runs per player, churn floor. Every patch answers a measured churn point, shipped every 2–4 weeks, each testing one hypothesis — never a big-bang update.

**9.6 — Read the community like a designer (Schell, the Client; pitch handles; eight filters)**
"Nerf the specials" is a proposed solution to an unstated problem (deaths feel unfair) — extract the problem, solve it your way, and keep a public "problem heard → change made" changelog. Lead the store page with the handle "Risk of Rain meets Left 4 Dead — in an office tower" and 10 seconds of raw wave combat; the office-satire fantasy is the USP no competitor owns. Gate 1.0 on the Eight Filters — any failed filter (perf, community, blind playtests, novelty, pitch-match) means not ready.

---

## TOP 10 Highest-Impact Recommendations (ranked)

1. **Externalize all tuning into hot-reload JSON + in-game debug panel, and instrument telemetry, in v0.1 — now.** Every other recommendation on this list is executed through iteration loops; this multiplies the number of loops you can afford for the entire EA period (Rule of the Loop).

2. **Pass the Toy Test before content: a no-objective sandbox floor must be fun for 10 minutes.** Enforce the 100ms input-response law, frame-1 attacks, multi-channel hit feedback (hitstop/flash/SFX/rumble), and SFX-first investment — audio is the cheapest perceived-quality multiplier. If the core isn't a toy, no loot or KPI system saves it.

3. **Vertical-slice Finance to true ship quality before mass-producing content, and write the cut-safe v1.0 scope today** (Cerny + 50% rules). This converts the roadmap from hope into arithmetic and guarantees something shippable if half the budget vanishes.

4. **Rebuild pacing as a fractal interest curve with protected power spikes:** wave crescendos (panic rule), elevator finales, director-enforced 30–60s rest valleys, difficulty-tick suppression for ~20s after drafts/drops, and a forced "security purge" climax capping runs at ~35–45 minutes.

5. **Wire the combo meter and KPI quests into survival and build power** (combo tier → drop rarity; KPIs → rerolls/slots/discounts) and verify with the detour test. Anything players won't detour for is Bubsy yarn — rewire or delete before adding new systems.

6. **Own the first 15 minutes:** 60-second gameplay hook before any menus, invisible tutorial across Floor 1, near-flat director for 5 minutes, explicit funnel targets (60% reach Floor 2). This window decides Steam refunds and day-1 reviews.

7. **Scale difficulty by composition, not HP:** tier mix (count → speed → variety), guard bars past the HP cap, curated spawn combos from behavior archetypes, and universal telegraphs + death recap so no death ever reads as unfair — the #1 review-poisoning phrase for roguelites.

8. **Make the end-of-run screen the retention engine:** Performance Review grades vs personal bests, near-miss framing, banked progress on every failure, open-loop teases, shareable run cards. Aspiration only — no hafta mechanics anywhere.

9. **Design the 6 new archetypes function-first with a fixed signature ability, three-word identity, one mechanical weakness, and distinct demanded skill lists;** make one a true ally-only support. This is what makes 12 classes read as 12 games instead of 12 hats.

10. **Protect the USP and gate 1.0 properly:** everything wears the corporate-satire skin (theme unity audit), the pitch is "Risk of Rain meets Left 4 Dead — in an office tower," feedback is read as problems-not-solutions with a public changelog, and Early Access exits only when all Eight Filters pass with mixed-cohort blind playtests.