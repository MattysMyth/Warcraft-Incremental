# Outpost of Azeroth: build handoff

Unofficial, non-commercial Warcraft-universe incremental game. The design lives in
the design doc (Claude Docs artifact "Outpost of Azeroth: Game Design Document").
This file records how the code is laid out and what each checkpoint left behind.

## How to resume in a new session

1. Read the design doc's checkpoint table and the newest handoff note below.
2. This folder is published beside the game as the artifact's supporting files.
   If the working folder is gone, read every file back from the published game
   artifact (Artifact tool, action "read", `paths`) into a new folder, keeping paths.
3. `npm install` (installs esbuild only), then:
   - `npm test` runs the Node tests (engine, combat, quests, save, data validator, town rules, pacing).
   - `npm run sim` prints the headless pacing simulation; `npm run sim -- --write`
     re-baselines `data/pacing-baseline.json` (only do this on purpose).
   - `npm run tune` rescales `data/townhall.json` so the simulated Town Hall schedule hits
     the target minutes in `sim/tune-townhall.js`; follow it with
     `npm run sim -- --hours=100 --write`. `sim/townhall-seed.json` is the untuned table.
   - `npm run play -- --hours=100 [--seed=N] [--no-rebuild] [--trace]` runs the full-game bot (`sim/bot.js`) on the real
     engine and prints milestone times; ~100 game hours takes about 40 s. `npm test` also runs two short bot checks.
   - `npm run build` writes `dist/index.html`, the single self-contained page.
4. Publish `dist/index.html` as the artifact page, with the sources as `files`
   (everything except node_modules and dist). Do not pass `capabilities`.

## Layout

| Path | Purpose |
| --- | --- |
| `data/*.json` | All balance numbers and content. No balance constants in code. `renown.json` holds the Renown curves, the 20-upgrade shop and the Rebuild/Scouts/Foundations settings; `zones.json` holds zones, gates, reputation tiers and sworn recruits; `crafting.json` the potions; story quests are templates in `quests.json` with a `story` block. |
| `src/engine/` | Pure game rules: `renown` (Renown gain, multiplier, shop bonuses; imported by derive/heroes/quests, so it depends only on data), `rebuild` (the Rebuild action, shop purchases, the starting town), `derive` (costs, income), `heroes` (stats, XP, recruit pool, gear, injury), `quests` (board, parties, rewards, loot, story notices, the running of standing orders), `orders` (making and changing orders), `zones` (open zones, reputation, perks, story chain, sworn recruits), `alchemy` (potion stock and brew queue), `combat` (the fight resolver and odds by simulation), `tick`, `offline`, `actions`, `save`, `numbers`, `rng`, `data` (+ validators), `state`. |
| `src/ui/` | DOM only, no rules. Elements are built once and patched. `app.js` holds the tab list; later checkpoints flip each tab's `unlocked` rule. |
| `src/main.js` | Boot, wall-clock loop, autosave, welcome-back card. |
| `src/storage.js` | Guarded localStorage access. |
| `test/` | `node --test` suites. |
| `sim/pacing.js` | Greedy-buyer simulation using the real engine. |
| `build.js`, `index.template.html` | esbuild bundle into one HTML page. |

Rules: state is one plain JSON object; engine functions are pure; actions return
`{ ok, state }` or `{ ok: false, error }`; derived values are never saved; new
save fields need a `normalize` default and, if the shape changes, an entry in
`MIGRATIONS` plus a `SAVE_VERSION` bump.

## Handoff notes (newest first)

### Checkpoint 10: Polish

Built: touch targets of at least 44 px on phones and touch screens (`@media (max-width: 759px), (pointer: coarse)` block at the end of
`styles.css`), a six-tab bottom bar that fits 320 px, and a fix for grid panels growing wider than the screen (`.panel` columns are
`minmax(0, 1fr)`). Settings (all in `state.settings`, validated in `SETTING_RULES` and `normalize`): `theme` (auto, dark, light, applied
as `data-theme`), `textSize` (normal, large; `body { zoom }`), `effects` (on, off), `scene` (on, off), `tutorial` (on, done), plus the
existing number format (new `grouped` option: 1,234 up to a million) and motion. Save version 10 (v9 -> v10 sets `tutorial` to done for
anyone who has built anything, has a hero or played over five minutes). Accessibility: skip link to `#panel-area`, `lang="en"`, visible
focus outline, a wider hit area for checkboxes (their labels), and state shown in words as well as colour (costs that are short end with
"(short)", full stores have a dashed border, running-out stores a dotted one). Tutorial (`src/ui/tutorial.js`): seven steps worked out from
state (Lumber Camp, Market, House, Town Hall 2, Tavern, first hero, first quest), each with a button to the right tab; only
`settings.tutorial` is saved. Town picture (`src/ui/scene-parts.js` pure SVG strings, `src/ui/scene.js` the card): original CSS and SVG that
adds houses, trees, stalls, fields, rocks, tavern, chapel, tower, tents, wall segments and the heroes at home as the town grows, a green
portal in the sky from Era 2, and a text caption (the picture is hidden from screen readers). Feedback (`src/ui/toasts.js`): short notices
for new event-log lines worth a notice (achievements, standing, zones opening, quests finished or failed, injuries, Rebuild, Era) and hero
level-ups; max three at once, 4.5 s each, no audio, off with Settings > Feedback.

Tools: `audit10.py` (360 px audit of every tab: sideways scroll, small targets, unnamed controls) and `smoke10.py` (24 browser checks)
in the session scratchpad.

Known gaps: toasts are only unit-reasoned, not triggered in the browser test. Large text uses `zoom` (supported by current Chrome,
Safari and Firefox). The tutorial text assumes the early game as it is today (start gold 10, Lumber Camp 8 gold). Colour contrast was
checked by eye, not with a tool. The Era 2 stub and the late-game balance notes from Checkpoints 8 and 9 still stand.

Tests: 216 passing (5 new in `test/polish.test.js`).

### Checkpoint 9: Legacy, the Epoch, Sands of Time and an Era 2 stub

Built: Prestige 2 and 3. `data/legacy.json` (gain, multiplier, raid points, heirs, 12 class talents and 6 town auras) and
`data/sands.json` (6 upgrades, `maxEra` 2), both checked by `validateLegacy` in `data.js`. `bonusOf` now reads all three shops
through `data.bonusSources` (an index by effect key), so every existing hook sees Renown, Legacy auras and Sands upgrades;
class talents (key `class`) are read by `classEffects` in `sheetOf`. Legacy (`src/engine/legacy.js`): retiring a hero of level 40+
(needs the Archives built this run, or any Legacy history) pays `floor((level-30)^1.5 x best gear tier / 10 x (1 + legacyBoost))`,
returns their gear to the bag, leaves standing orders and adds a Hall of Heroes entry (`state.hall`, newest 60 kept). Heirs
(`src/engine/heirs.js`) are derived from unclaimed Hall entries (newest 3), offered beside the Tavern pool as ids `heir-<hall id>`,
start at half the ancestor's level, cost 30% (`descendants.discount` 0.7 off) and carry `hero.ancestor` (+hp and +power).
Raid first clears per run pay `legacy.raidPoints` (quests.js); a template with `eraBoss: N` sets `prestige.bosses` to include
`eraN`. Multipliers: Legacy `1 + 0.005 x total^0.9`, Sands `1 + 0.05 x total^0.8`, both in `globalMultiplier`.
Epoch (`src/engine/epoch.js`): needs the current Era's boss down and `era < maxEra`; auto-retires heroes 40+, removes all
heroes and the bag, wipes Renown (balance, total, shop), resets the town and zone clears, keeps Legacy, Hall, Sands, zone
standing/story, achievements; pays `10 + sqrt(Legacy earned this Era)` Sands. Era 2 stub: hero level cap by Era
(`heroes.eraCaps` [60, 70], `heroCap(state)`), zone `hellfire` (era 2, levels 61-70, tier 7 gear, 3-step story, dungeon
`hellfire_ramparts` with `eraBoss: 2`, new Demons family) hidden until Era 2. Sands upgrades: second board (`boardSlots`,
`boardSize()`), Warden's Journal (`state.journal`, written in `advance`), Hourglass (`offlineRate` on non-full offline tiers),
Time's Keepsake (`townHall` head start), Legacy and Renown ledgers. Save version 9 (`era`, `hall`, `journal`, `counters.hall`,
`stats.epochs`, prestige `legacyTotal/legacyEra/legacyUpgrades/sandsTotal/sandsUpgrades/bosses`); v8 saves start in Era 1.
UI: `src/ui/legacy.js` (Retire, Legacy shop, Hall, Epoch, Sands shop) inside the Rebuild tab; heirs in the Tavern; ancestor on hero
cards; `src/ui/journal.js` in Settings; Era in the header kicker; Hellfire hidden before Era 2.

Known gaps and things to revisit: Era 2 is a stub (one zone, no Era-2 gear tier, the same raids), and after Era 2 the Epoch is
blocked ("the last Era written"). The Sands and Legacy numbers are first guesses and untuned by the bot (it does not retire or
Epoch). Sworn recruits can be hired again after their hero retires. After an Epoch the Heroes, Quests and Zones tabs stay hidden
until the first recruit. Retiring is permanent and gives no refund of talents.

Tests: 211 passing (16 new in `test/legacy.test.js`). Browser smoke test (`smoke9.py` in the session scratchpad) passed 20 checks.

### Checkpoint 8: Era 1 content, raids, achievements and balance

Built: the four remaining zones (Stranglethorn Vale 30-40, Swamp of Sorrows 40-50, Burning Steppes 50-60, Molten Core 60), each
with 5 bounties, 6 gathering trips, 3 slay and 2 escort templates, a 4-step story chain (Molten Core 3), headline delve, a perk
and two sworn recruits. Headlines: Zul'Gurub (raid), Temple of Atal'Hakkar (dungeon), Blackrock Depths (dungeon), Ragnaros
(raid, ends Era 1). Gear tiers 4-7 (`data/gear.json`, smith levels 36/46/56/62), 43 new enemy units in four new families
(trolls, dragonkin, blackrock, elementals). Content was generated by throwaway scripts; the JSON is the source of truth.

Engine: a new quest type `raid` (party 6 to 10, `data/quests.json` types.raid) that reuses the dungeon combat chain; `isDelve(type)`
in `data.js` is true for dungeon and raid and replaces every old `type === 'dungeon'` check. Zone gates may carry `townHall`
(Stranglethorn needs Town Hall 8, Molten Core 15). `recommendedFor(level)` in `quests.js` grows 1.1 per level to level 30 and
1.06 per level after (`recommended.kneeLevel/growthAfter`), because hero rating grows more slowly than 1.1 per level.
Town raids (`src/engine/raids.js`, `data/raids.json`): every 20-40 min a raid tests Defence (Wall and Watchtower level^1.6 x 28,
plus 35% of the rating of heroes at home) against a threat of 150 x 2^(tier-1) of the highest zone headline cleared this run;
a failed raid takes 6% of each raw stockpile (never gold or buildings). Raids begin after a tier 2 clear. Offline time lets at
most one raid land (`raids.budget`, set in `advance`, removed afterwards). The Wall and Watchtower is now a live building (TH 11,
kind `wall`). Achievements (`src/engine/achievements.js`, `data/achievements.json`): 34, each +1% to the global multiplier,
kept through a Rebuild, checked at the end of every tick; `state.achievements` maps id to play seconds. Save version 8
(`raids`, `achievements`); the Rebuild resets `raids` and keeps `achievements`.
UI: Defence card on the Town tab (`src/ui/defence.js`), Achievements card on Settings (`src/ui/achievements.js`).

Balance: `sim/bot.js` plays the whole game (`playGame`), `sim/play.js` is the CLI, `sim/pacing.js` exports `nextPurchase`. Early
tuning moved the Tavern to Town Hall 2 and Barracks and Chapel to Town Hall 3, cut recruit cost to 1,000 (growth 2.0), drill to 30 s,
quest xpDivisor to 4, Fargodeep Mine to 15 min, pinned each zone's headline dungeon on the board until first cleared, and lowered
the Renown divisor from 1e6 to 1e4 gold so the first advised Rebuild (gain 15) lands at about 2h50. Bot medians over eight seeds:
tavern open 9m50, first hero 10m15, Elwynn cleared 1h02, Westfall cleared 2h40, first Rebuild 2h48, Zul'Gurub 11-16h,
Ragnaros 49-123h on seeds that finish (a few seeds stall at an all-or-nothing odds cliff in the 5-hero dungeons or Ragnaros).

Known gaps and things to revisit: the bot's late game is brittle (small changes move Ragnaros by days; real players can do
better with potions and talents). Mithril is not in the game yet (arcane dust and iron bars cover tier 4+ crafting), Town Hall costs
still do not ask for boss trophies, raids give trophies but no Legacy points yet (Checkpoint 9), the raid is one 6-10 hero fight
rather than two separately commanded parties, and the Rebuild resets zone clears, so a rebuilt run clears the chain again
(Scouts' Maps skip the first few). The bot rebuilds whenever advised, which does not speed it up (Ragnaros lands at about the same
time with or without Rebuilds); the economy and difficulty may want Renown-scaled zones in Checkpoint 9.

Tests: 195 passing, including `test/era1.test.js` (zones, raids, achievements, save v8) and `test/play.test.js` (bot milestones).
Browser smoke test (Playwright, `smoke8.py` in the session scratchpad) passed 11 checks.

### Checkpoint 7: Rebuild, Renown and the Archives

Built: Prestige 1. `data/renown.json` has the gain curve (`floor(sqrt(run gold / 1e4))` since Checkpoint 8, was 1e6, plus 2% per Archives level,
rounded down), the multiplier (`1 + 0.02 x Renown^0.9`, matching the design's pacing table: 15 -> 1.23 up to 1920 -> 19.03) and
a shop of 20 upgrades in four branches (5 each). Each upgrade is `{id, branch, name, key, values[], cost{base,growth}}`:
`values[i]` is the total effect at level i+1, the price of level n+1 is `ceil(base x growth^n)`. `src/engine/renown.js`
has `bonusOf(state, key)`, which `derive`, `heroes`, `quests`, `zones` and `actions` read; `src/engine/rebuild.js` has
`rebuild`, `buyUpgrade`, `startingTown` and `startingResources`. UI: `src/ui/rebuild.js` (Rebuild tab, shown once the
run can earn 1 Renown or any Renown exists; two-step confirm; lands on Town afterwards).

Two Renown figures: `prestige.renown` is the balance to spend; `prestige.renownTotal` is everything earned and alone sets the
multiplier, so buying upgrades never weakens the town. `stats.lifetimeGold` is now the current run's gold (a Rebuild moves it
into `stats.pastGold`); `stats.runFrom` is `playSeconds` at the start of the run. Save version 7, migrated from 6.

Rebuild resets: resources (to 10 gold + Seed Purse), buildings, workers, residents, Town Hall (to 1 or Head Start), the Tavern
pool, the board, parties on the road (no reward), standing orders and focus, the board counter, dungeon clears and trophies
(Scouts' Maps re-clear the gate dungeons), the Alchemy stock and queue, injuries, run gold and run clock.
Keeps: heroes (levels, gear, talents, sworn), the bag, zone standing and story progress, the results record, settings,
the log (plus a Rebuild entry), counters, seed, lifetime stats, Renown, the shop, Legacy and Sands. A test lists every top-level
state key against these rules, so a new key must be given a Rebuild rule.

Archives: now a live building (kind `archives`, Town Hall 14): +2% Renown gain per level. Legacy arrives here in Checkpoint 9.

Decisions to keep or overturn:

- Zone standing and story progress survive a Rebuild (the design table lists "Zone clears and active quests" as reset and
  "Zone reputation perks" as kept, so I kept all reputation, not only the top-tier perk). Dungeon clears reset, so zones re-lock
  and gates must be re-cleared (or scouted).
- Heroes keep everything, but the Tavern resets, so with no Tavern the roster is over its cap (0) and no one new can be hired
  until the Tavern is rebuilt. Existing heroes still drill and quest.
- The design's "first-clear Renown bonus" is not built: dungeon first clears still pay their gold and standing bonuses each run.
- The shop is large: 2,725 Renown to buy everything against about 1,900 earned by the design's eighth Rebuild. Head Start (7 levels
  of Town Hall, 504 Renown) is the priciest. Prices and values are data only.
- `sim/pacing.js` is still a Market-only first-run model and does not play Rebuilds; the full headless pacing simulation is Checkpoint 8.
- The design says that if heroes keeping levels makes rebuilt runs too fast, zone difficulty can scale with Renown. That is not
  needed yet because there is no full simulation to say so; decide at Checkpoint 8.

### Checkpoint 6: zones, reputation, story, standing orders, potions

Built: three live zones (Elwynn 1-10, Westfall 10-20, Duskwood 20-30) and four planned cards (Stranglethorn,
Swamp of Sorrows, Burning Steppes, Molten Core) in `data/zones.json`. A zone opens when its gate dungeon is
cleared: Fargodeep Mine opens Westfall, The Deadmines opens Duskwood (Stitches, a "world boss" dungeon, is Duskwood's
headline). The board only rolls from open zones; the Zones tab can focus new notices on one zone
(`quests.focus`). Two new quest types: Slay (2 to 3 heroes, 5 to 40 min, XP and gear drops, 25% gold) and
Escort (1 to 2 heroes, 10 to 60 min, 50% gold, +10 standing). 63 templates, 24 new enemies in four new families.
Dungeons: The Deadmines (9 fights; Rhahk'Zor stacks a debuff, Edwin VanCleef calls guards and enrages) and Stitches
(5 fights; stack, add wave, enrage). Tank and healer matter in both (`sim/calibrate-zone-dungeon.mjs`).

Reputation: per-zone number in `zones[id].rep`; five tiers (data) raise gold and gathered resources
(x1.05 to x1.25) and loot luck; each zone has five titles and a top-tier perk (Elwynn +10% quest gold, Westfall +10%
gathered resources, Duskwood +10% hero XP). `zones[id].rep` is the data a Rebuild must keep (design: "reputation perks keep").
Story: each zone has a 3 to 4 step chain (templates with `story: {zone, step, rep, item?}`), pinned to the board in
order (they do not count toward the 8 places, cannot be taken down, and come back if failed); the last step of
Elwynn and Westfall and Duskwood's final step give a named item. Sworn recruits (six, `zones.json`) unlock by
finishing a story chain or reaching Trusted; hiring costs half the usual price and sets `hero.sworn`.
Standing orders (`quests.orders`): Barracks 1 gives one slot, +1 per 3 levels (max 4). "Repeat" makes a fresh standard
notice from a template each time the party is rested and the measured odds meet the order's safety line (0, 50, 70 or
90%); "Best available" (Barracks 3) takes the hardest board notice that meets the line. Orders can carry a potion
choice. Offline, a finished trip's overshoot is credited to the next trip. Alchemy Lab: four potions
(`data/crafting.json`) brewed from herbs and gold into a queue of 5; stock cap 6 + 2 per Lab level; Gnome heroes add
10% each (max 50%) to brew speed. A party drinks one potion per hero, chosen when sending it; the effect is in the saved
`run.units`, so replays and odds include it. Leather: new tier 2 resource from hunting quests; armour, bags and the
Stables now cost it. Save version 6, migrated from 5.

Decisions to keep or overturn:

- Standing orders need the Barracks, not a "Quest Board upgrade" (the board is not a building). Best-available orders
  need Barracks 3.
- Slay and Escort pay little gold (25% and 50%): slay is for XP and gear, escort for standing. Difficulty is 2.8 and 1.5
  (`sim/calibrate-types.mjs` shows rating versus the 70% line).
- The world boss is a single-party dungeon (3 to 5 heroes) for now; the design's two-party raid form waits for Checkpoint 8.
  Stitches is level 22 and needs roughly rare tier 2 gear (rating about 0.8 of recommended).
- Story quests are exempt from the board cap and from standing orders. Sworn recruit classes still need their building.
- Potions have no cap on use per quest beyond one per hero.
- Town Hall costs still do not ask for boss trophies; trophies are counted (`zones[id].trophies`) but unused.
- Recommended rating grows 1.1 per level, hero rating grows more slowly: at level 25 to 30 a geared hero is about
  at recommended, beyond level 35 it falls behind. Re-tune with the later zones at Checkpoint 8.
- `sim/pacing.js` still models Market income only; quest gold, reputation bonuses and potions are not in it.

Known gaps: no raids, no Rebuild, four zones are cards only, no ability-priority controls, potions are one-per-hero only.

Tests: 162 passing (`test/zones.test.js` covers gates, focus, quest types, reputation, perks, story, sworn recruits,
orders, potions, leather, save v6 and a long multi-zone run). Browser smoke test (28 checks) covers the Zones tab, story
status, focus, the story notice, potion picker, a repeat order, the Lab queue, leather costs, a version 5 save migrating,
and no sideways scroll at 390 px.

### Checkpoint 5: combat, dungeons and loot

Built: one seeded, deterministic tick resolver (`src/engine/combat.js`, rules in
`data/combat.json`, enemies in `data/enemies.json`) now decides every quest. Fights step in
0.5 s ticks; each unit acts when its attack timer runs out. Enemies hit whoever has the most
threat (Warrior 3x, Paladin 2x, others 1x; healing adds threat; Taunt forces a target for 6 s),
heroes hit the lowest-health enemy, healers heal the lowest-percentage ally. Each class has three
abilities (signature first): Warrior Taunt, Shield Wall, Cleave; Mage Fireball, Arcane Blast,
Chill; Rogue Backstab, Eviscerate, Evasion; Priest Heal, Power Shield, Smite; Hunter Multi-Shot,
Aimed Shot, Freezing Trap; Paladin Holy Light, Hammer of Justice, Judgement. A hero setting
"Save signature for boss fights" holds the first ability back for boss encounters.
Armour has diminishing returns (cap 75%); crit is capped by the hero sheet.
The odds shown on a notice are the share of wins over 24 simulated fights (16 for dungeons)
with other seeds; the real outcome is one more fight from `seedFrom(save seed, quest number, 404)`,
rolled when the party leaves. A run keeps a snapshot of its heroes' stats (`run.units`), so the
Fight view can replay the exact fight (`replayRun`) in step with the timer, with health bars and a
log. Enemy strength comes from the notice's recommended rating (`rec`), calibrated so that a
party whose rating equals `rec` wins about 70% of the time (see the sweep note below).
Dungeons are a new quest type (3 to 5 heroes; the board offers them once the roster has three). Fargodeep Mine
has 8 fights ending in Candlewick, Tunnel-Lord (add waves and an enrage); the mini-boss has a
stacking debuff that a Taunt swap resets. Dungeon clears pay gold, experience, 2 gear drops plus a boss
drop of at least Superior (rare); the first clear pays triple gold, an extra Heroic (epic) item and
records the dungeon in `zones.elwynn.cleared` with a boss trophy count. Bounties drop an item 12% of
the time. Gear is rolled for a random party member's class weights. A full bag sells spare gear.
Brigands steal up to 40% of a bounty's gold. Only the newest 6 results keep a combat log.
Save version 5, migrated from 4 (heroes get `saveSignature`, zones get `trophies`).

Decisions to keep or overturn:

- Quest outcomes now come from the resolver, not the rating estimate. Bounties and gathering use
  the same resolver as dungeons, because the outcome is rolled once when the party leaves, so
  offline catch-up never re-runs fights. The doc's "cheap analytic estimate" is therefore not used.
- Fights have per-encounter difficulty jitter (+/-15% on enemy health and damage) so odds are a
  gradient. Without it, outcomes were nearly all-or-nothing.
- A hero knocked out in a dungeon fight stands up between fights (30% health); only a full wipe
  fails the run. Everyone in a failed run is injured, as before.
- Dungeon party size is 3 to 5 (the doc said 5) so a roster of three can try it. Tank and healer
  matter: in the sweep a party without a healer almost never cleared Fargodeep Mine, a party of
  tank, healer and three damage dealers always did.
- Mana and energy are not modelled (the doc says "optional resource").
- Potions and per-hero ability priority slots are not built. The one control is the save-signature
  toggle (the doc's Mage example). Potions arrive with the Alchemy Lab in Checkpoint 6.
- Slay, Escort and Delivery quest types stay out until Checkpoint 6 (zones and content).
- The Deadmines and Westfall arrive in Checkpoint 6; Fargodeep Mine stands in as the first dungeon.
- Recommended ratings: bounty difficulty 1.0, gathering 0.6, dungeon 7.5 with enemy health x1.92 and
  damage x0.256 (long, slow fights where healing matters). Re-tune with the calibration scripts below.
- Quest XP: dungeon xpMult 0.15, gathering 0.3, bounty 1.0. Dungeon gold uses rewardMult 1.2.

Calibration scripts: `node sim/calibrate-solo.mjs` (win rate vs rating per class) and
`node sim/calibrate-dungeons.mjs <difficulty> <hpMult> <dpsMult>` (party compositions against Fargodeep Mine).
Method: build solo heroes of each class at levels 1 to 10
with a starter weapon, find the enemy budget multiple where win rate is 70%, and compare it with
`heroRating / rec`. With `hpPerRec` 5.2 and `dpsPerRec` 0.44 the two agree within about 10% for
Warrior, Mage, Rogue, Hunter and Paladin; a solo Priest is stronger than its rating (it heals itself).
Dungeons: a level-6 party with four common gear pieces each clears Fargodeep Mine with tank, healer
and three damage dealers; one gear piece each is about the threshold.

Known gaps: no raids (Checkpoint 8), no standing orders (Checkpoint 6), no potions, no ally resurrection
in a fight, one dungeon, one zone. `sim/pacing.js` still models Market income only.

Tests: 138 passing, including determinism (same seed, same log), role tests (healer, taunt), enrage and
time cap, a 5-hero 10-fight dungeon under 100 ms (about 1 ms measured), dungeon rewards and loot, the v4 to v5 migration
and save repairs. Browser smoke test (20 checks) covers the dungeon picker, odds text, the Fight view,
the combat log, the signature toggle, a two-hour offline dungeon clear in the welcome-back card, and
layout at 390 px and 1100 px in light and dark.

### Checkpoint 4: Quest Board

Built: the Quests tab (opens once there is a hero). The board holds up to 8 notices and gets
a new one every 3 minutes (3 on the first day, the first always a bounty). Two quest types:
Bounty (one hero, 45 s to 5 min, pays gold and experience) and Gathering (one or two heroes,
2 to 20 min, pays a resource; a second hero adds 50%). Modifiers (Elite, Swarm, Rush,
Bountiful, Remote) change time, difficulty and reward. Each notice shows its recommended
rating; the party picker shows the honest chance of success. The roll is fixed from the seed
when the party leaves. Failure pays nothing and injures the party (120 s rest, Chapel speeds it).
Quests run in real time, continue offline, and the welcome-back card lists what came home.
Stables are live (Town Hall 10): 3% shorter travel per level, max 60%. Save version 4,
migrated from 3. Engine: `src/engine/quests.js`; actions `dispatchQuest`, `recallQuest`,
`discardOffer`; data in `data/quests.json`; UI in `src/ui/quests.js`.

Decisions to keep or overturn:

- Success is an analytic estimate: sigmoid of (party rating / recommended rating). Party
  rating is power x haste x crit + 0.25 x healing + 0.05 x health. Checkpoint 5 replaces
  `successChance` with the combat resolver; `startRun` is the single call site.
- Standing orders (auto-repeat) are not built; the design doc ties them to a later
  Barracks / Board upgrade, so they move to Checkpoint 6.
- Quest rewards exist for Elwynn only (levels 1 to 10). Zones, loot drops and reputation
  come with Checkpoint 6.
- Experience falls off 15% per level a hero is over the quest, after a 2-level grace, down to 10%.
- The board is not tied to a building. Stables only shorten the road, not the reward.
- Hunger (food at zero) now slows quests to half speed, as the doc said.
- Drill was slowed from 30 s to 120 s base so quests are the better way to level. Drilling
  still stops at level 15, and heroes on a quest do not drill.
- Morale now includes wins: up to +0.1 from the last 10 results (a loss removes one).
- Rewards are a first guess: bounty gold is 600/min x 1.2^(level-1). A hero running bounties
  back to back adds roughly a quarter to a third of Market income mid-game. Re-tune with
  `npm run sim` once combat exists, and at Checkpoint 8.

Known gaps: no combat, dungeons, loot drops or standing orders; reward gold is not in the
pacing simulation yet (`sim/pacing.js` is Market-only).

Tests: 109 passing. Browser smoke test (Playwright, 23 checks) covers a fresh game, picker,
odds, sending, taking down, calling back, the Heroes tab status, Stables text, an hour
offline with the welcome-back summary, and layout at 390 px and 1100 px in light and dark.

### Checkpoint 3: Tavern and heroes

Built: Tavern, Barracks and Chapel are live buildings. Heroes have a race (Human, Dwarf,
Gnome, Night Elf), one of six classes, a trait, five stats, six gear slots, talents and an
injury timer. The Tavern holds a seeded recruit pool (size grows with Tavern level, renews
every 10 minutes or on request for gold); the roster is capped at 2 plus one per 3 Tavern
levels. Classes unlock by building: Warrior at the start, Rogue Tavern 3, Hunter Barracks 3,
Priest Chapel 1, Paladin Chapel 5, Mage Mage Tower 1. XP to the next level is
100 x L^1.8; health is (60 + 12L) x stamina_mod; morale (0.9 to 1.1) scales the five stats.
Gear: items have a tier, rarity and one or two stat lines; auto-equip picks the best by class
weights, a per-hero lock stops it, manual equip locks too. The Blacksmith forges gear for gold
and iron bars (tier 2 needs Blacksmith 10, tier 3 needs 25); the Market raises sell prices.
Every 10 levels a hero gets a talent point: pick one of the class's two perks (perks stack).
Save version 3, migrated from Checkpoint 2. Engine entry points: `src/engine/heroes.js`
(rules) and the hero functions at the end of `src/engine/actions.js`; data is in
`data/heroes.json` and `data/gear.json`.

Decisions to keep or overturn:

- (Superseded in Checkpoint 4: drill is slower, quests are the main route.) There were no quests, so idle heroes drill in the yard up to level 15 (`heroes.drill`
  in `data/heroes.json`). Quests in Checkpoint 4 replace this as the way to level further.
- Gear only comes from the Blacksmith (Town Hall 6) and the starter weapon each recruit
  brings. Quest and dungeon loot arrives with Checkpoints 4 and 5.
- Injury is a rest timer (120 s at 0.25x speed, up to 2x with a Chapel). Nothing injures a
  hero yet; `injureHero` is the hook combat will call.
- Morale has three parts: fed residents, Tavern level, and wins (win bonus is 0 until combat).
- Gnome's crafting speed bonus is stored but has no effect until crafting takes time.
- Recruit cost is 3000 gold x 2.2 per hero owned (x1.5 per starting level above 1); the
  Tavern costs 6000 gold at Town Hall 3. These are first guesses, to re-tune with quests.
- Hero combat stats (power, crit, haste, armour, threat, healing) are computed and shown but
  nothing uses them until Checkpoint 5.

Known gaps: no quests, combat or party logic; the Heroes tab is the only new tab.

Tests: 84 passing. Browser smoke tests (Playwright) cover a fresh game, a Checkpoint 2
save migrating, recruiting, refreshing the pool, equip, lock, forge, sell, talents and
layout at 390 px and 1100 px in light and dark.

### Checkpoint 2: Town Hall, housing, food, workers, storage

Built: Town Hall (levels 1 to 15) that gates every building and sets the level limit;
Houses and residents (settlers arrive every 20 s while there is room and 5 food in
store); food eaten at 0.1/s per resident; Workers (up to 5 per producing building,
+10% output each, taken from free residents); Warehouse caps on lumber, stone and food
(1000 base, x1.3 per Warehouse level); all 10 live buildings (Lumber Camp, Farm, House,
Market, Quarry, Warehouse, Mine, Blacksmith, Alchemy Lab, Mage Tower) plus six planned
ones shown as "not in this build yet"; resource bar with storage limits and hidden
tier 2 and 3 resources; income breakdown with uses (eating, smelting). Save version 2
with a migration from Checkpoint 1.

Decisions to keep or overturn:

- Market unlocks at Town Hall 1 (design doc said 3). The Market is the only gold
  source until quests exist; without it gold would stall.
- "Town Hall sets max buildings" is read as a level limit: every building may reach
  level 10 x Town Hall level.
- Town Hall costs are gold plus raw resources, tuned by `npm run tune` against
  Market-only income (about 99 h to Town Hall 15 in the simulation). Re-tune once quests
  add gold (Checkpoints 4 and 8). Trophy costs are deferred.
- Hunger: with food at zero and residents still eating, `questSpeedMultiplier` returns
  0.5. Quests do not exist yet, so this is a stub that only shows a warning.
- Planned buildings (Tavern, Barracks, Chapel, Stables, Wall and Watchtower, Archives)
  are listed but not buildable; each says which checkpoint adds it.
- Blacksmith smelts iron ore 2:1 into bars and is limited by ore in stock.

Measured pacing (greedy buyer, 100 h run): first Market 26 s, first resident 2 m 19 s,
Town Hall 2 at 5 m 47 s, 3 at 19 m, 4 at 44 m, 5 at 1 h 27 m, 6 at 2 h 57 m, 10 at
17 h 45 m, 15 at 99 h 36 m. 1 million lifetime gold at 2 h 57 m, 100 million at 73 h 50 m.
`data/pacing-baseline.json` holds the full marks; the test allows 15% drift.

Known gaps: no heroes, quests, combat or prestige yet. Tabs beyond Town and Settings
are hidden. Worker assignment is per building, not per hero.

Tests: 57 passing. Browser smoke test (Playwright) covered fresh game, a mid-game save,
a capped and hungry save, a late-game save, a Checkpoint 1 save migrating, worker
steppers, level-limit clamping, and no sideways scroll at 390 px and 1100 px in light
and dark.

### Checkpoint 1: skeleton and economy

Built: project layout, state and save (versioned, with migrations, export and import
strings, corrupt-save quarantine), seeded RNG, number formatter (suffix, scientific,
engineering), cost curve 1.15^n with milestone doubling at levels 10, 25 and 50, four
starter buildings (Lumber Camp, Market, Quarry, Farm), resource bar with income
breakdowns, buy 1, 10 or Max, tribute button, offline catch-up (100% for 2 h, 50% to
12 h, 10% to 7 days) with a welcome-back card, settings, bottom tab bar on phones.

Decisions to keep or overturn:

- The page is one bundled file (esbuild), a small change from the design doc's "no
  build step". Reason: one inline script is the most robust inside the artifact frame.
  Sources are published beside it.
- A starting purse of 10 gold, a 0.5 gold/s stipend and a small "Gather tribute"
  click (+1 gold) bootstrap the Market. The click is a default for the doc's open
  question on clicking; remove `tributeGold` in `data/economy.json` (set 0) and the
  button to drop it.
- Costs mix resources: Lumber Camp costs gold only, Market gold and lumber, Quarry
  and Farm gold and lumber. Raw-resource caps (Warehouse) are not in yet.
- Food accumulates but nothing uses it until residents arrive in Checkpoint 2. The
  Farm blurb says so.
- Theme follows the viewer (no in-game theme setting).

Measured pacing (greedy buyer, no clicking, Market is the only gold source):

| Milestone | Time |
| --- | --- |
| First Market | 26 s |
| Market level 10 | 2 m 17 s |
| All four buildings at level 10 | 1 h 20 m |
| Market level 50 | 29 m 49 s |
| 100 thousand lifetime gold | 22 m 49 s |
| 1 million lifetime gold | 1 h 20 m |
| 10 million lifetime gold | 8 h 31 m |

The design doc's pacing table came from a model where eight buildings all made gold.
Early numbers agree (100 thousand at about 24 min). Later ones are slower here because
only the Market makes gold; quests (Checkpoint 4) add gold. Re-check at Checkpoint 8.

Known gaps: no Town Hall gating, residents, caps or raids yet (Checkpoint 2). Only
Town and Settings tabs exist.

Tests: 36 passing (`npm test`). A browser smoke test (Playwright) also passed 21
checks: buy, tribute, income breakdown, reload persistence, export and import, erase,
offline welcome card, number formats, corrupt-save quarantine, no sideways scroll at
390 px and 1100 px in light and dark.
