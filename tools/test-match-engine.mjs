import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MATCH_STAGES, MATCH_STYLES, OPPONENT_TEAMS, createMatchState,
  deployOperator, withdrawOperator, activateSkill, activateCarriedItem,
  startBattle, tickMatch, getStampCount, votePause, voteSpeed, restartBall,
} from '../lib/football/match-engine.mjs';
import { createBallState, canBlockBall, canDisplaceBall, applySkillDisplacement } from '../lib/football-rules.mjs';

const roster = [
  { id:'test-vanguard', name:'测试先锋', profession:'vanguard', cost:10, attack:300, hp:1200,
    defense:150, blockCount:2, range:2, attackInterval:1, redeploySeconds:20, initialSp:20, maxSp:30,
    skills:[{id:'push-weak',name:'弱推',spCost:5,initialSp:0,cooldownSeconds:10,effect:{type:'push',forceLevel:1}}] },
  { id:'test-guard', name:'测试近卫', profession:'guard', cost:15, attack:500, hp:1800,
    defense:250, blockCount:3, range:1, attackInterval:1.2, redeploySeconds:25, initialSp:0, maxSp:30,
    skills:[{id:'push-heavy',name:'重推',spCost:5,initialSp:0,cooldownSeconds:10,effect:{type:'push',forceLevel:2}}] },
];

test('stage and match-style configuration carries official mode deltas', () => {
  assert.equal(MATCH_STAGES.beginner.durationSeconds, 300);
  assert.equal(MATCH_STAGES.elite.skillCostMultiplier, 1);
  assert.equal(MATCH_STYLES.basic.attackMultiplier, 1.1);
  assert.equal(MATCH_STYLES.roaming.redeployMultiplier, 0.8);
  assert.equal(MATCH_STYLES.offensive.spRefundChance, 0.1);
  assert.equal(MATCH_STYLES.supportive.rangeSpNonStacking, true);
  assert.equal(MATCH_STYLES.disabling.uncontrolledTargetDamageMultiplier, 0.85);
  assert.deepEqual(Object.keys(OPPONENT_TEAMS).sort(), ['fairPlay','loveBall','standard','tactical']);
});

test('players deploy from their bench and spend deployment cost', () => {
  let state = createMatchState({operators:roster,seed:23});
  const before = state.players[0].cost;
  const result = deployOperator(state,0,'test-vanguard',3,3);
  assert.equal(result.ok,true);
  state=result.state;
  assert.equal(state.players[0].cost,before-10);
  assert.equal(state.players[0].bench.some(x=>x.id==='test-vanguard'),false);
  assert.equal(state.fieldUnits.length,1);
  const duplicate=deployOperator(state,0,'test-vanguard',4,3);
  assert.equal(duplicate.ok,false);
});

test('deployment item requires its own action; deploying an operator does not auto-trigger it', () => {
  let state=createMatchState({operators:roster,styleId:'anchoring'});
  state=deployOperator(state,0,'test-vanguard',3,3).state;
  assert.equal(state.activeEffects.length,0);
  const activated=activateCarriedItem(state,0);
  assert.equal(activated.ok,true);
  assert.equal(activated.state.activeEffects.length,1);
  assert.equal(activated.state.activeEffects[0].effect,'grant-barrier');
});

test('weight-limited skill displacement fails without spending SP, then succeeds for enough force', () => {
  let state=createMatchState({operators:roster,ballType:'heavy'});
  state=deployOperator(state,0,'test-vanguard',5,4).state;
  state=deployOperator(state,0,'test-guard',4,4).state;
  const weakId=state.fieldUnits.find(x=>x.operatorId==='test-vanguard').id;
  const strongId=state.fieldUnits.find(x=>x.operatorId==='test-guard').id;
  const beforeSp=state.fieldUnits.find(x=>x.id===weakId).sp;
  const weak=activateSkill(state,weakId,0);
  assert.equal(weak.ok,false);
  assert.equal(weak.reason,'ball-too-heavy-for-shift');
  assert.equal(weak.state.fieldUnits.find(x=>x.id===weakId).sp,beforeSp);
  const strong=activateSkill(state,strongId,0);
  assert.equal(strong.ok,true);
  assert.ok(Math.hypot(strong.state.ball.vx,strong.state.ball.vy)>0);
});

test('withdrawal starts redeployment cooldown and restores the operator to bench', () => {
  let state=createMatchState({operators:roster});
  const deployed=deployOperator(state,0,'test-vanguard',3,3);
  state=deployed.state;
  const withdrawn=withdrawOperator(state,deployed.unitId);
  assert.equal(withdrawn.ok,true);
  assert.equal(withdrawn.state.fieldUnits.length,0);
  assert.ok(withdrawn.state.redeployRemaining[deployed.unitId]>0);
  assert.ok(withdrawn.state.players[0].bench.some(x=>x.id==='test-vanguard'));
  assert.equal(deployOperator(withdrawn.state,0,'test-vanguard',3,3).reason,'redeploy-cooldown');
});

test('battle tick increases deployment cost and regenerates SP', () => {
  let state=createMatchState({operators:roster,stageId:'beginner'});
  state=deployOperator(state,0,'test-vanguard',3,3).state;
  state=startBattle(state);
  const unitId=state.fieldUnits[0].id, cost=state.players[0].cost, sp=state.fieldUnits[0].sp;
  state=tickMatch(state,2);
  assert.ok(state.players[0].cost>cost);
  assert.ok(state.fieldUnits.find(x=>x.id===unitId).sp>sp);
  assert.ok(state.timeRemaining<300);
});

test('goal stamp thresholds and two-player pause/speed votes are deterministic', () => {
  assert.equal(getStampCount({score:{ally:1,enemy:0}}),1);
  assert.equal(getStampCount({score:{ally:2,enemy:0}}),2);
  assert.equal(getStampCount({score:{ally:4,enemy:0}}),3);
  let state=createMatchState({operators:roster});
  state=votePause(state,0,true);
  assert.equal(state.paused,false);
  state=votePause(state,1,true);
  assert.equal(state.paused,true);
  state=voteSpeed(state,0,true);
  assert.equal(state.speed,1);
  state=voteSpeed(state,1,true);
  assert.equal(state.speed,2);
});

test('football block and shift eligibility follow ball weight', () => {
  assert.equal(canBlockBall({blockCount:2,occupiedBlockCount:0},createBallState('standard')),false);
  assert.equal(canBlockBall({blockCount:3,occupiedBlockCount:0},createBallState('standard')),true);
  assert.equal(canBlockBall({role:'goalkeeper',blockCount:0,occupiedBlockCount:0},createBallState('standard')),true);
  assert.equal(canDisplaceBall(createBallState('heavy'),1),false);
  assert.equal(canDisplaceBall(createBallState('heavy'),2),true);
});
