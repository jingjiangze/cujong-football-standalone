import {
  getBallProfile, getPushThreshold, createBallState, applyOperatorHit,
  applySkillDisplacement, advanceBallMotion, canBlockBall,
} from './football-rules.mjs';

export const MATCH_STAGES = Object.freeze({
  training: Object.freeze({ id:'training', label:'训练场', levelId:'IG-TR-2', durationSeconds:300, initialCost:30, costCap:99, costIncreaseSeconds:0.85, spRegenMultiplier:2, skillCostMultiplier:0.8, stampsEnabled:false }),
  beginner: Object.freeze({ id:'beginner', label:'初级赛', levelId:'IG-FT-1', durationSeconds:300, initialCost:30, costCap:99, costIncreaseSeconds:0.85, spRegenMultiplier:2, skillCostMultiplier:0.8, stampsEnabled:true, stampMargins:[1,2,4] }),
  advanced: Object.freeze({ id:'advanced', label:'高级赛', levelId:'IG-FT-2', durationSeconds:300, initialCost:30, costCap:99, costIncreaseSeconds:0.85, spRegenMultiplier:2, skillCostMultiplier:0.8, stampsEnabled:true, stampMargins:[1,2,4] }),
  elite: Object.freeze({ id:'elite', label:'特级赛', levelId:'IG-S-4', durationSeconds:300, initialCost:30, costCap:99, costIncreaseSeconds:0.85, spRegenMultiplier:2, skillCostMultiplier:1, stampsEnabled:true, stampMargins:[1,2,4] }),
});

export const MATCH_STYLES = Object.freeze({
 basic:{id:'basic',label:'基础',attackMultiplier:1.1,redeployMultiplier:1,initialSpBonus:0,deployLimitDelta:0,attackSpeedBonus:0,spRefundChance:0,damageTakenMultiplier:1,healingMultiplier:1,rangeSpPerSecond:0,statusDurationMultiplier:1,uncontrolledTargetDamageMultiplier:1,itemId:'cheer-squad'},
 anchoring:{id:'anchoring',label:'驻场',attackGrowthMax:1.6,hpGrowthMax:1.6,growthDurationSeconds:120,redeployMultiplier:1.15,initialSpBonus:0,deployLimitDelta:0,attackSpeedBonus:0,spRefundChance:0,damageTakenMultiplier:1,healingMultiplier:1,rangeSpPerSecond:0,statusDurationMultiplier:1,uncontrolledTargetDamageMultiplier:1,itemId:'armor-distributor'},
 roaming:{id:'roaming',label:'游走',attackMultiplier:1,redeployMultiplier:0.8,initialSpBonus:10,deployLimitDelta:-1,attackSpeedBonus:0,spRefundChance:0,damageTakenMultiplier:1,healingMultiplier:1,rangeSpPerSecond:0,statusDurationMultiplier:1,uncontrolledTargetDamageMultiplier:1,itemId:'firework-box'},
 offensive:{id:'offensive',label:'攻坚',attackMultiplier:1,redeployMultiplier:1,initialSpBonus:0,deployLimitDelta:0,attackSpeedBonus:20,spRefundChance:0.1,spRefundAmount:1,damageTakenMultiplier:1.2,healingMultiplier:1,rangeSpPerSecond:0,statusDurationMultiplier:1,uncontrolledTargetDamageMultiplier:1,itemId:'energy-drink'},
 supportive:{id:'supportive',label:'支援',attackMultiplier:0.9,redeployMultiplier:1,initialSpBonus:0,deployLimitDelta:0,attackSpeedBonus:0,spRefundChance:0,damageTakenMultiplier:1,healingMultiplier:1.4,rangeSpPerSecond:1,rangeSpNonStacking:true,statusDurationMultiplier:1,uncontrolledTargetDamageMultiplier:1,itemId:'soda-machine'},
 disabling:{id:'disabling',label:'控制',attackMultiplier:1,redeployMultiplier:1,initialSpBonus:0,deployLimitDelta:0,attackSpeedBonus:0,spRefundChance:0,damageTakenMultiplier:1,healingMultiplier:1,rangeSpPerSecond:0,statusDurationMultiplier:2.5,uncontrolledTargetDamageMultiplier:0.85,itemId:'illusion-mirror'},
});

export const CARRIED_ITEMS = Object.freeze({
 'cheer-squad':{id:'cheer-squad',label:'赛场啦啦队',effect:'temporary-attack-boost',scope:'both-teams',attackMultiplier:1.2,durationSeconds:10,calibration:true},
 'armor-distributor':{id:'armor-distributor',label:'护具分发员',effect:'grant-barrier',scope:'both-teams',barrier:6000,durationSeconds:10,calibration:true},
 'firework-box':{id:'firework-box',label:'混乱烟花箱',effect:'burst-and-reset-redeploy',damage:1000,calibration:true},
 'energy-drink':{id:'energy-drink',label:'猛兽能量饮料',effect:'temporary-attack-speed-zero-resist',scope:'both-teams',attackSpeedBonus:80,defenseMultiplier:0,resistanceMultiplier:0,durationSeconds:10,calibration:true},
 'soda-machine':{id:'soda-machine',label:'喷射汽水机',effect:'random-sp-supply',scope:'both-teams',spAmount:3,periodSeconds:3,durationSeconds:15,calibration:true},
 'illusion-mirror':{id:'illusion-mirror',label:'迷幻反射镜',effect:'periodic-control-and-controlled-damage-boost',controlledDamageMultiplier:1.4,controlPeriodSeconds:10,controlDurationSeconds:5,durationSeconds:30,calibration:true},
});

export const OPPONENT_TEAMS = Object.freeze({
 standard:{id:'standard',label:'标准队',kicker:'nearest-ball-then-goal',keeper:'catch-and-clear',hitman:'attack-player-units',shootPower:1,hitmanAttack:1,hitmanSpeed:1},
 tactical:{id:'tactical',label:'战术队',kicker:'fast-shoot-at-open-goal',keeper:'strong-clear-at-open-goal',hitman:'target-allied-attackers',shootPower:1.3,hitmanAttack:1,hitmanSpeed:1},
 loveBall:{id:'loveBall',label:'爱球会',kicker:'carry-and-pass-to-striker',keeper:'pass-to-striker',hitman:'target-near-ball-operators',shootPower:0.9,hitmanAttack:1,hitmanSpeed:1},
 fairPlay:{id:'fairPlay',label:'球德联',kicker:'power-shot-with-impact-damage',keeper:'abandon-save-below-half-hp',hitman:'high-damage-and-speed',shootPower:1.35,hitmanAttack:1.3,hitmanSpeed:1.2},
});

const FIELD={cols:13,rows:9,leftGoalX:0.7,rightGoalX:12.3,goalYMin:2.1,goalYMax:6.9,ballStart:{x:6.5,y:4.5},goalkeeperCells:[{x:1,y:3},{x:1,y:4},{x:1,y:5}]};
const DEFAULT_ENEMIES=[
 {id:'enemy-kicker',name:'对方击球手',profession:'guard',role:'kicker',cost:0,attack:600,hp:3000,defense:250,resistance:0,attackInterval:1.0,blockCount:2,range:1,moveSpeed:1.2,skill:{forceLevel:2}},
 {id:'enemy-keeper',name:'对方守门员',profession:'defender',role:'goalkeeper',cost:0,attack:400,hp:4500,defense:600,resistance:0,attackInterval:1.2,blockCount:0,range:1,moveSpeed:0.9,skill:{forceLevel:2}},
 {id:'enemy-hitman',name:'对方击人手',profession:'guard',role:'hitman',cost:0,attack:500,hp:3600,defense:300,resistance:0,attackInterval:0.9,blockCount:2,range:1,moveSpeed:1.0,skill:{forceLevel:1}},
];

const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const clone=value=>structuredClone(value);
const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
const clampCell=(x,y)=>({x:clamp(x,1,11),y:clamp(y,1,7)});
const unitKey=(ownerId,operatorId)=>ownerId+':'+operatorId;
const styleFor=state=>MATCH_STYLES[state.styleId]||MATCH_STYLES.basic;
const stageFor=state=>MATCH_STAGES[state.stageId]||MATCH_STAGES.beginner;

function deterministicRandom(state){
 state.rng=(Math.imul(state.rng,1664525)+1013904223)>>>0;
 return state.rng/4294967296;
}
function makeUnit(def,ownerId,team,x,y,role='field'){
 const hp=def.hp??1400;
 return {id:unitKey(ownerId,def.id),operatorId:def.id,ownerId,team,name:def.name,profession:def.profession||'guard',
  x,y,role,hp,maxHp:hp,atk:def.attack??300,defense:def.defense??0,resistance:def.resistance??0,
  cost:def.cost??12,blockCount:def.blockCount??1,occupiedBlockCount:0,range:def.range??2,
  attackInterval:def.attackInterval??1.5,attackCooldown:0,sp:def.initialSp??0,maxSp:def.maxSp??30,
  redeploySeconds:def.redeploySeconds??70,stunSeconds:0,respawnSeconds:0,barrier:0,
  skills:clone(def.skills||[]),definition:clone(def),activeSkill:null,skillCooldown:0,lastSkill:null,alive:true};
}
function spawnEnemies(state){
 const team=OPPONENT_TEAMS[state.opponentTeamId]||OPPONENT_TEAMS.standard;
 state.enemyUnits=[
  makeUnit({...DEFAULT_ENEMIES[0],attack:DEFAULT_ENEMIES[0].attack*team.shootPower},'ai',1,9.5,3.0,'kicker'),
  makeUnit(DEFAULT_ENEMIES[1],'ai',1,11,4.5,'goalkeeper'),
  makeUnit({...DEFAULT_ENEMIES[2],attack:DEFAULT_ENEMIES[2].attack*team.hitmanAttack,attackInterval:DEFAULT_ENEMIES[2].attackInterval/team.hitmanSpeed},'ai',1,9.5,5.5,'hitman')
 ];
}
export function createMatchState({stageId='beginner',styleId='basic',ballType='standard',operators=[],seed=2463534242,mode='training'}={}){
 const stage=MATCH_STAGES[stageId]||MATCH_STAGES.beginner;
 const roster=operators.length?operators:[];
 const state={version:1,phase:'deployment',mode,stageId:stage.id,styleId:MATCH_STYLES[styleId]?styleId:'basic',
  opponentTeamId:['standard','tactical','loveBall','fairPlay'][seed%4],rng:seed>>>0,
  timeRemaining:stage.durationSeconds,elapsed:0,costClock:0,score:{ally:0,enemy:0},stamps:0,
  players:[
   {id:0,name:'玩家 1',team:0,cost:stage.initialCost,bench:clone(roster),deployLimit:Math.max(1,12+(MATCH_STYLES[styleId]?.deployLimitDelta||0)),connected:true,itemCooldownRemaining:0},
   {id:1,name:'玩家 2',team:0,cost:stage.initialCost,bench:clone(roster),deployLimit:Math.max(1,12+(MATCH_STYLES[styleId]?.deployLimitDelta||0)),connected:true}
  ],
  fieldUnits:[],enemyUnits:[],redeployRemaining:{},barriers:[],ball:createBallState(ballType,FIELD.ballStart.x,FIELD.ballStart.y),
  ballInBench:false,restart:{ownerId:null,remaining:0},activeEffects:[],selectedOperator:{0:null,1:null},
  heldMarkers:[],pauseVote:{0:false,1:false},speedVotes:{0:false,1:false},speed:1,events:[],gameOver:false,
  field:{...FIELD,goalkeeperCells:FIELD.goalkeeperCells.map(x=>({...x}))}};
 spawnEnemies(state);
 return state;
}
function emit(state,type,payload={}){
 state.events.push({seq:state.events.length+1,time:state.elapsed,type,...payload});
 if(state.events.length>120)state.events.shift();
}
function playerOf(state,id){return state.players.find(p=>p.id===id);}
function unitOf(state,id){return state.fieldUnits.find(u=>u.id===id)||state.enemyUnits.find(u=>u.id===id);}
function benchDef(player,operatorId){return player?.bench.find(o=>o.id===operatorId);}
function isKeeperCell(state,x,y,ownerId){
 return ownerId===0?x<=1.5&&y>=2&&y<=6: x>=11&&y>=2&&y<=6;
}
function barrierAt(state,x,y){return state.barriers.find(b=>Math.abs(b.x-x)<0.5&&Math.abs(b.y-y)<0.5);}
function seedBarriers(state){
 const barriers=[];
 for(const x of [2,10]){
  const rows=new Set();
  while(rows.size<3)rows.add(2+Math.floor(deterministicRandom(state)*5));
  for(const y of rows)barriers.push({id:'barrier-'+x+'-'+y,x,y,hp:24000,maxHp:24000});
 }
 state.barriers=barriers;
}
function effectiveSkillCost(state,skill){
 const raw=skill.spCost??skill.costSP??20;
 return Math.max(1,Math.ceil(raw*stageFor(state).skillCostMultiplier));
}
function styleEffect(state){return styleFor(state);}
function applyCarryItem(state,ownerId){
 const style=styleFor(state), item=CARRIED_ITEMS[style.itemId];
 if(!item)return {ok:false,reason:'no-carried-item'};
 const player=playerOf(state,ownerId);
 if(!player||player.itemCooldownRemaining>0)return {ok:false,reason:'item-cooldown'};
 const effect={...clone(item),id:'carry-'+state.elapsed+'-'+ownerId,ownerId,remaining:item.durationSeconds??10,pulseClock:item.periodSeconds??0,nextPulse:item.controlPeriodSeconds??10};
 if(item.effect==='grant-barrier'){
  for(const unit of [...state.fieldUnits,...state.enemyUnits])unit.barrier=Math.max(unit.barrier,item.barrier);
 }
 if(item.effect==='burst-and-reset-redeploy'){
  for(const enemy of state.enemyUnits)damageUnit(state,enemy,item.damage,'carry-item');
  for(const key of Object.keys(state.redeployRemaining))state.redeployRemaining[key]=0;
 }
 state.activeEffects.push(effect);
 player.itemCooldownRemaining=60;
 emit(state,'CARRY_ITEM_TRIGGERED',{ownerId,itemId:item.id});
 return {ok:true};
}

 const style=styleFor(state), item=CARRIED_ITEMS[style.itemId];
 if(!item)return;
 const effect={...clone(item),id:'carry-'+state.elapsed+'-'+ownerId,ownerId,remaining:item.durationSeconds??10};
 if(item.effect==='grant-barrier'){
  for(const unit of [...state.fieldUnits,...state.enemyUnits])unit.barrier=Math.max(unit.barrier,item.barrier);
 }
 if(item.effect==='burst-and-reset-redeploy'){
  for(const enemy of state.enemyUnits)damageUnit(state,enemy,item.damage,'携带物');
  for(const key of Object.keys(state.redeployRemaining))state.redeployRemaining[key]=0;
 }
 state.activeEffects.push(effect);
 emit(state,'CARRY_ITEM_TRIGGERED',{ownerId,itemId:item.id});
}
export function deployOperator(state,ownerId,operatorId,x,y){
 const next=clone(state),player=playerOf(next,ownerId),def=benchDef(player,operatorId);
 if(!player||!def)return {state:next,ok:false,reason:'operator-not-in-bench'};
 if(next.phase!=='deployment'&&next.phase!=='battle')return {state:next,ok:false,reason:'match-not-deployable'};
 if(!Number.isInteger(x)||!Number.isInteger(y)||x<1||x>11||y<1||y>7)return {state:next,ok:false,reason:'invalid-field-cell'};
 const k=unitKey(ownerId,operatorId);
 if(next.fieldUnits.some(u=>u.id===k))return {state:next,ok:false,reason:'already-deployed'};
 if((next.redeployRemaining[k]||0)>0)return {state:next,ok:false,reason:'redeploy-cooldown'};
 if(player.cost<(def.cost??12))return {state:next,ok:false,reason:'insufficient-cost'};
 const keeper=isKeeperCell(next,x,y,ownerId);
 const count=next.fieldUnits.filter(u=>u.ownerId===ownerId&&u.role!=='goalkeeper').length;
 if(!keeper&&count>=player.deployLimit)return {state:next,ok:false,reason:'deploy-limit'};
 if(barrierAt(next,x,y))return {state:next,ok:false,reason:'blocked-cell'};
 player.cost-=(def.cost??12);
 player.bench=player.bench.filter(o=>o.id!==operatorId);
 const unit=makeUnit(def,ownerId,0,x,y,keeper?'goalkeeper':'field');
 unit.isGoalkeeper=keeper;
 unit.blockCount+=keeper?3:0;
 unit.sp=clamp((def.initialSp??0)+styleEffect(next).initialSpBonus,0,unit.maxSp);
 next.fieldUnits.push(unit);
 next.selectedOperator[ownerId]=unit.id;
 emit(next,'OPERATOR_DEPLOYED',{ownerId,operatorId,x,y,role:unit.role,cost:player.cost});
 applyCarryItem(next,ownerId);
 return {state:next,ok:true,unitId:unit.id};
}
export function withdrawOperator(state,unitId){
 const next=clone(state),index=next.fieldUnits.findIndex(u=>u.id===unitId);
 if(index<0)return {state:next,ok:false,reason:'unit-not-deployed'};
 const unit=next.fieldUnits[index],player=playerOf(next,unit.ownerId);
 next.fieldUnits.splice(index,1);
 if(player&&!player.bench.some(o=>o.id===unit.operatorId))player.bench.push(clone(unit.definition||{
  id:unit.operatorId,name:unit.name,profession:unit.profession,cost:unit.cost,attack:unit.atk,hp:unit.maxHp,
  defense:unit.defense,resistance:unit.resistance,blockCount:unit.blockCount,range:unit.range,attackInterval:unit.attackInterval,
  redeploySeconds:unit.redeploySeconds,skills:unit.skills}));
 const style=styleEffect(next);
 next.redeployRemaining[unit.id]=unit.redeploySeconds*style.redeployMultiplier;
 emit(next,'OPERATOR_WITHDRAWN',{ownerId:unit.ownerId,operatorId:unit.operatorId,redeploy:next.redeployRemaining[unit.id]});
 return {state:next,ok:true};
}
function damageUnit(state,unit,amount,cause='football',source=null){
 if(!unit||!unit.alive)return;
 let effective=amount;
 if(unit.team===0&&styleEffect(state).damageTakenMultiplier>1)effective*=styleEffect(state).damageTakenMultiplier;
 if(unit.team===1&&styleEffect(state).uncontrolledTargetDamageMultiplier<1&&source?.team===0&&unit.stunSeconds<=0)effective*=styleEffect(state).uncontrolledTargetDamageMultiplier;
 if(unit.stunSeconds>0&&unit.team===1&&source?.team===0){
  if(state.styleId==='disabling')effective*=1.4;
 }
 if(cause!=='football-impact'&&cause!=='explosive-ball'){
  const drink=state.activeEffects.some(e=>e.effect==='temporary-attack-speed-zero-resist'&&e.remaining>0);
  const defense=drink?0:(unit.defense||0);
  effective=Math.max(effective*0.05,effective-defense);
 }
 const absorbed=Math.min(unit.barrier||0,Math.round(effective));
 unit.barrier=Math.max(0,(unit.barrier||0)-absorbed);
 unit.hp-=Math.max(0,Math.round(effective)-absorbed);
 if(unit.hp<=0){
  unit.alive=false;unit.respawnSeconds=15;
  emit(state,'UNIT_DOWN',{unitId:unit.id,cause});
 }
}

 if(!unit||!unit.alive)return;
 const actual=Math.max(0,Math.round(amount-(unit.barrier||0)));
 const absorbed=Math.min(unit.barrier||0,Math.round(amount));
 unit.barrier=Math.max(0,(unit.barrier||0)-absorbed);
 unit.hp-=Math.max(0,Math.round(amount)-absorbed);
 if(unit.hp<=0){
  unit.alive=false;unit.respawnSeconds=15;
  emit(state,'UNIT_DOWN',{unitId:unit.id,cause});
 }
}
function startRestart(state,ownerId){
 state.ballInBench=true;state.restart={ownerId,remaining:5};
 state.ball.vx=0;state.ball.vy=0;state.ball.damage=0;
 emit(state,'GOALKEEPER_SAVE',{ownerId,restartSeconds:5});
}
export function restartBall(state,ownerId,x,y){
 const next=clone(state);
 if(!next.ballInBench||next.restart.ownerId!==ownerId||next.restart.remaining<=0)return {state:next,ok:false,reason:'restart-not-available'};
 next.ballInBench=false;next.restart={ownerId:null,remaining:0};
 next.ball.x=clamp(x,1,11);next.ball.y=clamp(y,1,7);next.ball.vx=0;next.ball.vy=0;
 emit(next,'BALL_RESTARTED',{ownerId,x:next.ball.x,y:next.ball.y});
 return {state:next,ok:true};
}
function scoreGoal(state,side){
 const points=getBallProfile(state.ball.type).scoreMultiplier||1;
 if(side>0)state.score.ally+=points;else state.score.enemy+=points;
 emit(state,'GOAL',{side,points,score:{...state.score}});
 for(const unit of [...state.fieldUnits]){
  const p=playerOf(state,unit.ownerId);
  if(p&&!p.bench.some(o=>o.id===unit.operatorId))p.bench.push({
   id:unit.operatorId,name:unit.name,profession:unit.profession,cost:unit.cost,attack:unit.atk,hp:unit.maxHp,
   defense:unit.defense,resistance:unit.resistance,blockCount:unit.blockCount,range:unit.range,
   attackInterval:unit.attackInterval,redeploySeconds:unit.redeploySeconds,skills:clone(unit.skills)});
  state.redeployRemaining[unit.id]=unit.redeploySeconds*styleEffect(state).redeployMultiplier;
 }
 state.fieldUnits=[];
 state.ballInBench=false;state.restart={ownerId:null,remaining:0};
 state.ball=createBallState(state.ball.type,FIELD.ballStart.x,FIELD.ballStart.y);
 seedBarriers(state);
}
export function getStampCount(state){
 const margin=state.score.ally-state.score.enemy;
 return margin>=4?3:margin>=2?2:margin>=1?1:0;
}
function finishMatch(state){
 state.phase='finished';state.gameOver=true;state.stamps=stageFor(state).stampsEnabled?getStampCount(state):0;
 emit(state,'MATCH_FINISHED',{score:{...state.score},stamps:state.stamps});
}
function runSupportiveSp(state,dt){
 if(styleFor(state).rangeSpPerSecond<=0)return;
 const allies=state.fieldUnits.filter(u=>u.team===0&&u.alive);
 for(const unit of allies){
  const inRange=allies.some(other=>other.id!==unit.id&&dist(unit,other)<=other.range);
  if(inRange)unit.sp=clamp(unit.sp+styleFor(state).rangeSpPerSecond*dt,0,unit.maxSp);
 }
}
export function activateSkill(state,unitId,skillIndex=0){
 const next=clone(state),unit=unitOf(next,unitId);
 if(!unit||unit.team!==0||!unit.alive)return {state:next,ok:false,reason:'unit-not-active'};
 const skill=unit.skills[skillIndex];
 if(!skill)return {state:next,ok:false,reason:'skill-not-found'};
 const cost=effectiveSkillCost(next,skill);
 if(unit.sp<cost)return {state:next,ok:false,reason:'insufficient-sp'};
 if(unit.skillCooldown>0)return {state:next,ok:false,reason:'skill-cooldown'};
 const effect=skill.effect||{type:'attack-buff',attackMultiplier:1.25,duration:skill.duration??8};
 const profile=getBallProfile(next.ball.type);
 if(['push','pull','dash','shift'].includes(effect.type)&&!canDisplaceBall(next.ball,effect.forceLevel??skill.forceLevel??1)){
  return {state:next,ok:false,reason:'ball-too-heavy-for-shift'};
 }
 unit.sp-=cost;unit.skillCooldown=skill.cooldownSeconds??skill.duration??10;
 const radius=effect.range??unit.range;
 if(['push','pull','dash','shift'].includes(effect.type)){
  let dx=next.ball.x-unit.x,dy=next.ball.y-unit.y;
  if(effect.type==='pull'){dx=-dx;dy=-dy;}
  const result=applySkillDisplacement(next.ball,unit,effect.forceLevel??skill.forceLevel??1,{x:dx,y:dy});
  next.ball.lastHitBy=unit.id;
  emit(next,'SKILL_DISPLACED_BALL',{unitId,ballType:profile.id,forceLevel:effect.forceLevel??skill.forceLevel??1});
 } else if(effect.type==='damage'||effect.type==='stun'){
  for(const target of next.enemyUnits){
   if(!target.alive||dist(unit,target)>radius)continue;
   if(effect.type==='damage')damageUnit(next,target,effect.damage??unit.atk,'operator-skill',unit);
   if(effect.type==='stun')target.stunSeconds=Math.max(target.stunSeconds,effect.duration??2);
  }
 } else if(effect.type==='heal'){
  for(const target of next.fieldUnits)if(target.alive&&dist(unit,target)<=radius)target.hp=clamp(target.hp+(effect.amount??unit.atk)*styleEffect(next).healingMultiplier,0,target.maxHp);
 } else {
  unit.activeSkill={...clone(effect),remaining:effect.duration??skill.duration??8};
 }
 unit.lastSkill=skill.id;emit(next,'SKILL_ACTIVATED',{unitId,skillId:skill.id,spCost:cost});
 return {state:next,ok:true};
}

 const next=clone(state),unit=unitOf(next,unitId);
 if(!unit||unit.team!==0||!unit.alive)return {state:next,ok:false,reason:'unit-not-active'};
 const skill=unit.skills[skillIndex];
 if(!skill)return {state:next,ok:false,reason:'skill-not-found'};
 const cost=effectiveSkillCost(next,skill);
 if(unit.sp<cost)return {state:next,ok:false,reason:'insufficient-sp'};
 if(unit.skillCooldown>0)return {state:next,ok:false,reason:'skill-cooldown'};
 unit.sp-=cost;unit.skillCooldown=skill.cooldownSeconds??skill.duration??10;
 const effect=skill.effect||{type:'attack-buff',attackMultiplier:1.25,duration:skill.duration??8};
 const radius=effect.range??unit.range;
 const profile=getBallProfile(next.ball.type);
 if(effect.type==='push'||effect.type==='pull'||effect.type==='dash'||effect.type==='shift'){
  let dx=next.ball.x-unit.x,dy=next.ball.y-unit.y;
  if(effect.type==='pull'){dx=-dx;dy=-dy;}
  const result=applySkillDisplacement(next.ball,unit,effect.forceLevel??skill.forceLevel??1,{x:dx,y:dy});
  if(!result.displaced){return {state:next,ok:false,reason:'ball-too-heavy-for-shift'};}
  next.ball.lastHitBy=unit.id;
  emit(next,'SKILL_DISPLACED_BALL',{unitId,ballType:profile.id,forceLevel:effect.forceLevel??skill.forceLevel??1});
 } else if(effect.type==='damage'||effect.type==='stun'){
  for(const target of next.enemyUnits){
   if(!target.alive||dist(unit,target)>radius)continue;
   if(effect.type==='damage')damageUnit(next,target,effect.damage??unit.atk,'operator-skill',unit);
   if(effect.type==='stun')target.stunSeconds=Math.max(target.stunSeconds,effect.duration??2);
  }
 } else if(effect.type==='heal'){
  for(const target of next.fieldUnits)if(target.alive&&dist(unit,target)<=radius)target.hp=clamp(target.hp+(effect.amount??unit.atk),0,target.maxHp);
 } else {
  unit.activeSkill={...clone(effect),remaining:effect.duration??skill.duration??8};
 }
 unit.lastSkill=skill.id;emit(next,'SKILL_ACTIVATED',{unitId,skillId:skill.id,spCost:cost});
 return {state:next,ok:true};
}
function attackBall(state,unit){
 const itemBoost=state.activeEffects.some(e=>e.effect==='temporary-attack-boost'&&e.remaining>0)?1.2:1;
 const growth=unit.currentAttack?unit.currentAttack/(unit.atk||1):1;
 const hit=applyOperatorHit(state.ball,{id:unit.id,x:unit.x,y:unit.y,cellX:Math.floor(unit.x),cellY:Math.floor(unit.y),attackDamage:unit.atk*growth*styleEffect(state).attackMultiplier*itemBoost});
 if(hit.pushed)emit(state,'BALL_PUSHED',{unitId:unit.id,ballType:state.ball.type,threshold:hit.threshold,direction:hit.direction});
}

 const hit=applyOperatorHit(state.ball,{id:unit.id,x:unit.x,y:unit.y,cellX:Math.floor(unit.x),cellY:Math.floor(unit.y),attackDamage:unit.atk* (unit.activeSkill?.attackMultiplier??1)*styleEffect(state).attackMultiplier});
 if(hit.pushed)emit(state,'BALL_PUSHED',{unitId:unit.id,ballType:state.ball.type,threshold:hit.threshold,direction:hit.direction});
}
function targetGoalForTeam(team){return team===0?{x:11,y:4.5}:{x:1,y:4.5};}
function enemyTick(state,unit,dt){
 if(!unit.alive||unit.stunSeconds>0)return;
 const team=OPPONENT_TEAMS[state.opponentTeamId]||OPPONENT_TEAMS.standard;
 if(unit.role==='goalkeeper'){
  if(Math.hypot(state.ball.x-unit.x,state.ball.y-unit.y)<2.1&&((state.ball.vx>0)||(state.ball.x<unit.x))){
   state.ball.vx= -Math.abs(state.ball.vx)-team.shootPower*1.2;state.ball.vy=(4.5-state.ball.y)*0.35;
   emit(state,'ENEMY_KEEPER_CLEAR',{team:team.id});
  }
  return;
 }
 if(unit.role==='kicker'||unit.role==='field'){
  if(dist(unit,state.ball)>1.1){
   const target={x:state.ball.x,y:state.ball.y};
   const d=dist(unit,target)||1,step=(unit.moveSpeed??1)*dt;
   unit.x+=((target.x-unit.x)/d)*step;unit.y+=((target.y-unit.y)/d)*step;
  }else if(unit.attackCooldown<=0){
   unit.attackCooldown=team.kicker==='fast-shoot-at-open-goal'?0.65:1;
   const goal=targetGoalForTeam(1);
   const dx=goal.x-state.ball.x,dy=goal.y-state.ball.y,d=Math.hypot(dx,dy)||1;
   const hit=applyOperatorHit(state.ball,{id:unit.id,x:state.ball.x-dx*0.2,y:state.ball.y-dy*0.2,cellX:-99,cellY:-99},state.ball.damage+getBallProfile(state.ball.type).pushThreshold);
   state.ball.vx=(dx/d)*getBallProfile(state.ball.type).pushForce*0.012*team.shootPower;
   state.ball.vy=(dy/d)*getBallProfile(state.ball.type).pushForce*0.012*team.shootPower;
   state.ball.damage=0;state.ball.lastHitBy=unit.id;emit(state,'ENEMY_SHOT',{team:team.id});
  }
 }else if(unit.role==='hitman'){
  const target=state.fieldUnits.filter(u=>u.alive).sort((a,b)=>dist(unit,a)-dist(unit,b))[0];
  if(target&&dist(unit,target)<=unit.range&&unit.attackCooldown<=0){
   unit.attackCooldown=unit.attackInterval;damageUnit(state,target,unit.atk,'enemy-hitman');
  }
 }
}
function tickCostsAndSp(state,dt){
 const stage=stageFor(state),style=styleEffect(state);
 state.costClock+=dt;
 while(state.costClock>=stage.costIncreaseSeconds){
  state.costClock-=stage.costIncreaseSeconds;
  for(const p of state.players)p.cost=clamp(p.cost+1,0,stage.costCap);
 }
 for(const [key,remaining] of Object.entries(state.redeployRemaining)){
  state.redeployRemaining[key]=Math.max(0,remaining-dt);
 }
 for(const unit of state.fieldUnits){
  unit.attackCooldown=Math.max(0,unit.attackCooldown-dt);
  unit.skillCooldown=Math.max(0,unit.skillCooldown-dt);
  unit.stunSeconds=Math.max(0,unit.stunSeconds-dt);
  if(unit.activeSkill){
   unit.activeSkill.remaining-=dt;
   if(unit.activeSkill.remaining<=0)unit.activeSkill=null;
  }
  unit.sp=clamp(unit.sp+dt*stage.spRegenMultiplier,0,unit.maxSp);
  const growth=style.id==='anchoring'?1+(style.attackGrowthMax-1)*clamp((state.elapsed-(unit.deployedAt??state.elapsed))/(style.growthDurationSeconds??120),0,1):1;
  unit.currentAttack=unit.atk*growth;
  unit.currentMaxHp=unit.maxHp*growth;
  unit.hp=Math.min(unit.hp,unit.currentMaxHp);
 }
 runSupportiveSp(state,dt);
}
function alliedCombatTick(state,unit,dt){
 if(!unit.alive||unit.stunSeconds>0)return;
 if(unit.activeSkill?.type==='attack-buff'&&unit.attackCooldown>0)return;
 unit.attackCooldown=Math.max(0,unit.attackCooldown-dt);
 const ballDist=dist(unit,state.ball);
 const target=state.enemyUnits.filter(u=>u.alive&&dist(unit,u)<=unit.range).sort((a,b)=>dist(unit,a)-dist(unit,b))[0];
 if(ballDist<=unit.range&&unit.attackCooldown<=0){
  attackBall(state,unit);unit.attackCooldown=Math.max(0,unit.attackInterval*(100/(100+styleEffect(state).attackSpeedBonus)));
 }else if(target&&unit.attackCooldown<=0){
  const damage=(unit.currentAttack??unit.atk)*styleEffect(state).attackMultiplier;
  damageUnit(state,target,damage,'operator-attack',unit);
  if(styleEffect(state).spRefundChance>0&&deterministicRandom(state)<styleEffect(state).spRefundChance)unit.sp=clamp(unit.sp+(styleEffect(state).spRefundAmount??1),0,unit.maxSp);
  unit.attackCooldown=Math.max(0,unit.attackInterval*(100/(100+styleEffect(state).attackSpeedBonus)));
 }
}
function ballAndFieldTick(state,dt){
 if(state.ballInBench){
  state.restart.remaining=Math.max(0,state.restart.remaining-dt);
  if(state.restart.remaining===0){
   const owner=state.restart.ownerId;
   state.ballInBench=false;state.restart={ownerId:null,remaining:0};
   state.ball.x=owner===0?1.5:11.5;state.ball.y=4.5;state.ball.vx=0;state.ball.vy=0;
   emit(state,'BALL_AUTO_RESTART',{ownerId:owner});
  }
  return;
 }
 const friction=state.iceCells?.[Math.floor(state.ball.y)+':'+Math.floor(state.ball.x)]?0.4:1;
 advanceBallMotion(state.ball,dt,friction);
 if(state.ball.y<1.25){state.ball.y=1.25;state.ball.vy=Math.abs(state.ball.vy)*getBallProfile(state.ball.type).restitution;}
 if(state.ball.y>7.75){state.ball.y=7.75;state.ball.vy=-Math.abs(state.ball.vy)*getBallProfile(state.ball.type).restitution;}
 for(const barrier of [...state.barriers]){
  if(Math.abs(barrier.x-state.ball.x)<0.55&&Math.abs(barrier.y-state.ball.y)<0.55){
   barrier.hp-=getBallProfile(state.ball.type).attack;
   state.ball.vx=-state.ball.vx*getBallProfile(state.ball.type).restitution;
   state.ball.vy=-state.ball.vy*getBallProfile(state.ball.type).restitution;
   if(barrier.hp<=0)state.barriers=state.barriers.filter(b=>b.id!==barrier.id);
  }
 }
 for(const keeper of state.fieldUnits.filter(u=>u.role==='goalkeeper'&&u.alive)){
  if(Math.abs(state.ball.x-keeper.x)<0.7&&Math.abs(state.ball.y-keeper.y)<0.8){
   startRestart(state,keeper.ownerId);return;
  }
 }
 for(const blocker of [...state.fieldUnits,...state.enemyUnits]){
  if(!blocker.alive||dist(blocker,state.ball)>0.48)continue;
  if(canBlockBall(blocker,state.ball)){
   startRestart(state,blocker.ownerId??1);return;
  }
  if(Math.hypot(state.ball.vx,state.ball.vy)>0.35){
   damageUnit(state,blocker,getBallProfile(state.ball.type).attack,'football-impact');
  }
 }
 if(state.ball.x<=0.85&&state.ball.y>=2.1&&state.ball.y<=6.9)scoreGoal(state,-1);
 else if(state.ball.x>=12.15&&state.ball.y>=2.1&&state.ball.y<=6.9)scoreGoal(state,1);
}
function processCarriedEffects(state,dt){
 for(const effect of state.activeEffects){
  if(effect.effect==='random-sp-supply'){
   effect.pulseClock=(effect.pulseClock??effect.periodSeconds??3)-dt;
   if(effect.pulseClock<=0){
    effect.pulseClock=effect.periodSeconds??3;
    const units=[...state.fieldUnits,...state.enemyUnits].filter(u=>u.alive);
    if(units.length){
     const picked=units[Math.floor(deterministicRandom(state)*units.length)];
     picked.sp=clamp(picked.sp+(effect.spAmount??3),0,picked.maxSp);
     emit(state,'CARRY_ITEM_SP',{unitId:picked.id,amount:effect.spAmount??3});
    }
   }
  }
  if(effect.effect==='periodic-control-and-controlled-damage-boost'){
   effect.nextPulse=(effect.nextPulse??10)-dt;
   if(effect.nextPulse<=0){
    effect.nextPulse=effect.controlPeriodSeconds??10;
    for(const enemy of state.enemyUnits){
     if(!enemy.alive)continue;
     if(state.fieldUnits.some(ally=>ally.alive&&dist(ally,enemy)<=ally.range)){
      enemy.stunSeconds=Math.max(enemy.stunSeconds,effect.controlDurationSeconds??5);
     }
    }
    emit(state,'CARRY_ITEM_CONTROL_PULSE',{ownerId:effect.ownerId});
   }
  }
  effect.remaining-=dt;
 }
 state.activeEffects=state.activeEffects.filter(e=>e.remaining>0);
}
export function tickMatch(state,deltaSeconds){
 const next=clone(state);
 if(next.phase!=='battle'||next.gameOver)return next;
 const dt=clamp(deltaSeconds,0,0.1);
 next.elapsed+=dt;next.timeRemaining=Math.max(0,next.timeRemaining-dt);
 tickCostsAndSp(next,dt);
 for(const unit of next.fieldUnits)alliedCombatTick(next,unit,dt);
 for(const unit of next.enemyUnits)enemyTick(next,unit,dt);
 ballAndFieldTick(next,dt);
 next.activeEffects=next.activeEffects.filter(e=>{e.remaining-=dt;return e.remaining>0;});
 if(next.timeRemaining<=0)finishMatch(next);
 return next;
}
export function startBattle(state){
 const next=clone(state);
 if(next.phase!=='setup'&&next.phase!=='deployment')return next;
 next.phase='battle';seedBarriers(next);emit(next,'BATTLE_STARTED',{duration:next.timeRemaining});return next;
}
export function chooseOpponentTeam(state,teamId){
 if(!OPPONENT_TEAMS[teamId])return state;
 const next=clone(state);next.opponentTeamId=teamId;spawnEnemies(next);return next;
}
export function selectOperator(state,ownerId,operatorId){
 const next=clone(state);if(!playerOf(next,ownerId))return next;
 next.selectedOperator[ownerId]=operatorId;return next;
}
export function applyCarriedItem(state,ownerId){
 const next=clone(state),result=applyCarryItem(next,ownerId);
 return {state:next,...result};
}

 const next=clone(state);applyCarryItem(next,ownerId);return next;
}
export function tickRedeploy(state,dt){
 const next=clone(state);
 for(const key of Object.keys(next.redeployRemaining))next.redeployRemaining[key]=Math.max(0,next.redeployRemaining[key]-dt);
 return next;
}
export function computeMatchSummary(state){
 return {stage:stageFor(state).label,score:{...state.score},goalMargin:state.score.ally-state.score.enemy,stamps:stageFor(state).stampsEnabled?getStampCount(state):0,opponentTeam:OPPONENT_TEAMS[state.opponentTeamId].label,duration:stageFor(state).durationSeconds-elapsed(state)};
}
function elapsed(state){return Math.max(0,stageFor(state).durationSeconds-state.timeRemaining);}
