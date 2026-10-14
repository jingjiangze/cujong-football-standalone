import { getBallProfile, createBallState, getPushThreshold } from './football-rules.mjs';
import { DEFAULT_LINEUP, getOperator } from './operators.mjs';

export const RULESETS = Object.freeze({
  legacy: Object.freeze({
    id: 'legacy', label: '促融共竞旧版',
    playTime: 300, initialCost: 30, maxCost: 99, costInterval: 0.85,
    redeployMultiplier: 0.5, redeployCostIncrease: 0,
    skillCostMultiplier: 0.8, naturalSpMultiplier: 2,
    initialDeployLimit: 4, maxDeployLimit: 10, specialStage: false,
    matchPlayers: 2, scoreStampMargins: [1, 2, 4],
  }),
  football: Object.freeze({
    id: 'football', label: '阵地足球规则',
    playTime: 300, initialCost: 30, maxCost: 99, costInterval: 0.85,
    redeployMultiplier: 1, redeployCostIncrease: 0,
    skillCostMultiplier: 0.8, naturalSpMultiplier: 2,
    initialDeployLimit: 4, maxDeployLimit: 10, specialStage: false,
    matchPlayers: 2, scoreStampMargins: [1, 2, 4],
  }),
  special: Object.freeze({
    id: 'special', label: '特级赛规则',
    playTime: 300, initialCost: 30, maxCost: 99, costInterval: 0.85,
    redeployMultiplier: 1, redeployCostIncrease: 0,
    skillCostMultiplier: 1, naturalSpMultiplier: 2,
    initialDeployLimit: 4, maxDeployLimit: 10, specialStage: true,
    matchPlayers: 2, scoreStampMargins: [1, 2, 4],
  }),
});

export const MATCH_STYLES = Object.freeze({
  basic: Object.freeze({
    id: 'basic', label: '基础', positive: { attackMultiplier: 1.1 },
    negative: {}, item: 'cheer-squad',
  }),
  anchoring: Object.freeze({
    id: 'anchoring', label: '驻场', positive: { attackAndHpMaxMultiplier: 1.6 },
    negative: { redeployMultiplier: 1.15 }, item: 'armor-distributor',
  }),
  roaming: Object.freeze({
    id: 'roaming', label: '游走', positive: { redeployMultiplier: 0.8, initialSp: 10 },
    negative: { deployLimitDelta: -1 }, item: 'fireworks-box',
  }),
  offensive: Object.freeze({
    id: 'offensive', label: '攻坚', positive: { attackSpeedFlat: 20, damageSpChance: 0.1 },
    negative: { incomingDamageMultiplier: 1.2 }, item: 'beast-energy-drink',
  }),
  supportive: Object.freeze({
    id: 'supportive', label: '支援', positive: { healingMultiplier: 1.4, nearbySpPerSecond: 1 },
    negative: { damageMultiplier: 0.9 }, item: 'soda-machine',
  }),
  disabling: Object.freeze({
    id: 'disabling', label: '控制', positive: { statusDurationMultiplier: 2.5 },
    negative: { damageToUnstatusedMultiplier: 0.85 }, item: 'trick-mirror',
  }),
});

export const MATCH_ITEMS = Object.freeze({
  'cheer-squad': Object.freeze({ id:'cheer-squad', name:'赛场啦啦队', cost:8, type:'team-attack', duration:12, attackMultiplier:1.2 }),
  'armor-distributor': Object.freeze({ id:'armor-distributor', name:'护具分发员', cost:10, type:'team-shield', duration:12, shield:6000 }),
  'fireworks-box': Object.freeze({ id:'fireworks-box', name:'混乱烟花箱', cost:12, type:'damage-and-redeploy', damage:1200, redeployReduceToZero:true }),
  'beast-energy-drink': Object.freeze({ id:'beast-energy-drink', name:'猛兽能量饮料', cost:10, type:'team-haste', duration:10, attackSpeedFlat:35, defenseSetToZero:true }),
  'soda-machine': Object.freeze({ id:'soda-machine', name:'喷射汽水机', cost:10, type:'random-sp', duration:12, interval:2, sp:3 }),
  'trick-mirror': Object.freeze({ id:'trick-mirror', name:'迷幻反射镜', cost:12, type:'status-field', duration:12, bonusDamage:1.4, stunEvery:10, stunDuration:5 }),
});

export function createTeamState({
  side = 0,
  roster = DEFAULT_LINEUP,
  style = 'basic',
  ruleset = 'football',
} = {}) {
  const rule = RULESETS[ruleset] || RULESETS.football;
  const uniqueRoster = [...new Set(roster)].filter(id => getOperator(id));
  return {
    side,
    roster: uniqueRoster,
    style: MATCH_STYLES[style] ? style : 'basic',
    ruleset: rule.id,
    cost: rule.initialCost,
    costClock: 0,
    deployed: [],
    redeployAt: {},
    sp: Object.fromEntries(uniqueRoster.map(id => [id, getOperator(id).skill.initialSp])),
    skills: {},
    slots: rule.initialDeployLimit,
    shield: {},
    itemCooldowns: {},
    itemCharges: {},
  };
}

export function createMatchState({ ruleset = 'football', roster0, roster1, style0 = 'basic', style1 = 'basic', seed = 1 } = {}) {
  const rule = RULESETS[ruleset] || RULESETS.football;
  return {
    version: 1,
    phase: 'match',
    ruleset: rule.id,
    elapsed: 0,
    remaining: rule.playTime,
    score: [0, 0],
    teams: [
      createTeamState({ side: 0, roster: roster0 || DEFAULT_LINEUP, style: style0, ruleset: rule.id }),
      createTeamState({ side: 1, roster: roster1 || DEFAULT_LINEUP, style: style1, ruleset: rule.id }),
    ],
    ball: createBallState('standard', 6.5, 4.5),
    barriers: [],
    items: [],
    events: [],
    seed,
    nextEntityId: 1,
  };
}

export function makeEvent(type, detail = {}) {
  return { type, at: Date.now(), ...detail };
}

export function canDeploy(state, side, operatorId, tile, now = state.elapsed) {
  const team = state.teams[side];
  const op = getOperator(operatorId);
  if (!team || !op) return { ok: false, reason: 'unknown-operator' };
  if (!team.roster.includes(operatorId)) return { ok: false, reason: 'not-in-roster' };
  if (team.deployed.some(entry => entry.operatorId === operatorId)) return { ok: false, reason: 'already-deployed' };
  if (now < (team.redeployAt[operatorId] || 0)) return { ok: false, reason: 'redeploy-cooldown' };
  const isGoalkeeper = !!tile?.goalkeeper;
  const limit = Math.max(1, team.slots + (MATCH_STYLES[team.style].negative.deployLimitDelta || 0));
  const occupied = team.deployed.filter(entry => !entry.goalkeeper).reduce((sum,entry)=>sum + entry.slotCost,0);
  const nextSlots = occupied + (isGoalkeeper || op.keeper ? 0 : op.slotCost);
  if (!isGoalkeeper && !op.keeper && nextSlots > limit) return { ok: false, reason: 'deploy-limit' };
  if (op.deployCost > team.cost) return { ok: false, reason: 'insufficient-cost' };
  if (!tile || !Number.isInteger(tile.r) || !Number.isInteger(tile.c)) return { ok: false, reason: 'invalid-tile' };
  if (!tile.walkable) return { ok: false, reason: 'blocked-tile' };
  return { ok: true, operator: op, goalkeeper: isGoalkeeper || op.keeper, slotCost: isGoalkeeper || op.keeper ? 0 : op.slotCost };
}

export function deployOperator(state, side, operatorId, tile, facing = 1, now = state.elapsed) {
  const checked = canDeploy(state, side, operatorId, tile, now);
  if (!checked.ok) return { state, ok: false, reason: checked.reason };
  const next = structuredClone(state);
  const team = next.teams[side];
  const op = checked.operator;
  team.cost -= op.deployCost;
  team.deployed.push({
    id: `op-${next.nextEntityId++}`, operatorId, side,
    r: tile.r, c: tile.c, x: tile.c + 0.5, y: tile.r + 0.5,
    facing: facing < 0 ? -1 : 1,
    goalkeeper: checked.goalkeeper,
    slotCost: checked.slotCost,
    hp: op.hp, maxHp: op.hp, block: op.block + (checked.goalkeeper ? 3 : 0),
    status: 'active',
  });
  const rule = RULESETS[team.ruleset];
  const style = MATCH_STYLES[team.style];
  const initialSp = op.skill.initialSp + (style.positive.initialSp || 0);
  team.sp[operatorId] = Math.max(team.sp[operatorId] ?? 0, initialSp);
  team.redeployAt[operatorId] = Number.POSITIVE_INFINITY;
  team.skills[operatorId] = { activeUntil: 0, cooldownUntil: 0 };
  next.events.push(makeEvent('operator-deployed', { side, operatorId, tile, goalkeeper: checked.goalkeeper }));
  return { state: next, ok: true };
}

export function retreatOperator(state, side, entityId, now = state.elapsed) {
  const next = structuredClone(state);
  const team = next.teams[side];
  if (!team) return { state, ok: false, reason: 'unknown-team' };
  const index = team.deployed.findIndex(entry => entry.id === entityId);
  if (index < 0) return { state, ok: false, reason: 'not-deployed' };
  const [entry] = team.deployed.splice(index, 1);
  const op = getOperator(entry.operatorId);
  const rule = RULESETS[team.ruleset];
  const style = MATCH_STYLES[team.style];
  const factor = rule.redeployMultiplier * (style.negative.redeployMultiplier || 1) * (style.positive.redeployMultiplier || 1);
  team.redeployAt[entry.operatorId] = now + op.redeploySeconds * factor;
  team.sp[entry.operatorId] = op.skill.initialSp;
  delete team.skills[entry.operatorId];
  next.events.push(makeEvent('operator-retreated', { side, operatorId: entry.operatorId, redeployAt: team.redeployAt[entry.operatorId] }));
  return { state: next, ok: true, operator: entry.operatorId };
}

export function tickEconomy(state, dt) {
  if (!Number.isFinite(dt) || dt <= 0) return state;
  const next = structuredClone(state);
  next.elapsed += dt;
  next.remaining = Math.max(0, next.remaining - dt);
  for (const team of next.teams) {
    const rule = RULESETS[team.ruleset];
    team.costClock += dt;
    while (team.costClock >= rule.costInterval && team.cost < rule.maxCost) {
      team.costClock -= rule.costInterval;
      team.cost = Math.min(rule.maxCost, team.cost + 1);
    }
    for (const entry of team.deployed) {
      const op = getOperator(entry.operatorId);
      const style = MATCH_STYLES[team.style];
      const activeSkill = team.skills[entry.operatorId];
      if (activeSkill && activeSkill.activeUntil > next.elapsed) continue;
      const regen = op.skill.spRegen * rule.naturalSpMultiplier + (style.positive.nearbySpPerSecond || 0);
      team.sp[entry.operatorId] = Math.min(op.skill.spCost, (team.sp[entry.operatorId] || 0) + regen * dt);
    }
    for (const [key, until] of Object.entries(team.redeployAt)) {
      if (until <= next.elapsed) delete team.redeployAt[key];
    }
  }
  if (next.remaining <= 0) next.phase = 'finished';
  return next;
}

export function activateSkill(state, side, entityId, now = state.elapsed) {
  const next = structuredClone(state);
  const team = next.teams[side];
  if (!team) return { state, ok: false, reason: 'unknown-team' };
  const entry = team.deployed.find(unit => unit.id === entityId);
  if (!entry) return { state, ok: false, reason: 'not-deployed' };
  const op = getOperator(entry.operatorId);
  const rule = RULESETS[team.ruleset];
  const style = MATCH_STYLES[team.style];
  const skill = op.skill;
  const needed = Math.ceil(skill.spCost * rule.skillCostMultiplier);
  const existing = team.skills[entry.operatorId] || { activeUntil: 0, cooldownUntil: 0 };
  if (now < existing.cooldownUntil) return { state, ok: false, reason: 'skill-cooldown' };
  if ((team.sp[entry.operatorId] || 0) < needed) return { state, ok: false, reason: 'insufficient-sp' };
  team.sp[entry.operatorId] -= needed;
  const cooldownMultiplier = style.negative.redeployMultiplier ? 1 : 1;
  team.skills[entry.operatorId] = {
    activeUntil: skill.duration > 0 ? now + skill.duration : now,
    cooldownUntil: now + (skill.cooldown || 0),
  };
  next.events.push(makeEvent('skill-activated', { side, operatorId: entry.operatorId, skillId: skill.id }));
  return { state: next, ok: true, skill, operator: op, team, entry };
}

export function canDisplaceBall(operatorId, ball, skill = getOperator(operatorId)?.skill) {
  if (!skill || skill.type !== 'displace-ball') return { ok: false, reason: 'not-a-displacement-skill' };
  const profile = getBallProfile(ball.type);
  if (profile.weight > skill.maxBallWeight) return { ok: false, reason: 'ball-too-heavy' };
  return { ok: true, profile, impulse: profile.pushForce * 0.012 * skill.force };
}

export function moveBallBySkill(state, side, entityId, direction, now = state.elapsed) {
  const team = state.teams[side];
  const entry = team?.deployed.find(unit => unit.id === entityId);
  if (!entry) return { state, ok: false, reason: 'not-deployed' };
  const op = getOperator(entry.operatorId);
  const check = canDisplaceBall(entry.operatorId, state.ball, op.skill);
  if (!check.ok) return { state, ok: false, reason: check.reason };
  const next = structuredClone(state);
  const unit = next.teams[side].deployed.find(item => item.id === entityId);
  const dx = Math.sign(direction.x || unit.facing);
  const dy = Math.sign(direction.y || 0);
  next.ball.vx += dx * check.impulse;
  next.ball.vy += dy * check.impulse;
  next.ball.damage = 0;
  next.ball.lastHitBy = entityId;
  next.events.push(makeEvent('ball-displaced-by-skill', { side, entityId, ballType: next.ball.type }));
  return { state: next, ok: true, impulse: check.impulse, profile: check.profile };
}

export function applyMatchStyle(team, actor, target, dt = 0) {
  const style = MATCH_STYLES[team.style];
  const op = getOperator(actor.operatorId);
  const progress = Math.max(0, 1 - (actor.spawnedAt || 0) / 300);
  let attack = op.attack;
  let incomingDamage = 1;
  if (team.style === 'basic') attack *= 1.1;
  if (team.style === 'anchoring') {
    const multiplier = 1 + 0.6 * Math.min(1, (actor.activeSeconds || 0) / 60);
    attack *= multiplier;
    actor.maxHp = op.hp * multiplier;
  }
  if (team.style === 'offensive') incomingDamage *= 1.2;
  if (team.style === 'supportive') attack *= 0.9;
  if (team.style === 'disabling' && target?.status === 'none') attack *= 0.85;
  return { attack: Math.round(attack), incomingDamage, style, progress };
}

export function deployItem(state, side, itemId, now = state.elapsed) {
  const next = structuredClone(state);
  const team = next.teams[side];
  const item = MATCH_ITEMS[itemId];
  if (!team || !item) return { state, ok: false, reason: 'unknown-item' };
  if (team.cost < item.cost) return { state, ok: false, reason: 'insufficient-cost' };
  if ((team.itemCooldowns[itemId] || 0) > now) return { state, ok: false, reason: 'item-cooldown' };
  team.cost -= item.cost;
  team.itemCooldowns[itemId] = now + 30;
  next.items.push({
    id: `item-${next.nextEntityId++}`, itemId, side, startedAt: now,
    expiresAt: item.duration ? now + item.duration : now,
    nextTick: now + (item.interval || 0),
  });
  next.events.push(makeEvent('item-deployed', { side, itemId }));
  return { state: next, ok: true, item };
}
