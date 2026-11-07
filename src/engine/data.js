import economy from '../../data/economy.json' with { type: 'json' };
import resources from '../../data/resources.json' with { type: 'json' };
import buildings from '../../data/buildings.json' with { type: 'json' };
import townHall from '../../data/townhall.json' with { type: 'json' };
import heroes from '../../data/heroes.json' with { type: 'json' };
import gear from '../../data/gear.json' with { type: 'json' };
import quests from '../../data/quests.json' with { type: 'json' };
import combat from '../../data/combat.json' with { type: 'json' };
import enemies from '../../data/enemies.json' with { type: 'json' };
import zonesData from '../../data/zones.json' with { type: 'json' };
import crafting from '../../data/crafting.json' with { type: 'json' };
import renown from '../../data/renown.json' with { type: 'json' };
import raids from '../../data/raids.json' with { type: 'json' };
import achievements from '../../data/achievements.json' with { type: 'json' };
import legacy from '../../data/legacy.json' with { type: 'json' };
import sands from '../../data/sands.json' with { type: 'json' };
import engage from '../../data/engage.json' with { type: 'json' };

export const BUILDING_KINDS = ['wall', 'producer', 'converter', 'house', 'warehouse', 'tavern', 'barracks', 'chapel', 'stables', 'archives', 'planned'];

function bonusSources(renown, legacy, sands) {
  const out = {};
  const add = (list, field) => { for (const up of list) (out[up.key] ??= []).push({ up, field }); };
  add(renown.upgrades, 'upgrades');
  add(legacy.upgrades.filter((u) => u.key !== 'class'), 'legacyUpgrades');
  add(sands.upgrades, 'sandsUpgrades');
  return out;
}

// Dungeons and raids share one shape: a chain of encounters with a boss at the end.
export const isDelve = (type) => type === 'dungeon' || type === 'raid';

export const DATA = {
  economy,
  resources,
  buildings,
  townHall,
  heroes,
  gear,
  quests,
  combat,
  enemies,
  zonesData,
  crafting,
  renown,
  raids,
  achievements,
  legacy,
  sands,
  engage,
  edictById: Object.fromEntries(engage.edicts.list.map((e) => [e.id, e])),
  eventById: Object.fromEntries(engage.events.list.map((e) => [e.id, e])),
  legacyById: Object.fromEntries(legacy.upgrades.map((u) => [u.id, u])),
  sandsById: Object.fromEntries(sands.upgrades.map((u) => [u.id, u])),
  // Every shop upgrade that carries a given effect key, with the part of the save that holds its level.
  bonusSources: bonusSources(renown, legacy, sands),
  classTalents: Object.fromEntries(heroes.classes.map((c) => [c.id, legacy.upgrades.filter((u) => u.key === 'class' && u.group === c.id)])),
  achievementById: Object.fromEntries(achievements.list.map((a) => [a.id, a])),
  renownById: Object.fromEntries(renown.upgrades.map((u) => [u.id, u])),
  zoneList: zonesData.zones.filter((z) => !z.planned),
  plannedZones: zonesData.zones.filter((z) => z.planned),
  recruitById: Object.fromEntries(zonesData.recruits.map((r) => [r.id, r])),
  potionById: Object.fromEntries(crafting.potions.map((p) => [p.id, p])),
  enemyById: Object.fromEntries(enemies.units.map((u) => [u.id, u])),
  templateById: Object.fromEntries(quests.templates.map((t) => [t.id, t])),
  modifierById: Object.fromEntries(quests.modifiers.map((m) => [m.id, m])),
  zoneById: Object.fromEntries(zonesData.zones.filter((z) => !z.planned).map((z) => [z.id, z])),
  classById: Object.fromEntries(heroes.classes.map((c) => [c.id, c])),
  raceById: Object.fromEntries(heroes.races.map((r) => [r.id, r])),
  traitById: Object.fromEntries(heroes.traits.map((t) => [t.id, t])),
  statIds: heroes.stats.map((x) => x.id),
  slotById: Object.fromEntries(gear.slots.map((x) => [x.id, x])),
  tierById: Object.fromEntries(gear.tiers.map((x) => [x.tier, x])),
  rarityById: Object.fromEntries(gear.rarities.map((x) => [x.id, x])),
  resourceById: Object.fromEntries(resources.map((r) => [r.id, r])),
  buildingById: Object.fromEntries(buildings.map((b) => [b.id, b])),
};

// Buildings the player can actually build in this release.
export const isLive = (def) => def.kind !== 'planned';
export const liveBuildings = (data = DATA) => data.buildings.filter(isLive);
// Producers and converters have an output and can take workers.
export const isWorkplace = (def) => def.kind === 'producer' || def.kind === 'converter';

export function townHallCost(level, data = DATA) {
  return data.townHall.levels.find((l) => l.level === level)?.cost ?? null;
}

// Resources that can be obtained once every live building unlocked at or below
// `townHallLevel` exists, ignoring `exceptId` (a building cannot pay for itself).
export function producibleAt(townHallLevel, data = DATA, exceptId = null) {
  const have = new Set(['gold']);
  const builds = data.buildings.filter((b) => isLive(b) && b.unlockTownHall <= townHallLevel && b.id !== exceptId);
  // Heroes bring back resources from gathering quests once a Tavern is open.
  const tavern = data.buildings.find((b) => b.kind === 'tavern');
  if (tavern && townHallLevel >= tavern.unlockTownHall) {
    for (const t of data.quests?.templates ?? []) if (t.type === 'gathering' && !t.requires) have.add(t.resource);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const b of builds) {
      if (!b.produces || have.has(b.produces)) continue;
      if (b.kind === 'converter' && !have.has(b.from)) continue;
      have.add(b.produces);
      changed = true;
    }
  }
  return have;
}

// Returns a list of human-readable problems. Empty list means the data is sound.
export function validateData(data = DATA) {
  const problems = [];
  const { economy: eco, resources: res, buildings: bld, townHall: th } = data;
  const ids = new Set();
  const resIds = new Set(res.map((r) => r.id));
  const positive = (x) => Number.isFinite(x) && x > 0;

  if (!(eco.costGrowth > 1)) problems.push('economy.costGrowth must be greater than 1');
  if (!Array.isArray(eco.milestones) || eco.milestones.some((m, i, a) => !(m > 0) || (i && m <= a[i - 1]))) {
    problems.push('economy.milestones must be a strictly increasing list of positive levels');
  }
  if (!(eco.milestoneMultiplier >= 1)) problems.push('economy.milestoneMultiplier must be at least 1');
  if (!(eco.tickSeconds > 0)) problems.push('economy.tickSeconds must be positive');
  if (!(eco.offlineChunkSeconds > 0)) problems.push('economy.offlineChunkSeconds must be positive');
  if (!Array.isArray(eco.offlineTiers) || !eco.offlineTiers.length) {
    problems.push('economy.offlineTiers needs at least one tier');
  } else {
    eco.offlineTiers.forEach((t, i, a) => {
      if (!(t.upToSeconds > 0) || (i && t.upToSeconds <= a[i - 1].upToSeconds)) {
        problems.push(`economy.offlineTiers[${i}].upToSeconds must increase`);
      }
      if (!(t.rate >= 0 && t.rate <= 1)) problems.push(`economy.offlineTiers[${i}].rate must be 0 to 1`);
    });
  }
  for (const [id, amount] of Object.entries(eco.startingResources ?? {})) {
    if (!resIds.has(id)) problems.push(`economy.startingResources names unknown resource "${id}"`);
    if (!(amount >= 0)) problems.push(`economy.startingResources.${id} must not be negative`);
  }
  if (!positive(eco.caps?.base)) problems.push('economy.caps.base must be positive');
  if (!(eco.caps?.perWarehouseLevel >= 1)) problems.push('economy.caps.perWarehouseLevel must be at least 1');
  if (!(eco.housing?.base >= 0) || !positive(eco.housing?.perHouseLevel)) problems.push('economy.housing needs base and perHouseLevel');
  if (!positive(eco.residents?.arrivalSeconds)) problems.push('economy.residents.arrivalSeconds must be positive');
  if (!(eco.residents?.arrivalFood >= 0)) problems.push('economy.residents.arrivalFood must not be negative');
  if (!(eco.residents?.foodPerSecEach >= 0)) problems.push('economy.residents.foodPerSecEach must not be negative');
  if (!Number.isInteger(eco.workers?.maxPerBuilding) || eco.workers.maxPerBuilding < 0) problems.push('economy.workers.maxPerBuilding must be a whole number');
  if (!(eco.workers?.bonusEach >= 0)) problems.push('economy.workers.bonusEach must not be negative');
  if (!positive(eco.workers?.levelsPerExtraSlot) || !Number.isInteger(eco.workers?.maxExtraSlots) || eco.workers.maxExtraSlots < 0 || !(eco.workers?.extraBonusEach >= 0)) problems.push('economy.workers needs levelsPerExtraSlot, maxExtraSlots and extraBonusEach');
  if (!Number.isInteger(eco.levelsPerTownHall) || eco.levelsPerTownHall < 1) problems.push('economy.levelsPerTownHall must be a whole number');
  if (!(eco.hungerQuestSpeed >= 0 && eco.hungerQuestSpeed <= 1)) problems.push('economy.hungerQuestSpeed must be 0 to 1');

  for (const r of res) {
    if (ids.has(`r:${r.id}`)) problems.push(`duplicate resource id "${r.id}"`);
    ids.add(`r:${r.id}`);
    if (typeof r.capped !== 'boolean') problems.push(`resource "${r.id}" needs capped true or false`);
  }

  const maxTh = th?.maxLevel;
  if (!Number.isInteger(maxTh) || maxTh < 2) problems.push('townHall.maxLevel must be a whole number of at least 2');

  for (const b of bld) {
    if (ids.has(`b:${b.id}`)) problems.push(`duplicate building id "${b.id}"`);
    ids.add(`b:${b.id}`);
    if (!BUILDING_KINDS.includes(b.kind)) problems.push(`building "${b.id}" has unknown kind "${b.kind}"`);
    if (!b.name || !b.blurb) problems.push(`building "${b.id}" needs a name and a blurb`);
    if (!Number.isInteger(b.unlockTownHall) || b.unlockTownHall < 1 || (maxTh && b.unlockTownHall > maxTh)) {
      problems.push(`building "${b.id}" needs unlockTownHall between 1 and ${maxTh}`);
    }
    if (b.kind === 'planned') {
      if (!b.arrivesIn) problems.push(`planned building "${b.id}" needs arrivesIn`);
      continue;
    }
    if (b.kind === 'producer' || b.kind === 'converter') {
      if (!resIds.has(b.produces)) problems.push(`building "${b.id}" produces unknown resource "${b.produces}"`);
      if (!(b.rate > 0)) problems.push(`building "${b.id}" needs a positive rate`);
    }
    if (b.kind === 'converter') {
      if (!resIds.has(b.from)) problems.push(`converter "${b.id}" uses unknown resource "${b.from}"`);
      if (!(b.ratio > 0)) problems.push(`converter "${b.id}" needs a positive ratio`);
    }
    const costEntries = Object.entries(b.cost ?? {});
    if (!costEntries.length) problems.push(`building "${b.id}" needs a cost`);
    const obtainable = producibleAt(b.unlockTownHall, data, b.id);
    for (const [id, amount] of costEntries) {
      if (!resIds.has(id)) problems.push(`building "${b.id}" costs unknown resource "${id}"`);
      else if (!obtainable.has(id)) problems.push(`building "${b.id}" costs ${id}, which cannot be obtained by Town Hall ${b.unlockTownHall}`);
      if (!(amount > 0)) problems.push(`building "${b.id}" cost of ${id} must be positive`);
    }
  }

  const levels = th?.levels ?? [];
  if (Number.isInteger(maxTh)) {
    for (let L = 2; L <= maxTh; L += 1) {
      const entry = levels.find((e) => e.level === L);
      if (!entry) { problems.push(`townHall has no cost for level ${L}`); continue; }
      const obtainable = producibleAt(L - 1, data);
      for (const [id, amount] of Object.entries(entry.cost ?? {})) {
        if (!resIds.has(id)) problems.push(`Town Hall ${L} costs unknown resource "${id}"`);
        else if (!obtainable.has(id)) problems.push(`Town Hall ${L} costs ${id}, which cannot be obtained by Town Hall ${L - 1}`);
        if (!(amount > 0)) problems.push(`Town Hall ${L} cost of ${id} must be positive`);
      }
      if (!Object.keys(entry.cost ?? {}).length) problems.push(`Town Hall ${L} needs a cost`);
    }
  }

  if (data.heroes && data.gear) problems.push(...validateHeroes(data));
  if (data.quests) problems.push(...validateQuests(data));
  if (data.combat && data.enemies && data.heroes) problems.push(...validateCombat(data));
  if (data.zonesData && data.quests) problems.push(...validateZones(data));
  if (data.crafting) problems.push(...validateCrafting(data));
  if (data.renown) problems.push(...validateRenown(data));
  if (data.raids) problems.push(...validateRaids(data));
  if (data.achievements) problems.push(...validateAchievements(data));
  if (data.legacy && data.sands) problems.push(...validateLegacy(data));
  if (data.engage) problems.push(...validateEngage(data));
  return problems;
}

// Checks for data/heroes.json and data/gear.json.
export function validateHeroes(data = DATA) {
  const problems = [];
  const { heroes: hd, gear: gd } = data;
  const stats = hd.stats.map((x) => x.id);
  const positive = (x) => Number.isFinite(x) && x > 0;
  const effectKeys = ['hp', 'power', 'crit', 'healing', 'threat', 'armour', 'haste', 'regen', 'xp', 'recovery', 'morale', 'craft'];
  const checkEffect = (label, effect) => {
    for (const [k, v] of Object.entries(effect ?? {})) {
      if (!effectKeys.includes(k)) problems.push(`${label} has unknown effect "${k}"`);
      if (!Number.isFinite(v)) problems.push(`${label} effect "${k}" must be a number`);
    }
  };
  if (!Array.isArray(hd.eraCaps) || !hd.eraCaps.length || hd.eraCaps[0] !== hd.maxLevel || hd.eraCaps.some((c, i, a) => !Number.isInteger(c) || (i && c <= a[i - 1]))) problems.push('heroes.eraCaps must start at maxLevel and rise each Era');
  if (!Number.isInteger(hd.maxLevel) || hd.maxLevel < 2) problems.push('heroes.maxLevel must be a whole number of at least 2');
  if (!positive(hd.xp?.base) || !positive(hd.xp?.exp)) problems.push('heroes.xp needs a positive base and exp');
  if (!positive(hd.recruit?.cost) || !(hd.recruit?.growth >= 1)) problems.push('heroes.recruit needs a positive cost and a growth of at least 1');
  if (!Number.isInteger(hd.roster?.base) || hd.roster.base < 1 || !positive(hd.roster?.levelsPerSlot)) problems.push('heroes.roster needs a base of at least 1 and levelsPerSlot');
  if (!Number.isInteger(hd.pool?.base) || hd.pool.base < 1 || !(hd.pool?.max >= hd.pool?.base) || !positive(hd.pool?.seconds)) problems.push('heroes.pool needs base, max (not below base) and seconds');
  if (!positive(hd.drill?.seconds) || !(hd.drill?.maxLevel >= 1)) problems.push('heroes.drill needs seconds and maxLevel');
  if (!positive(hd.injury?.restSeconds) || !positive(hd.injury?.restRateBase)) problems.push('heroes.injury needs restSeconds and restRateBase');
  if (!(hd.morale?.base > 0 && hd.morale.base + hd.morale.fed + hd.morale.tavernMax + hd.morale.winsMax <= 1.1 + 1e-9)) problems.push('heroes.morale parts must add up to at most 1.1');
  if (!Number.isInteger(hd.talentEvery) || hd.talentEvery < 1) problems.push('heroes.talentEvery must be a whole number');

  const seen = new Set();
  for (const c of hd.classes) {
    if (seen.has(c.id)) problems.push(`duplicate class id "${c.id}"`);
    seen.add(c.id);
    for (const key of ['base', 'growth', 'weights']) {
      for (const st of stats) if (!(c[key]?.[st] >= 0)) problems.push(`class "${c.id}" needs ${key}.${st} (zero or more)`);
    }
    if (!stats.includes(c.primary)) problems.push(`class "${c.id}" has unknown primary stat "${c.primary}"`);
    if (!positive(c.threat)) problems.push(`class "${c.id}" needs a positive threat`);
    if (c.unlock) {
      const b = data.buildings.find((x) => x.id === c.unlock.building);
      if (!b || b.kind === 'planned') problems.push(`class "${c.id}" is unlocked by "${c.unlock.building}", which is not a live building`);
      if (!Number.isInteger(c.unlock.level) || c.unlock.level < 1) problems.push(`class "${c.id}" unlock level must be a whole number`);
    }
    if (!Array.isArray(c.perks) || c.perks.length !== 2) problems.push(`class "${c.id}" needs exactly two perks`);
    for (const perk of c.perks ?? []) checkEffect(`perk "${perk.id}"`, perk.effect);
  }
  if (!hd.classes.some((c) => !c.unlock)) problems.push('at least one class must be available from the start');
  for (const r of hd.races) {
    checkEffect(`race "${r.id}"`, r.effect);
    if (!r.names?.first?.length || !r.names?.last?.length) problems.push(`race "${r.id}" needs first and last names`);
    for (const st of Object.keys(r.statMult ?? {})) if (!stats.includes(st)) problems.push(`race "${r.id}" scales unknown stat "${st}"`);
  }
  for (const t of hd.traits) checkEffect(`trait "${t.id}"`, t.effect);

  if (!gd.slots.length) problems.push('gear needs at least one slot');
  for (const sl of gd.slots) {
    if (!positive(sl.share) || !positive(sl.craft)) problems.push(`slot "${sl.id}" needs a positive share and craft factor`);
    const names = gd.names?.[sl.id];
    if (!names || names.length < gd.tiers.length || names.some((n) => !n.length)) problems.push(`slot "${sl.id}" needs item names for every tier`);
  }
  gd.tiers.forEach((t, i) => {
    if (t.tier !== i + 1) problems.push('gear tiers must be numbered 1, 2, 3 in order');
    if (!positive(t.budget) || !positive(t.craftMult) || !(t.reqLevel >= 1) || !(t.smithLevel >= 1)) problems.push(`gear tier ${t.tier} needs budget, craftMult, reqLevel and smithLevel`);
  });
  gd.rarities.forEach((r, i, a) => {
    if (!positive(r.mult)) problems.push(`rarity "${r.id}" needs a positive mult`);
    if (i && !(r.above > a[i - 1].above)) problems.push(`rarity "${r.id}" must start above the previous rarity`);
    if (!(r.lines?.[0] >= 1 && r.lines[1] >= r.lines[0] && r.lines[1] <= stats.length)) problems.push(`rarity "${r.id}" has an invalid line count`);
  });
  if (gd.rarities[0]?.above !== 0) problems.push('the first rarity must start at 0');
  if (!(gd.twoLineShare > 0 && gd.twoLineShare <= 1)) problems.push('gear.twoLineShare must be between 0 and 1');
  for (const id of Object.keys(gd.craft ?? {})) {
    if (!data.resourceById[id]) problems.push(`gear.craft costs unknown resource "${id}"`);
  }
  if (!positive(gd.sell?.goldPerPoint)) problems.push('gear.sell.goldPerPoint must be positive');
  if (!Number.isInteger(gd.inventoryCap) || gd.inventoryCap < 1) problems.push('gear.inventoryCap must be a whole number');
  return problems;
}

// Checks for data/quests.json.
export function validateQuests(data = DATA) {
  const problems = [];
  const q = data.quests;
  const positive = (x) => Number.isFinite(x) && x > 0;
  if (!Number.isInteger(q.board?.size) || q.board.size < 1) problems.push('quests.board.size must be a whole number');
  if (!positive(q.board?.refreshSeconds)) problems.push('quests.board.refreshSeconds must be positive');
  if (!(q.board?.startOffers >= 0 && q.board.startOffers <= q.board.size)) problems.push('quests.board.startOffers must fit on the board');
  if (!positive(q.recommended?.base) || !(q.recommended?.growth >= 1) || (q.recommended.growthAfter !== undefined && !(q.recommended.growthAfter >= 1))) problems.push('quests.recommended needs a base and a growth of at least 1');
  if (!positive(q.reward?.goldPerMinute) || !(q.reward?.goldGrowth >= 1) || !positive(q.reward?.xpDivisor)) problems.push('quests.reward needs goldPerMinute, goldGrowth and xpDivisor');
  if (!(q.stables?.perLevel >= 0) || !(q.stables?.max >= 0 && q.stables.max < 1)) problems.push('quests.stables needs perLevel and a max below 1');
  if (!Array.isArray(q.levelSpread) || q.levelSpread.length !== 2 || q.levelSpread[0] > q.levelSpread[1]) problems.push('quests.levelSpread must be [low, high]');
  const o = q.orders;
  if (!o || !(o.barracks >= 1) || !(o.smartBarracks >= o.barracks) || !positive(o.levelsPerSlot) || !(o.maxSlots >= 1) || !positive(o.retrySeconds)) problems.push('quests.orders needs barracks, smartBarracks, levelsPerSlot, maxSlots and retrySeconds');
  else if (!Array.isArray(o.minOdds) || !o.minOdds.includes(o.defaultMinOdds)) problems.push('quests.orders.defaultMinOdds must be one of minOdds');
  const typeIds = Object.keys(q.types ?? {});
  for (const [id, t] of Object.entries(q.types ?? {})) {
    if (!(t.party?.[0] >= 1 && t.party[1] >= t.party[0] && t.party[1] <= 10)) problems.push(`quest type "${id}" needs a party of 1 to 10`);
    if (!(t.duration?.[0] > 0 && t.duration[1] >= t.duration[0])) problems.push(`quest type "${id}" needs a duration range`);
    if (!positive(t.difficulty)) problems.push(`quest type "${id}" needs a positive difficulty`);
    if (!positive(t.xpMult)) problems.push(`quest type "${id}" needs a positive xpMult`);
    if (!(t.goldMult >= 0)) problems.push(`quest type "${id}" needs a goldMult`);
    if (isDelve(id) && !positive(t.rewardMult)) problems.push(`quest type "${id}" needs a positive rewardMult`);
  }
  const zoneIds = new Set();
  for (const z of data.zoneList) {
    if (zoneIds.has(z.id)) problems.push(`duplicate zone id "${z.id}"`);
    zoneIds.add(z.id);
    if (!(z.levels?.[0] >= 1 && z.levels[1] >= z.levels[0])) problems.push(`zone "${z.id}" needs a level range`);
    if (!data.tierById?.[z.tier]) problems.push(`zone "${z.id}" needs a gear tier that exists`);
  }
  const seen = new Set();
  for (const m of q.modifiers) {
    if (seen.has(m.id)) problems.push(`duplicate modifier id "${m.id}"`);
    seen.add(m.id);
    if (!positive(m.weight) || !positive(m.duration) || !positive(m.rec) || !positive(m.reward)) problems.push(`modifier "${m.id}" needs positive weight, duration, rec and reward`);
    for (const t of m.types ?? []) if (!typeIds.includes(t)) problems.push(`modifier "${m.id}" names unknown type "${t}"`);
  }
  const tseen = new Set();
  for (const t of q.templates) {
    if (tseen.has(t.id)) problems.push(`duplicate quest template id "${t.id}"`);
    tseen.add(t.id);
    if (!typeIds.includes(t.type)) problems.push(`template "${t.id}" has unknown type "${t.type}"`);
    if (!isDelve(t.type) && q.types[t.type] && t.enemies && t.requires?.heroes && t.requires.heroes < q.types[t.type].party[0]) problems.push(`template "${t.id}" requires fewer heroes than its type's party minimum`);
    if (!zoneIds.has(t.zone)) problems.push(`template "${t.id}" has unknown zone "${t.zone}"`);
    if (!t.title || !t.text) problems.push(`template "${t.id}" needs a title and text`);
    if (t.type === 'gathering') {
      if (!data.resourceById[t.resource]) problems.push(`template "${t.id}" gathers unknown resource "${t.resource}"`);
      else if (!(q.gather?.base?.[t.resource] > 0)) problems.push(`quests.gather.base needs an amount for "${t.resource}"`);
    }
    if (t.requires?.building) {
      const b = data.buildings.find((x) => x.id === t.requires.building);
      if (!b || b.kind === 'planned') problems.push(`template "${t.id}" requires "${t.requires.building}", which is not a live building`);
    }
    if (t.requires && !t.requires.building && !(t.requires.heroes >= 1)) problems.push(`template "${t.id}" has a requirement it cannot check`);
    const groups = isDelve(t.type) ? (t.encounters ?? []).map((e) => e.enemies) : [t.enemies];
    if (!groups.length || groups.some((g) => !Array.isArray(g) || !g.length)) problems.push(`template "${t.id}" needs enemies`);
    for (const g of groups) for (const e of g ?? []) {
      if (data.enemies && !data.enemyById[e.id]) problems.push(`template "${t.id}" names unknown enemy "${e.id}"`);
      if (!(e.n >= 1)) problems.push(`template "${t.id}" needs a count for "${e.id}"`);
    }
    if (isDelve(t.type)) {
      if (!(t.level >= 1) || !positive(t.duration)) problems.push(`dungeon "${t.id}" needs a level and a duration`);
      if (!(t.encounters ?? []).some((e) => e.boss)) problems.push(`dungeon "${t.id}" needs a boss encounter`);
      if (!t.encounters?.at(-1)?.boss) problems.push(`dungeon "${t.id}" must end with a boss`);
      for (const e of t.encounters ?? []) if (!positive(e.budget)) problems.push(`dungeon "${t.id}" encounter "${e.name}" needs a budget`);
    }
    if (!q.modifiers.some((m) => m.types.includes(t.type))) problems.push(`no modifier fits quest type "${t.type}"`);
    if (!q.modifiers.some((m) => m.id === 'standard' && m.types.includes(t.type))) problems.push(`the standard modifier must fit quest type "${t.type}"`);
    if (t.weight != null && !positive(t.weight)) problems.push(`template "${t.id}" needs a positive weight`);
    if (t.story) {
      if (isDelve(t.type)) problems.push(`story quest "${t.id}" cannot be a dungeon`);
      if (!(t.level >= 1) || !positive(t.duration)) problems.push(`story quest "${t.id}" needs a fixed level and duration`);
      const z = data.zoneById[t.zone];
      if (z && (t.level < z.levels[0] || t.level > z.levels[1])) problems.push(`story quest "${t.id}" level is outside its zone`);
      if (t.story.zone !== t.zone) problems.push(`story quest "${t.id}" names a different zone than its template`);
      if (!(t.story.rep >= 0)) problems.push(`story quest "${t.id}" needs a rep reward`);
      if (t.story.item && (!data.slotById[t.story.item.slot] || !data.rarityById[t.story.item.rarity] || !t.story.item.name)) problems.push(`story quest "${t.id}" has a bad item reward`);
    }
  }
  for (const z of data.zoneList) {
    for (const type of typeIds) {
      if (!isDelve(type) && !q.templates.some((t) => t.zone === z.id && t.type === type && !t.requires)) problems.push(`zone "${z.id}" needs at least one ${type} template without a building requirement`);
    }
  }
  return problems;
}

// Checks for data/combat.json and data/enemies.json.
export function validateCombat(data = DATA) {
  const problems = [];
  const c = data.combat;
  const positive = (x) => Number.isFinite(x) && x > 0;
  for (const key of ['tick', 'attackSeconds', 'maxFightSeconds', 'critMult']) if (!positive(c[key])) problems.push(`combat.${key} must be positive`);
  if (!(c.variance >= 0 && c.variance < 1)) problems.push('combat.variance must be between 0 and 1');
  if (!positive(c.enemy?.hpPerRec) || !positive(c.enemy?.dpsPerRec)) problems.push('combat.enemy needs hpPerRec and dpsPerRec');
  if (!(c.armour?.cap > 0 && c.armour.cap < 1) || !positive(c.armour?.ref)) problems.push('combat.armour needs a ref and a cap below 1');
  if (!(c.between?.recoverHp >= 0 && c.between?.reviveHp > 0 && c.between.reviveHp <= 1)) problems.push('combat.between needs recoverHp and reviveHp');
  if (!(c.odds?.samples >= 1 && c.odds?.dungeonSamples >= 1)) problems.push('combat.odds needs sample counts');
  const kinds = ['taunt', 'burst', 'multi', 'opener', 'heal', 'shield_heal', 'absorb', 'mitigate', 'stun', 'slow'];
  for (const cls of data.heroes.classes) {
    const spec = c.classes?.[cls.id];
    if (!spec) { problems.push(`class "${cls.id}" has no combat data`); continue; }
    if (!['attack', 'heal'].includes(spec.basic?.type) || !positive(spec.basic?.mult)) problems.push(`class "${cls.id}" needs a basic action`);
    if (!Array.isArray(spec.abilities) || spec.abilities.length !== 3) { problems.push(`class "${cls.id}" needs exactly three abilities`); continue; }
    if (spec.abilities[0].name !== cls.ability.name) problems.push(`class "${cls.id}" must list its signature ability "${cls.ability.name}" first`);
    for (const a of spec.abilities) {
      if (!kinds.includes(a.kind)) problems.push(`ability "${a.id}" has unknown kind "${a.kind}"`);
      if (!(a.cd >= 0)) problems.push(`ability "${a.id}" needs a cooldown`);
      if (!a.text) problems.push(`ability "${a.id}" needs text`);
    }
  }
  const famIds = new Set(data.enemies.families.map((f) => f.id));
  const seen = new Set();
  for (const u of data.enemies.units) {
    if (seen.has(u.id)) problems.push(`duplicate enemy id "${u.id}"`);
    seen.add(u.id);
    if (!famIds.has(u.family)) problems.push(`enemy "${u.id}" has unknown family "${u.family}"`);
    if (!positive(u.weight) || !positive(u.interval) || !(u.armour >= 0)) problems.push(`enemy "${u.id}" needs weight, interval and armour`);
  }
  for (const t of data.quests?.templates ?? []) {
    for (const e of t.encounters ?? []) {
      for (const m of e.mechanics ?? []) {
        if (!['enrage', 'add_wave', 'stack'].includes(m.kind)) problems.push(`dungeon "${t.id}" has unknown mechanic "${m.kind}"`);
        if (m.kind === 'add_wave' && !data.enemyById[m.enemy]) problems.push(`dungeon "${t.id}" add wave names unknown enemy "${m.enemy}"`);
      }
    }
  }
  return problems;
}

// Checks for data/zones.json: gates, reputation, story chains and sworn recruits.
export function validateZones(data = DATA) {
  const problems = [];
  const zd = data.zonesData;
  const q = data.quests;
  const rep = zd.reputation;
  const tiers = rep?.tiers ?? [];
  if (tiers.length < 2 || tiers[0].at !== 0) problems.push('zones.reputation.tiers needs at least two tiers starting at 0');
  tiers.forEach((t, i) => {
    if (i && !(t.at > tiers[i - 1].at)) problems.push(`reputation tier "${t.id}" must start above the previous tier`);
    if (!(t.reward >= 1) || !(t.luck >= 0)) problems.push(`reputation tier "${t.id}" needs reward of at least 1 and a luck`);
  });
  for (const type of Object.keys(q.types)) if (!(rep?.gain?.[type] >= 0)) problems.push(`zones.reputation.gain needs a value for "${type}"`);
  if (!(rep?.firstClear >= 0)) problems.push('zones.reputation.firstClear must not be negative');
  if (!(zd.recruit?.discount >= 0 && zd.recruit.discount < 1)) problems.push('zones.recruit.discount must be 0 to under 1');
  const ids = new Set();
  for (const z of zd.zones) {
    if (ids.has(z.id)) problems.push(`duplicate zone id "${z.id}"`);
    ids.add(z.id);
    if (!z.name) problems.push(`zone "${z.id}" needs a name`);
    if (z.planned) continue;
    if (z.era !== undefined && !(Number.isInteger(z.era) && z.era >= 1 && z.era <= data.sands.maxEra)) problems.push(`zone "${z.id}" era must be a whole number up to sands.maxEra`);
    if (!z.blurb) problems.push(`zone "${z.id}" needs a blurb`);
    if (!Array.isArray(z.titles) || z.titles.length !== tiers.length) problems.push(`zone "${z.id}" needs one title per reputation tier`);
    if (!['gold', 'res', 'xp'].includes(z.perk?.key) || !(z.perk?.value > 0) || !z.perk?.text) problems.push(`zone "${z.id}" needs a perk with key gold, res or xp, a value and text`);
    const head = data.templateById[z.headline];
    if (!head || !isDelve(head.type) || head.zone !== z.id) problems.push(`zone "${z.id}" headline must be one of its dungeons`);
    if (z.gate) {
      const gz = data.zoneById[z.gate.zone];
      const gt = data.templateById[z.gate.dungeon];
      if (!gz || !gt || !isDelve(gt.type) || gt.zone !== gz.id) problems.push(`zone "${z.id}" gate must name a dungeon in an earlier zone`);
      if (z.gate.townHall !== undefined && !(z.gate.townHall >= 1 && z.gate.townHall <= data.townHall.maxLevel)) problems.push(`zone "${z.id}" gate townHall must be a Town Hall level`);
    }
    const steps = q.templates.filter((t) => t.story?.zone === z.id).map((t) => t.story.step).sort((a, b) => a - b);
    if (steps.length < 3 || steps.length > 5 || steps.some((n, i) => n !== i + 1)) problems.push(`zone "${z.id}" needs a story chain of 3 to 5 numbered steps`);
  }
  if (!zd.zones.some((z) => !z.planned && !z.gate && !(z.era > 1))) problems.push('at least one zone must be open from the start');
  for (let n = 1; n <= data.sands.maxEra; n += 1) {
    const bosses = q.templates.filter((t) => t.eraBoss === n);
    if (bosses.length !== 1 || !isDelve(bosses[0].type)) problems.push(`Era ${n} needs exactly one dungeon or raid marked eraBoss ${n}`);
  }
  const seen = new Set();
  for (const r of zd.recruits ?? []) {
    if (seen.has(r.id)) problems.push(`duplicate recruit id "${r.id}"`);
    seen.add(r.id);
    const zone = data.zoneById[r.zone];
    if (!zone) problems.push(`recruit "${r.id}" names unknown zone "${r.zone}"`);
    if (!data.classById[r.class] || !data.raceById[r.race] || !data.traitById[r.trait]) problems.push(`recruit "${r.id}" needs a known race, class and trait`);
    if (!(r.level >= 1 && r.level <= data.heroes.maxLevel)) problems.push(`recruit "${r.id}" needs a level`);
    if (!r.name || !r.blurb) problems.push(`recruit "${r.id}" needs a name and blurb`);
    const need = r.requires ?? {};
    const steps = q.templates.filter((t) => t.story?.zone === r.zone).length;
    if (!(need.story >= 1 && need.story <= steps) && !(need.tier >= 1 && need.tier < tiers.length)) problems.push(`recruit "${r.id}" needs a story step count or a reputation tier`);
  }
  return problems;
}

// Checks for data/crafting.json.
export function validateCrafting(data = DATA) {
  const problems = [];
  const c = data.crafting;
  const positive = (x) => Number.isFinite(x) && x > 0;
  const b = c.brew ?? {};
  if (!Number.isInteger(b.queueMax) || b.queueMax < 1) problems.push('crafting.brew.queueMax must be a whole number');
  if (!positive(b.stockBase) || !(b.stockPerLab >= 0) || !(b.speedPerLab >= 0) || !(b.craftMax >= 0)) problems.push('crafting.brew needs stockBase, stockPerLab, speedPerLab and craftMax');
  const seen = new Set();
  for (const p of c.potions) {
    if (seen.has(p.id)) problems.push(`duplicate potion id "${p.id}"`);
    seen.add(p.id);
    if (!p.name || !p.text) problems.push(`potion "${p.id}" needs a name and text`);
    if (!(p.lab >= 1) || !positive(p.seconds)) problems.push(`potion "${p.id}" needs a Lab level and brew time`);
    for (const [id, amt] of Object.entries(p.cost ?? {})) {
      if (!data.resourceById[id]) problems.push(`potion "${p.id}" costs unknown resource "${id}"`);
      if (!(amt > 0)) problems.push(`potion "${p.id}" cost of ${id} must be positive`);
    }
    if (!Object.keys(p.cost ?? {}).length) problems.push(`potion "${p.id}" needs a cost`);
    const keys = Object.keys(p.effect ?? {});
    if (!keys.length) problems.push(`potion "${p.id}" needs an effect`);
    for (const k of keys) if (!['hp', 'power', 'armour', 'healing', 'crit', 'haste'].includes(k)) problems.push(`potion "${p.id}" has unknown effect "${k}"`);
  }
  for (const id of Object.keys(data.gear.craftLeather ?? {})) if (!data.resourceById[id]) problems.push(`gear.craftLeather costs unknown resource "${id}"`);
  return problems;
}

// Checks for data/renown.json: the gain and multiplier curves and the Renown shop.
export const RENOWN_KEYS = [
  'startGold', 'goldBoost', 'rawBoost', 'storageBoost', 'foundations',
  'xp', 'recruitDiscount', 'recovery', 'rosterSlots', 'forgeDiscount',
  'questGold', 'questSpeed', 'boardRefresh', 'repGain', 'scouts',
  'townHall', 'buildingDiscount', 'townHallDiscount', 'housing', 'foodSaver',
];
const RENOWN_FORMATS = ['percent', 'gold', 'count', 'level'];
const MAX_DISCOUNT = 0.9;

export function validateRenown(data = DATA) {
  const problems = [];
  const r = data.renown;
  const positive = (x) => Number.isFinite(x) && x > 0;
  if (!r) return ['renown data is missing'];
  if (!positive(r.gain?.divisor) || !positive(r.gain?.exp) || !(r.gain?.archivesPerLevel >= 0)) problems.push('renown.gain needs divisor, exp and archivesPerLevel');
  if (!positive(r.multiplier?.per) || !positive(r.multiplier?.exp)) problems.push('renown.multiplier needs per and exp');
  if (!Number.isInteger(r.rebuild?.minGain) || r.rebuild.minGain < 1) problems.push('renown.rebuild.minGain must be a whole number of at least 1');
  if (!(r.rebuild?.adviceFloor >= 0) || !(r.rebuild?.adviceFactor >= 0)) problems.push('renown.rebuild needs adviceFloor and adviceFactor');
  for (const id of r.foundations?.buildings ?? []) {
    const b = data.buildingById?.[id];
    if (!b || b.kind === 'planned') problems.push(`renown foundations lists "${id}", which is not a live building`);
  }
  if (!(r.foundations?.buildings?.length > 0)) problems.push('renown.foundations.buildings must not be empty');
  for (const id of r.scouts?.gates ?? []) {
    const t = data.templateById?.[id];
    if (!t || !isDelve(t.type)) problems.push(`renown scouts lists "${id}", which is not a dungeon`);
  }
  const branches = new Set();
  for (const b of r.branches ?? []) {
    if (branches.has(b.id)) problems.push(`duplicate renown branch "${b.id}"`);
    branches.add(b.id);
    if (!b.name || !b.blurb) problems.push(`renown branch "${b.id}" needs a name and a blurb`);
  }
  const seen = new Set();
  const keys = new Set();
  for (const u of r.upgrades ?? []) {
    if (seen.has(u.id)) problems.push(`duplicate renown upgrade "${u.id}"`);
    seen.add(u.id);
    if (!branches.has(u.branch)) problems.push(`renown upgrade "${u.id}" is in unknown branch "${u.branch}"`);
    if (!u.name || !u.blurb) problems.push(`renown upgrade "${u.id}" needs a name and a blurb`);
    if (!RENOWN_KEYS.includes(u.key)) problems.push(`renown upgrade "${u.id}" has unknown effect "${u.key}"`);
    if (keys.has(u.key)) problems.push(`two renown upgrades share the effect "${u.key}"`);
    keys.add(u.key);
    if (!RENOWN_FORMATS.includes(u.format)) problems.push(`renown upgrade "${u.id}" has unknown format "${u.format}"`);
    if (!positive(u.cost?.base) || !(u.cost?.growth >= 1)) problems.push(`renown upgrade "${u.id}" needs cost.base above 0 and cost.growth of at least 1`);
    const v = u.values;
    if (!Array.isArray(v) || v.length < 1) { problems.push(`renown upgrade "${u.id}" needs a list of values`); continue; }
    if (!v.every(positive) || !v.every((x, i) => i === 0 || x > v[i - 1])) problems.push(`renown upgrade "${u.id}" values must be positive and rising`);
    if (/Discount$|Saver$/.test(u.key) && v.at(-1) > MAX_DISCOUNT) problems.push(`renown upgrade "${u.id}" cannot discount more than ${MAX_DISCOUNT * 100}%`);
    if (u.key === 'townHall' && v.at(-1) > data.townHall.maxLevel) problems.push(`renown upgrade "${u.id}" starts above the highest Town Hall`);
    if (u.key === 'scouts' && v.at(-1) > (r.scouts?.gates?.length ?? 0)) problems.push(`renown upgrade "${u.id}" scouts more dungeons than are listed`);
    if (u.key === 'boardRefresh' && v.at(-1) > MAX_DISCOUNT) problems.push(`renown upgrade "${u.id}" cannot cut the board timer by more than ${MAX_DISCOUNT * 100}%`);
  }
  for (const k of RENOWN_KEYS) if (!keys.has(k)) problems.push(`no renown upgrade provides "${k}"`);
  return problems;
}

// Checks for data/raids.json.
export function validateRaids(data = DATA) {
  const problems = [];
  const r = data.raids;
  const positive = (x) => Number.isFinite(x) && x > 0;
  if (!(r.interval?.[0] > 0 && r.interval[1] >= r.interval[0])) problems.push('raids.interval needs a range of seconds');
  if (!(r.startTier >= 1)) problems.push('raids.startTier must be at least 1');
  if (!positive(r.threat?.base) || !(r.threat?.growth >= 1)) problems.push('raids.threat needs a base and a growth of at least 1');
  if (!(r.guard?.share >= 0 && r.guard.share <= 1)) problems.push('raids.guard.share must be 0 to 1');
  if (!positive(r.wall?.perLevel) || !positive(r.wall?.exp)) problems.push('raids.wall needs perLevel and exp');
  if (!(r.steal?.share >= 0 && r.steal.share < 1)) problems.push('raids.steal.share must be 0 to under 1');
  for (const id of r.steal?.resources ?? []) {
    if (id === 'gold') problems.push('raids must never steal gold');
    else if (!data.resourceById?.[id]) problems.push(`raids.steal lists unknown resource "${id}"`);
  }
  const wall = data.buildingById?.wall_watchtower;
  if (!wall || wall.kind !== 'wall') problems.push('the Wall and Watchtower building must have kind "wall"');
  return problems;
}

const ACHIEVEMENT_KINDS = ['townHall', 'building', 'heroes', 'classes', 'heroLevel', 'questsDone', 'cleared', 'topStanding', 'rebuilds', 'renown', 'totalGold', 'raidsWon'];

// Checks for data/achievements.json.
export function validateAchievements(data = DATA) {
  const problems = [];
  const a = data.achievements;
  if (!(a.bonusEach >= 0)) problems.push('achievements.bonusEach must not be negative');
  const seen = new Set();
  for (const x of a.list) {
    if (seen.has(x.id)) problems.push(`duplicate achievement id "${x.id}"`);
    seen.add(x.id);
    if (!x.name || !x.text) problems.push(`achievement "${x.id}" needs a name and text`);
    if (!ACHIEVEMENT_KINDS.includes(x.kind)) problems.push(`achievement "${x.id}" has unknown kind "${x.kind}"`);
    if (x.kind === 'cleared' && !isDelve(data.templateById?.[x.key]?.type)) problems.push(`achievement "${x.id}" names "${x.key}", which is not a dungeon or raid`);
    if (x.kind === 'building' && !data.buildingById?.[x.key]) problems.push(`achievement "${x.id}" names unknown building "${x.key}"`);
    if (x.kind !== 'cleared' && !(x.value > 0)) problems.push(`achievement "${x.id}" needs a value`);
  }
  return problems;
}

// Checks for data/legacy.json and data/sands.json.
export function validateLegacy(data = DATA) {
  const problems = [];
  const lg = data.legacy;
  const sd = data.sands;
  const positive = (x) => Number.isFinite(x) && x > 0;
  if (!positive(lg.gain?.exp) || !positive(lg.gain?.divisor) || !(lg.gain?.minLevel > lg.gain?.fromLevel)) problems.push('legacy.gain needs exp, divisor, fromLevel and a minLevel above it');
  if (!(lg.multiplier?.per >= 0) || !positive(lg.multiplier?.exp)) problems.push('legacy.multiplier needs per and exp');
  const d = lg.descendants;
  if (!(d?.max >= 0) || !(d?.startShare > 0 && d.startShare <= 1) || !(d?.base >= 0) || !(d?.perLegacy >= 0) || !(d?.cap >= d?.base) || !(d?.discount >= 0 && d.discount < 1)) problems.push('legacy.descendants needs max, startShare, base, perLegacy and a cap of at least base');
  for (const [id, pts] of Object.entries(lg.raidPoints ?? {})) if (data.templateById?.[id]?.type !== 'raid' || !(pts > 0)) problems.push(`legacy.raidPoints "${id}" must be a raid with positive points`);
  const groups = new Set((lg.groups ?? []).map((g) => g.id));
  const effects = ['hp', 'power', 'healing', 'crit', 'haste', 'regen', 'armour', 'threat'];
  const check = (list, label, currency) => {
    const seen = new Set();
    for (const u of list) {
      if (seen.has(u.id)) problems.push(`duplicate ${label} id "${u.id}"`);
      seen.add(u.id);
      if (!u.name || !u.blurb || !u.key) problems.push(`${label} "${u.id}" needs a name, blurb and key`);
      if (!positive(u.cost?.base) || !(u.cost?.growth >= 1)) problems.push(`${label} "${u.id}" needs a ${currency} cost with a base and a growth of at least 1`);
      if (!Array.isArray(u.values) || !u.values.length || u.values.some((v, i, a) => !(v > 0) || (i && v <= a[i - 1]))) problems.push(`${label} "${u.id}" needs increasing positive values`);
    }
  };
  check(lg.upgrades, 'legacy upgrade', 'Legacy');
  check(sd.upgrades, 'sands upgrade', 'Sands');
  for (const u of lg.upgrades) {
    if (!groups.has(u.group)) problems.push(`legacy upgrade "${u.id}" names unknown group "${u.group}"`);
    if (u.key === 'class') {
      if (!data.classById?.[u.group]) problems.push(`legacy upgrade "${u.id}" is a class talent for unknown class "${u.group}"`);
      if (!effects.includes(u.effect)) problems.push(`legacy upgrade "${u.id}" has unknown effect "${u.effect}"`);
    }
  }
  if (!(sd.maxEra >= 1)) problems.push('sands.maxEra must be at least 1');
  if (!(sd.gain?.perEra >= 0) || !(sd.gain?.legacyExp >= 0)) problems.push('sands.gain needs perEra and legacyExp');
  if (!(sd.multiplier?.per >= 0) || !positive(sd.multiplier?.exp)) problems.push('sands.multiplier needs per and exp');
  if (!(sd.journalKeep >= 1)) problems.push('sands.journalKeep must be at least 1');
  return problems;
}

// Checks for data/engage.json: Rally, building perks, edicts, timed events and hero commands.
export function validateEngage(data = DATA) {
  const problems = [];
  const e = data.engage;
  const positive = (x) => Number.isFinite(x) && x > 0;
  const r = e.rally;
  if (!r || !positive(r.tapCharge) || !positive(r.full) || !(r.decayPerSec >= 0) || !positive(r.burstSeconds) || !(r.boost >= 0) || !(r.tributeSeconds >= 0)) problems.push('engage.rally needs tapCharge, full, decayPerSec, burstSeconds, boost and tributeSeconds');
  const tiers = e.perks?.tiers;
  if (!Array.isArray(tiers) || tiers.some((t, i) => !Number.isInteger(t) || t < 1 || (i > 0 && t <= tiers[i - 1]))) problems.push('engage.perks.tiers must be increasing whole levels');
  if (!positive(e.perks?.respecSeconds) || !(e.perks?.respecMin >= 0)) problems.push('engage.perks needs respecSeconds and respecMin');
  const effectKeys = ['output', 'discount', 'workerBonus', 'slots'];
  for (const [id, rows] of Object.entries(e.perks?.byBuilding ?? {})) {
    const def = data.buildingById[id];
    if (!def || !isWorkplace(def)) problems.push(`perks name "${id}", which is not a workplace`);
    if (!Array.isArray(rows) || rows.length !== (tiers ?? []).length) problems.push(`perks for "${id}" need one row per tier`);
    for (const row of rows ?? []) for (const k of ['a', 'b']) {
      const p = row?.[k];
      if (!p?.name || !effectKeys.some((key) => p[key] > 0)) problems.push(`a perk of "${id}" needs a name and an effect`);
      for (const key of Object.keys(p ?? {})) if (key !== 'name' && !effectKeys.includes(key)) problems.push(`a perk of "${id}" has unknown effect "${key}"`);
    }
  }
  for (const b of data.buildings) if (isWorkplace(b) && !e.perks?.byBuilding?.[b.id]) problems.push(`workplace "${b.id}" has no perks`);
  const seen = new Set();
  for (const ed of e.edicts?.list ?? []) {
    if (seen.has(ed.id)) problems.push(`duplicate edict "${ed.id}"`);
    seen.add(ed.id);
    if (!ed.name || !ed.text) problems.push(`edict "${ed.id}" needs a name and text`);
    for (const [rid, m] of Object.entries(ed.res ?? {})) if (!data.resourceById[rid] || !positive(m)) problems.push(`edict "${ed.id}" has a bad resource multiplier for "${rid}"`);
    if (ed.costMult !== undefined && !positive(ed.costMult)) problems.push(`edict "${ed.id}" costMult must be positive`);
    if (!(ed.questSpeed === undefined || ed.questSpeed >= 0) ) problems.push(`edict "${ed.id}" questSpeed must not be negative`);
  }
  if (!(e.edicts?.townHall >= 1) || !positive(e.edicts?.swapSeconds)) problems.push('engage.edicts needs townHall and swapSeconds');
  const ev = e.events;
  if (!ev || !Array.isArray(ev.interval) || !(ev.interval[0] > 0) || ev.interval[1] < ev.interval[0] || !positive(ev.window) || !positive(ev.firstDelaySeconds)) problems.push('engage.events needs interval, window and firstDelaySeconds');
  const seenEv = new Set();
  for (const x of ev?.list ?? []) {
    if (seenEv.has(x.id)) problems.push(`duplicate event "${x.id}"`);
    seenEv.add(x.id);
    if (!x.name || !x.text || !Array.isArray(x.choices) || x.choices.length < 2) problems.push(`event "${x.id}" needs a name, text and at least two choices`);
    if (!x.choices?.some((c) => !c.cost)) problems.push(`event "${x.id}" needs a free choice, so no one is forced to pay`);
    for (const c of x.choices ?? []) {
      if (!c.label) problems.push(`event "${x.id}" has a choice without a label`);
      for (const part of [c.cost, c.gain]) if (part && (!data.resourceById[part.res] || !positive(part.seconds))) problems.push(`event "${x.id}" has a bad cost or gain`);
      if (c.buff && (!c.buff.name || !positive(c.buff.seconds) || !(c.buff.output > 0 || c.buff.questSpeed > 0))) problems.push(`event "${x.id}" has a bad buff`);
    }
  }
  for (const c of data.heroes.classes) {
    const cmd = e.commands?.byClass?.[c.id];
    if (!cmd?.name || !cmd?.text || !(cmd.time > 0 || cmd.gold > 0 || cmd.xp > 0)) problems.push(`class "${c.id}" needs a command with a name, text and an effect`);
  }
  if (!positive(e.commands?.cooldownSeconds)) problems.push('engage.commands needs cooldownSeconds');
  return problems;
}
