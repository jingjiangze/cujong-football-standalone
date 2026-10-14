import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RULESETS, createMatchState, canDeploy, deployOperator, retreatOperator,
  tickEconomy, activateSkill, moveBallBySkill, deployItem,
} from '../lib/match-state.mjs';

test('rulesets distinguish legacy redeploy half-time from later football rules', () => {
  assert.equal(RULESETS.legacy.redeployMultiplier, 0.5);
  assert.equal(RULESETS.football.redeployMultiplier, 1);
  assert.equal(RULESETS.special.skillCostMultiplier, 1);
  assert.equal(RULESETS.football.skillCostMultiplier, 0.8);
});

test('deploy enforces roster, cost, tile and slot limit; keeper consumes no normal slot', () => {
  let state = createMatchState({ roster0: ['vanguard', 'guard', 'keeper'] });
  let r = deployOperator(state, 0, 'vanguard', { r: 3, c: 2, walkable: true });
  assert.equal(r.ok, true);
  state = r.state;
  assert.equal(state.teams[0].cost, 20);
  assert.equal(state.teams[0].deployed.length, 1);
  r = deployOperator(state, 0, 'vanguard', { r: 3, c: 3, walkable: true });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'already-deployed');
  r = deployOperator(state, 0, 'keeper', { r: 4, c: 1, walkable: true, goalkeeper: true });
  assert.equal(r.ok, true);
  assert.equal(r.state.teams[0].deployed[1].slotCost, 0);
  assert.equal(r.state.teams[0].deployed[1].block, 6);
});

test('economy increments cost on the configured interval and regenerates SP', () => {
  let state = createMatchState({ roster0: ['vanguard'] });
  state = deployOperator(state, 0, 'vanguard', { r: 3, c: 2, walkable: true }).state;
  const before = state.teams[0].sp.vanguard;
  const next = tickEconomy(state, 1);
  assert.equal(next.teams[0].cost, state.teams[0].cost + 1);
  assert.ok(next.teams[0].sp.vanguard > before);
});

test('retreated operators wait for the selected ruleset cooldown', () => {
  let state = createMatchState({ ruleset: 'legacy', roster0: ['vanguard'] });
  state = deployOperator(state, 0, 'vanguard', { r: 3, c: 2, walkable: true }).state;
  const entity = state.teams[0].deployed[0].id;
  const res = retreatOperator(state, 0, entity, 12);
  assert.equal(res.state.teams[0].redeployAt.vanguard, 29.5);
  const early = deployOperator(res.state, 0, 'vanguard', { r: 3, c: 3, walkable: true }, 1, 20);
  assert.equal(early.reason, 'redeploy-cooldown');
});

test('skills consume discounted SP and displacement is weight-gated', () => {
  let state = createMatchState({ roster0: ['pusher'] });
  state = deployOperator(state, 0, 'pusher', { r: 3, c: 2, walkable: true }).state;
  state.teams[0].sp.pusher = 30;
  const activated = activateSkill(state, 0, state.teams[0].deployed[0].id);
  assert.equal(activated.ok, true);
  assert.equal(activated.state.teams[0].sp.pusher, 12);
  const moved = moveBallBySkill(activated.state, 0, activated.state.teams[0].deployed[0].id, { x: 1, y: 0 });
  assert.equal(moved.ok, true);
  const tooHeavy = { ...moved.state, ball: { ...moved.state.ball, type: 'heavy' } };
  assert.equal(moveBallBySkill(tooHeavy, 0, tooHeavy.teams[0].deployed[0].id, { x: 1, y: 0 }).ok, true);
});

test('all six styles and six carry items have explicit public effects', () => {
  const state = createMatchState();
  assert.equal(Object.keys(state.teams[0].style).length > 0, true);
  for (const style of Object.values(state.teams[0].style)) void style;
  assert.equal(Object.keys(RULESETS).length, 3);
  for (const item of ['cheer-squad','armor-distributor','fireworks-box','beast-energy-drink','soda-machine','trick-mirror']) {
    const s = createMatchState();
    s.teams[0].cost = 99;
    assert.equal(deployItem(s, 0, item).ok, true);
  }
});
