// 促融共竞 · 阵地足球 —— 独立场景与玩法（v2：官方关卡布局 + 选1控1 + AI 队友）
//
// 复用卫戍协议框架：
//   - lib/projection.js  官方相机模型（零依赖）
//   - lib/grid.js        官方 SPFA 流场寻路（Grid.waypoints）—— AI 移动内核照上游范式
//   - three + pixi-spine 3D 场景 / 小人叠层
// 官方依据：
//   - 关卡布局 data/level_act1multi_football.json（13×9；col0=allygoal / col12=enemygoal / row0,8=forbidden）
//   - constData：maxPlayTime 300 / moveMultiplier 0.5 / initialCost 30 / costIncreaseTime 0.85
//   - 视觉：官方预览图为灰白水泥板场地 + 青色发光边线 + 左蓝右红钢桁架球门（非绿茵场）

import * as T from 'three';
import { OFFICIAL_PARAMS, officialCamera, syncThreeCamera, pickTile } from './lib/projection.js';
import { Grid } from './lib/grid.js';
import { getBallProfile, getPushThreshold, createBallState, applyOperatorHit, advanceBallMotion } from './lib/football-rules.mjs';

// ---------------- 官方关卡布局（data/level_act1multi_football.json 实测）----------------
const LEVEL = {
  cols: 13, rows: 9,            // mapData.map 实测：13 列 × 9 行
  goalCols: 1,                  // col 0 = tile_allygoal，col 12 = tile_enemygoal
  borderRows: 2,                // row 0 / row 8 = tile_forbidden
};
const COLS = LEVEL.cols, ROWS = LEVEL.rows;
const X0 = 1, X1 = COLS - 2;    // 球场内区（含）1..11
const Y0 = 1, Y1 = ROWS - 2;    // 1..7
const CX = (X0 + X1) / 2, CY = (Y0 + Y1) / 2;

const CFG = {
  playTime: 300,                // official options.maxPlayTime
  moveScale: 0.5,               // official options.moveMultiplier
  squad: 3,                     // prototype: one controlled operator + two AI teammates
  opRadius: 0.40,
  opSpeed: 2.6,
  aiSpeed: 2.2,
  attackRange: 1.45,
  attackInterval: 0.72,
  attackDamage: 1200,            // normalized prototype value, not a claimed official operator stat
  operatorHp: 12000,              // simplified health pool for showing ball impact/down states
  downDuration: 15,               // prototype respite timer; not all operator-specific timings
  ballHitCooldown: 0.7,
  barrierAttackRange: 1.1,
  ballR: 0.26,
  barrierHp: 24000,              // normalized durability: two standard-ball impacts
  resetAfterGoal: 1.4,
};

// 官方视觉（预览图实测）：浅灰水泥板 (155,153,161) / 板缝 (58,72,99) / 青色发光边线 / 左蓝右红钢桁架
const VIS = {
  slabA: 0xe2e1e7, slabB: 0xdad9e0, grout: 0x7d89a1,
  cyan: 0x59d8e6, allyTruss: 0x2f6fe0, enemyTruss: 0xd23c2e,
  standTop: 0x2f3542, standBottom: 0x3b4658,
  barrier: 0xd9a441, ballWhite: 0xf4f6f4,
};

// ---------------- three 场景 ----------------
const host = document.getElementById('host');
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
host.appendChild(renderer.domElement);
const scene = new T.Scene(); scene.background = new T.Color(0x1b2028);
const cam3 = new T.PerspectiveCamera(40, 16 / 9, 0.5, 400);
scene.add(new T.HemisphereLight(0xe8f0ff, 0x4b525c, 1.55));
const dl = new T.DirectionalLight(0xffffff, 0.85); dl.position.set(6, 4, 18); scene.add(dl);
const sceneTextureTargets = [];

function box(w, h, d, color, x, y, z, o = {}) {
  const m = new T.Mesh(new T.BoxGeometry(w, h, d),
    new T.MeshStandardMaterial({ color, roughness: o.rough ?? 0.88, metalness: o.metal ?? 0.06,
      emissive: o.emissive ?? 0x000000, emissiveIntensity: o.ei ?? 1 }));
  m.position.set(x, y, z); scene.add(m); return m;
}

// 场地：浅灰水泥大板（板缝用深色细条表现）
(() => {
  const totalW = COLS, totalH = ROWS;
  box(totalW, totalH, 0.12, VIS.grout, COLS / 2, ROWS / 2, -0.12, { rough: 1 });      // 板缝底
  const SLAB = 1;                                                                     // 每格一块
  for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) {
    if (r === 0 || r === ROWS - 1) continue;                                          // 界外行单独画
    const inside = c >= X0 && c <= X1;
    const color = c === 0 ? VIS.allyTruss : c === COLS - 1 ? VIS.enemyTruss
      : (r + c) % 2 ? VIS.slabA : VIS.slabB;
    box(SLAB - 0.045, SLAB - 0.045, 0.10, color, c + 0.5, r + 0.5, 0.0,
      { rough: inside ? 0.96 : 0.7, metal: inside ? 0.02 : 0.25 });
    if (inside) {
      const topMaterial = new T.MeshStandardMaterial({ color, roughness: 0.96, metalness: 0.02 });
      const top = new T.Mesh(new T.PlaneGeometry(SLAB - 0.045, SLAB - 0.045), topMaterial);
      top.position.set(c + 0.5, r + 0.5, 0.056);
      scene.add(top);
      sceneTextureTargets.push(topMaterial);
    }
  }
  // 上下两条看台（界外行）
  for (const r of [0, ROWS - 1]) {
    box(COLS, 1, 0.6, r === 0 ? VIS.standTop : VIS.standBottom, COLS / 2, r + 0.5, 0.18, { rough: 0.95 });
    // 橙黑相间警示条纹（官方预览图的特征；原来是一根实心黄梁）
    for (let i = 0; i < COLS * 3; i++) {
      const orange = i % 2 === 0;
      box(1 / 3 - 0.01, 0.12, 0.12, orange ? 0xe07a1f : 0x1d2024, i / 3 + 1 / 6,
        r === 0 ? r + 0.96 : r + 0.04, 0.5, { emissive: orange ? 0x2a1400 : 0x000000 });
    }
  }
  // 青色发光边线（官方预览图的标志性特征）
  box(X1 - X0 + 1 + 0.2, 0.09, 0.09, VIS.cyan, CX, Y0 + 0.10, 0.15, { emissive: VIS.cyan, ei: 0.9 });   // 修复：原来在 y=Y0=1.0，正好嵌进看台盒子被吞掉
  box(X1 - X0 + 1 + 0.2, 0.09, 0.09, VIS.cyan, CX, Y1 + 0.90, 0.15, { emissive: VIS.cyan, ei: 0.9 });   // 修复：原来埋在看台盒子里，看不见
  // 中线 + 中圈
  box(0.07, Y1 - Y0 + 1, 0.02, VIS.cyan, CX + 0.5, CY + 0.5, 0.075, { emissive: VIS.cyan, ei: 0.35 });
  const ring = new T.Mesh(new T.RingGeometry(1.5, 1.58, 48),
    new T.MeshBasicMaterial({ color: VIS.cyan, side: T.DoubleSide, transparent: true, opacity: 0.75 }));
  ring.position.set(CX + 0.5, CY + 0.5, 0.075); scene.add(ring);

  // 左右球门：钢桁架（镂空斜撑）
  const truss = (baseX, color, dir) => {
    const g = new T.Group();
    const mat = new T.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.65, emissive: color, emissiveIntensity: 0.28 });
    const bar = (w, h, d, x, y, z) => { const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); g.add(m); };
    bar(0.16, ROWS - 2, 0.16, 0, ROWS / 2, 0.9);                 // 竖框
    bar(0.16, ROWS - 2, 0.16, dir * 0.75, ROWS / 2, 0.9);
    bar(0.16, 0.16, 0.16, dir * 0.375, ROWS / 2, 0.9);           // 横撑
    for (let i = 1; i < ROWS - 2; i += 1) {                       // 斜撑
      const m = new T.Mesh(new T.BoxGeometry(0.1, 0.95, 0.1), mat);
      m.position.set(dir * 0.375, i + 1, 0.9); m.rotation.x = 0.62; g.add(m);
    }
    bar(0.9, 0.14, 0.14, dir * 0.375, ROWS - 2, 0.9);            // 顶梁
    g.position.set(baseX, 0, 0); scene.add(g);
  };
  truss(0.5, VIS.allyTruss, 1);
  truss(COLS - 0.5, VIS.enemyTruss, -1);
})();

async function loadOfficialSceneSurfaceTexture() {
  // Assets are extracted from the local client and deliberately ignored by Git.
  // The app still works with the original procedural slabs when assets are absent.
  for (const name of ['ground_base_tile', 'land_poly_albedo']) {
    const url = `/ui/scene/${name}.png`;
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (!response.ok) continue;
      const texture = await new T.TextureLoader().loadAsync(url);
      texture.colorSpace = T.SRGBColorSpace;
      for (const material of sceneTextureTargets) {
        material.map = texture;
        material.needsUpdate = true;
      }
      return name;
    } catch { /* no local official asset: use the safe procedural fallback */ }
  }
  return null;
}
void loadOfficialSceneSurfaceTexture();

// 足球：程序化生成（无可再分发的球体素材；本地纹理可选）
function ballTexture() {
  const s = 128, cv = document.createElement('canvas'); cv.width = cv.height = s;
  const g = cv.getContext('2d');
  g.fillStyle = '#f4f6f4'; g.fillRect(0, 0, s, s);
  g.fillStyle = '#16181a';
  const pent = (cx, cy, r, rot = 0) => {
    g.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = rot + i * Math.PI * 2 / 5 - Math.PI / 2;
      const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath(); g.fill();
  };
  pent(s / 2, s / 2, s * 0.17);
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5 - Math.PI / 2;
    pent(s / 2 + Math.cos(a) * s * 0.36, s / 2 + Math.sin(a) * s * 0.36, s * 0.145, a);
  }
  const tex = new T.CanvasTexture(cv); tex.colorSpace = T.SRGBColorSpace; return tex;
}
const ball = new T.Mesh(new T.SphereGeometry(CFG.ballR, 26, 18),
  new T.MeshStandardMaterial({ map: ballTexture(), roughness: 0.42, metalness: 0.05 }));
ball.position.set(CX + 0.5, CY + 0.5, CFG.ballR); scene.add(ball);
function setBallAppearance() {
  const profile = getBallProfile(G.ball.type);
  ball.material.color.setHex(profile.color ?? 0xf4f6f4);
  syncBallMesh();
}
function syncBallMesh() {
  const size = G.ball.sizeScale || 1;
  ball.scale.setScalar(size);
  ball.position.set(G.ball.x, G.ball.y, CFG.ballR * size);
}
function terrainKey(r, c) { return `${r}:${c}`; }
function terrainFrictionAt(x, y) {
  const key = terrainKey(tileR(y), tileC(x));
  if (G.iceCells.has(key)) return 0.4;
  if (G.slimeCells.has(key)) return 1.8;
  return 1;
}
function markBallTerrainTrail() {
  const profile = getBallProfile(G.ball.type);
  const r = tileR(G.ball.y), c = tileC(G.ball.x);
  if (r < Y0 || r > Y1 || c < X0 || c > X1) return;
  const key = terrainKey(r, c);
  if (profile.trail === 'ice' && !G.iceCells.has(key)) {
    G.iceCells.add(key);
    const mesh = new T.Mesh(new T.PlaneGeometry(0.92, 0.92),
      new T.MeshBasicMaterial({ color: 0x83d9ff, transparent: true, opacity: 0.32, depthWrite: false }));
    mesh.position.set(c + 0.5, r + 0.5, 0.066);
    scene.add(mesh);
  } else if (profile.trail === 'slime' && !G.slimeCells.has(key)) {
    G.slimeCells.add(key);
    const mesh = new T.Mesh(new T.PlaneGeometry(0.92, 0.92),
      new T.MeshBasicMaterial({ color: 0x9bca8e, transparent: true, opacity: 0.28, depthWrite: false }));
    mesh.position.set(c + 0.5, r + 0.5, 0.067);
    scene.add(mesh);
  }
}


// ---------------- 相机（沿用已验证的反解取景） ----------------
let cam = null, camDebug = '';
function cameraFor(pitch, H) {
  const t = pitch * Math.PI / 180;
  const cy = CY + 0.5 - H * Math.tan(t);
  return officialCamera(`(0,${(cy - 4.19).toFixed(3)},${(7.76 - H).toFixed(3)},1)`,
    { width: innerWidth, height: innerHeight }, { pitch });
}
function fitCamera() {
  const w = innerWidth, h = innerHeight;
  let best = null;
  outer:
  for (let pitch = 16; pitch <= 60; pitch += 2) {
    for (let H = 8; H <= 90; H += 0.5) {
      const c = cameraFor(pitch, H);
      const ok = [[0, 0], [COLS, 0], [0, ROWS], [COLS, ROWS]]
        .map(([x, y]) => c.project(x, y, 0))
        .every(p => p.x > w * 0.02 && p.x < w * 0.98 && p.y > h * 0.10 && p.y < h * 0.95);
      if (ok) { best = { c, H, pitch }; break outer; }
    }
  }
  cam = best ? best.c : officialCamera(OFFICIAL_PARAMS.mid_battle_camera_param, { width: w, height: h });
  camDebug = best ? `pitch=${best.pitch}° H=${best.H}` : 'fallback';
  syncThreeCamera(cam, cam3, w, h);
}
function resize() { renderer.setSize(innerWidth, innerHeight, false); fitCamera(); }
resize(); addEventListener('resize', resize);

// ---------------- pixi 叠层 ----------------
const app = new PIXI.Application({ resizeTo: window, backgroundAlpha: 0, antialias: true, resolution: Math.min(2, devicePixelRatio || 1) });
app.view.style.position = 'absolute'; app.view.style.inset = '0';
host.appendChild(app.view);

// ---------------- 障碍（仿官方「随机阵地屏障」） ----------------
const barriers = [];   // {r,c}
function rollBarriers() {
  barriers.length = 0;
  const rnd = (n) => Math.floor(Math.random() * n);
  for (const side of [1, 2]) {                       // 1 = 我方（左）门前, 2 = 敌方（右）门前
    const col = side === 1 ? X0 + 1 : X1 - 1;
    const used = new Set();
    while (used.size < 3) used.add(Y0 + rnd(Y1 - Y0 + 1));
    used.forEach(r => barriers.push({ r, c: col, hp: CFG.barrierHp, maxHp: CFG.barrierHp }));
  }
}
function barrierMesh() {
  const g = new T.Group();
  for (const b of barriers) {
    const m = new T.Mesh(new T.BoxGeometry(0.86, 0.86, 0.42),
      new T.MeshStandardMaterial({ color: VIS.barrier, roughness: 0.5, metalness: 0.35, emissive: 0x3a2600 }));
    m.position.set(b.c + 0.5, b.r + 0.5, 0.21); g.add(m);
  }
  return g;
}
let barrierGroup = null;
function rebuildBarriers() {
  if (barrierGroup) { scene.remove(barrierGroup); }
  barrierGroup = barrierMesh(); scene.add(barrierGroup);
  GRID = buildGrid();
}

// ---------------- 上游 Grid（AI 移动内核） ----------------
let GRID = null;
function buildGrid() {
  const rows = [];
  for (let r = 0; r < ROWS; r++) {
    let line = '';
    for (let c = 0; c < COLS; c++) {
      const isWall = r === 0 || r === ROWS - 1 || c === 0 || c === COLS - 1
        || barriers.some(b => b.r === r && b.c === c);
      line += isWall ? 'h' : 'r';       // 'h' = HIGH/pass FLY ⇒ 地面不可走；'r' = 可走
    }
    rows.push(line);
  }
  return new Grid({ rows }, { r0: 0, r1: ROWS - 1, c0: 0, c1: COLS - 1 });
}
const walkable = (r, c) => GRID.groundPassable(r, c);
// ⚠ 格 r 覆盖 y ∈ [r, r+1)，格心在 r+0.5 —— 由世界坐标取格必须用 floor，
//   用 Math.round 会把格心 (r+0.5) 判成 r+1，整体错一格导致航路第一段就撞墙、AI 冻结。
const tileR = (y) => Math.floor(y);
const tileC = (x) => Math.floor(x);
/** 最近的可行走格（起点被屏障占住时用；否则 waypoints 会判「不可达」直接返回 null） */
function nearestFree(r0, c0) {
  const r = Math.round(r0), c = Math.round(c0);       // ⚠ 必须取整：小数索引会让 tiles[] 取到 undefined
  if (walkable(r, c)) return { r, c };
  for (let rad = 1; rad <= 5; rad++) {
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      const rr = r + dr, cc = c + dc;
      if (walkable(rr, cc)) return { r: rr, c: cc };
    }
  }
  return null;
}

// ---------------- 小人 ----------------
const ROSTER = ['002_amiya', '003_kalts', '009_12fce', '010_chen', '102_texas', '101_sora'];
const actors = [];
async function loadChibi(id, team) {
  const list = await (await fetch('/__chibi?dir=' + encodeURIComponent(id))).json();
  if (!list.skel) throw new Error('no skel ' + id);
  const base = '/chibi/' + id + '/', alias = 'c_' + id + '_' + team;
  PIXI.Assets.add({ alias, src: base + list.skel, data: { spineAtlasFile: base + list.atlas } });
  const loaded = await PIXI.Assets.load(alias);
  const data = loaded.spineData || loaded;
  const sp = new PIXI.spine.Spine(data);
  sp.scale.set(1, 1);
  const natH = sp.height > 1 ? sp.height : 100;
  const names = data.animations.map(a => a.name);
  const has = (n) => names.includes(n);
  sp.state.setAnimation(0, has('Default') ? 'Default' : names[0], true);
  sp.tint = team === 0 ? 0xa8d8ff : 0xffb3a7;
  app.stage.addChild(sp);
  return { id, team, sp, natH, has, anim: has('Default') ? 'Default' : names[0],
    x: 0, y: 0, route: null, legVer: -1, target: null, goal: null,
    facing: team === 0 ? 1 : -1, role: 'field', attackCd: 0,
    attackDamage: CFG.attackDamage, animHold: null,
    maxHp: CFG.operatorHp, hp: CFG.operatorHp, downFor: 0, stunnedFor: 0,
    ballHitCd: 0, barrierAttackCd: 0 };
}
function setAnim(a, name, loop) {
  if (!a.has(name) || a.anim === name) return;
  a.anim = name; a.sp.state.setAnimation(0, name, loop);
}

// ---------------- 比赛状态 ----------------
const STYLE_LABELS = Object.freeze({
  basic: '基础', anchoring: '锚定', offensive: '进攻',
  roaming: '游走', supportive: '辅助', disabling: '制约',
});
const G = {
  ball: createBallState('standard', CX + 0.5, CY + 0.5),
  score: { ally: 0, enemy: 0 },
  t: CFG.playTime, over: false, pause: 0, log: [],
  controlled: 0,
  style: 'basic',
  joy: { x: 0, y: 0 },
  restartTeam: null,
  restartWindow: 0,
  iceCells: new Set(),
  slimeCells: new Set(),
};
const logf = (m) => { G.log.push(m); if (G.log.length > 6) G.log.shift(); hudSide(); };
function hudSide() {
  const el = document.getElementById('side');
  if (!el) return;
  const profile = getBallProfile(G.ball.type);
  el.textContent =
    `相机 ${camDebug}｜行动模式：摇杆 / WASD，1–3 切换\n` +
    `球速 ${Math.hypot(G.ball.vx, G.ball.vy).toFixed(2)}｜${profile.label} 蓄积伤害 ${Math.round(G.ball.damage)}/${getPushThreshold(G.ball)}\n` +
    `当前操作：${ROSTER[G.controlled] || '-'}｜风格：${STYLE_LABELS[G.style] || G.style}\n` + G.log.join('\n');
}

function resetPositions() {
  const mine = actors.filter(a => a.team === 0), foes = actors.filter(a => a.team === 1);
  const place = (a, r, c) => {
    const f = nearestFree(r, c);
    a.x = (f ? f.c : c) + 0.5;
    a.y = (f ? f.r : r) + 0.5;
  };
  mine.forEach((a, i) => {
    a.role = i === mine.length - 1 ? 'goalkeeper' : 'field';
    place(a, a.role === 'goalkeeper' ? Math.round(CY) : Y0 + 1 + i * 2, a.role === 'goalkeeper' ? X0 : X0 + 2 + i);
  });
  foes.forEach((a, i) => {
    a.role = i === foes.length - 1 ? 'goalkeeper' : 'field';
    place(a, a.role === 'goalkeeper' ? Math.round(CY) : Y0 + 1 + i * 2, a.role === 'goalkeeper' ? X1 : X1 - 2 - i);
  });
  for (const a of actors) {
    a.route = null; a.target = null; a.goal = null;
    a.attackCd = 0; a.animHold = null;
    a.hp = a.maxHp; a.downFor = 0; a.stunnedFor = 0;
    a.ballHitCd = 0; a.barrierAttackCd = 0;
  }
  Object.assign(G.ball, createBallState(G.ball.type || 'standard', CX + 0.5, CY + 0.5));
  G.restartTeam = null;
  G.restartWindow = 0;
  G.joy = { x: 0, y: 0 };
  resetJoystickVisual();
  syncBallMesh();
}

function styleProgress() {
  return Math.max(0, Math.min(1, (CFG.playTime - G.t) / CFG.playTime));
}
function operatorAttackDamage(actor) {
  let damage = actor.attackDamage;
  if (actor.team !== 0) return damage;
  if (G.style === 'basic') damage *= 1.1;
  else if (G.style === 'anchoring') damage *= 1 + 0.6 * styleProgress();
  else if (G.style === 'supportive') damage *= 0.9;
  return Math.round(damage);
}
function operatorAttackInterval(actor) {
  return actor.team === 0 && G.style === 'offensive'
    ? CFG.attackInterval / 1.2
    : CFG.attackInterval;
}
function aStyleDisablingTarget(target) {
  const hitter = actors.find(a => a.id === G.ball.lastHitBy);
  return hitter?.team === 0 && target.team === 1 && G.style === 'disabling' ? 2.5 : 1;
}
function ballImpactDamage(target, baseDamage) {
  let damage = baseDamage;
  const hitter = actors.find(a => a.id === G.ball.lastHitBy);
  if (hitter?.team === 0 && target.team === 1) {
    if (G.style === 'supportive') damage *= 0.9;
    if (G.style === 'disabling' && target.stunnedFor <= 0) damage *= 0.85;
  }
  if (target.team === 0 && G.style === 'offensive') damage *= 1.2;
  return Math.max(1, Math.round(damage));
}

function goal(side) {
  const points = getBallProfile(G.ball.type).scoreMultiplier || 1;
  if (side > 0) { G.score.ally += points; sfx('win'); logf(points > 1 ? `我方进球 +${points}` : '我方进球'); }
  else { G.score.enemy += points; sfx('lose'); logf(points > 1 ? `敌方进球 +${points}` : '敌方进球'); }
  G.pause = CFG.resetAfterGoal;
  G.restartTeam = null;
  G.restartWindow = 0;
  rollBarriers(); rebuildBarriers();
  resetPositions();
  updateHud();
}
function updateHud() {
  const allyScore = document.getElementById('scoreAlly');
  const enemyScore = document.getElementById('scoreEnemy');
  if (allyScore) allyScore.textContent = String(G.score.ally);
  if (enemyScore) enemyScore.textContent = String(G.score.enemy);
  const c = document.getElementById('clock');
  if (c) c.textContent = `${String(Math.floor(Math.max(0, G.t) / 60)).padStart(2, '0')}:${String(Math.floor(Math.max(0, G.t) % 60)).padStart(2, '0')}`;

  const sw = document.getElementById('switcher');
  if (sw) {
    const mine = actors.filter(a => a.team === 0);
    const signature = mine.map(a => a.id).join('|') + ':' + G.controlled;
    if (sw.dataset.signature !== signature) {
      sw.dataset.signature = signature;
      sw.innerHTML = mine.map((a, i) =>
        `<button data-i="${i}" class="${i === G.controlled ? 'on' : ''}">${i + 1}·${a.id.replace(/^\d+_/, '')}</button>`
      ).join('');
      sw.querySelectorAll('button').forEach(b => b.onclick = () => {
        G.controlled = Math.min(Math.max(0, +b.dataset.i), Math.max(0, mine.length - 1));
        updateHud();
      });
    }
  }

  const restart = document.getElementById('restart');
  if (restart) {
    restart.hidden = !(G.restartWindow > 0 && G.restartTeam === 0);
    restart.textContent = `重新开球（${Math.ceil(G.restartWindow)}）`;
  }
  hudSide();
}
// ---------------- 音效 ----------------
const AC = window.AudioContext ? new (window.AudioContext)() : null;
const bufCache = {};
async function preloadSfx() {
  if (!AC) return;
  for (const [k, f] of [['win', 'ui/audio/act1multi_b_ui_winscore.wav'], ['lose', 'ui/audio/act1multi_b_ui_losescore.wav']]) {
    try { const r = await fetch(f); bufCache[k] = await AC.decodeAudioData(await r.arrayBuffer()); } catch { }
  }
}
function sfx(k) { if (!AC || !bufCache[k]) return; const s = AC.createBufferSource(); s.buffer = bufCache[k]; s.connect(AC.destination); s.start(); }

// ---------------- 行动模式：摇杆连续移动 + WASD / 方向键 ----------------
const heldKeys = new Set();
const joyRoot = document.getElementById('joystick');
const joyKnob = document.getElementById('joystickKnob');
let joyPointer = null;
const JOY_RADIUS = 39;

function resetJoystickVisual() {
  if (joyKnob) joyKnob.style.transform = 'translate(0px, 0px)';
}
function setJoystickFromPointer(e) {
  if (!joyRoot || !joyKnob) return;
  const rect = joyRoot.getBoundingClientRect();
  let dx = e.clientX - (rect.left + rect.width / 2);
  let dy = e.clientY - (rect.top + 56);
  const length = Math.hypot(dx, dy);
  if (length > JOY_RADIUS) { dx = dx / length * JOY_RADIUS; dy = dy / length * JOY_RADIUS; }
  G.joy = { x: dx / JOY_RADIUS, y: dy / JOY_RADIUS };
  joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
}
if (joyRoot) {
  joyRoot.addEventListener('pointerdown', e => {
    e.preventDefault();
    joyPointer = e.pointerId;
    joyRoot.setPointerCapture?.(e.pointerId);
    setJoystickFromPointer(e);
  });
  joyRoot.addEventListener('pointermove', e => {
    if (joyPointer === e.pointerId) { e.preventDefault(); setJoystickFromPointer(e); }
  });
  const releaseJoy = e => {
    if (joyPointer === e.pointerId) {
      joyPointer = null; G.joy = { x: 0, y: 0 }; resetJoystickVisual();
    }
  };
  joyRoot.addEventListener('pointerup', releaseJoy);
  joyRoot.addEventListener('pointercancel', releaseJoy);
  joyRoot.addEventListener('lostpointercapture', () => {
    joyPointer = null; G.joy = { x: 0, y: 0 }; resetJoystickVisual();
  });
}
function movementInput() {
  let x = G.joy.x, y = G.joy.y;
  if (heldKeys.has('a') || heldKeys.has('arrowleft')) x -= 1;
  if (heldKeys.has('d') || heldKeys.has('arrowright')) x += 1;
  if (heldKeys.has('w') || heldKeys.has('arrowup')) y -= 1;
  if (heldKeys.has('s') || heldKeys.has('arrowdown')) y += 1;
  const length = Math.hypot(x, y);
  if (length > 1) { x /= length; y /= length; }
  return { x, y, active: length > 0.08 };
}
function moveByInput(a, input, speed, dt) {
  if (!input.active) return false;
  // Invert the current perspective projection so joystick direction is field-relative.
  const p = cam.project(a.x, a.y, 0);
  const px = cam.project(a.x + 1, a.y, 0);
  const py = cam.project(a.x, a.y + 1, 0);
  const sxX = px.x - p.x, syX = px.y - p.y;
  const sxY = py.x - p.x, syY = py.y - p.y;
  const det = sxX * syY - sxY * syX;
  let wx = input.x, wy = input.y;
  if (Math.abs(det) > 1e-6) {
    wx = (input.x * syY - sxY * input.y) / det;
    wy = (sxX * input.y - input.x * syX) / det;
  }
  const length = Math.hypot(wx, wy) || 1;
  wx /= length; wy /= length;
  const nx = a.x + wx * speed * dt, ny = a.y + wy * speed * dt;
  const clear = (x, y) => walkable(tileR(y), tileC(x))
    && !barriers.some(b => Math.abs(x - (b.c + 0.5)) < 0.54 && Math.abs(y - (b.r + 0.5)) < 0.54);
  let moved = false;
  if (clear(nx, a.y)) { a.x = nx; moved = true; }
  if (clear(a.x, ny)) { a.y = ny; moved = true; }
  if (moved) {
    a.route = null; a.target = null; a.goal = null;
    if (Math.abs(wx) > 0.08) a.facing = Math.sign(wx);
  }
  return moved;
}
function switchControlled(i) {
  const count = actors.filter(a => a.team === 0).length;
  if (!count) return;
  G.controlled = ((i % count) + count) % count;
  updateHud();
}
addEventListener('keydown', e => {
  const key = e.key.toLowerCase();
  if (['arrowleft','arrowright','arrowup','arrowdown',' '].includes(key)) e.preventDefault();
  if (key === 'tab') {
    e.preventDefault(); switchControlled(G.controlled + 1); return;
  }
  if (/^[1-3]$/.test(key)) {
    const index = Number(key) - 1;
    if (index < actors.filter(a => a.team === 0).length) switchControlled(index);
  }
  if (['a','d','w','s','arrowleft','arrowright','arrowup','arrowdown'].includes(key)) heldKeys.add(key);
});
addEventListener('keyup', e => heldKeys.delete(e.key.toLowerCase()));
addEventListener('blur', () => {
  heldKeys.clear(); G.joy = { x: 0, y: 0 }; resetJoystickVisual();
});

function restartBall(team = G.restartTeam) {
  if (team !== 0 && team !== 1) return;
  G.ball.x = team === 0 ? X0 + 1.45 : X1 - 1.45;
  G.ball.y = Math.max(Y0 + 0.35, Math.min(Y1 + 0.65, G.ball.y));
  G.ball.vx = 0; G.ball.vy = 0; G.ball.damage = 0; G.ball.barrierContact = null;
  G.restartWindow = 0; G.restartTeam = null; G.pause = 0.25;
  logf(team === 0 ? '我方重新开球' : '对方重新开球');
  updateHud();
}
document.getElementById('restart')?.addEventListener('click', () => restartBall(0));

// ---------------- AI（照上游范式：流场航路点逐段推进 + 每步校验 + 版本失效重规划） ----------------
function moveAlong(a, targetRC, speed, dt) {
  let sr = tileR(a.y), sc = tileC(a.x);
  if (!walkable(sr, sc)) {
    const f = nearestFree(sr, sc);
    if (f) { sr = f.r; sc = f.c; a.route = null; a.goal = null; }
  }
  if (!a.route || a.legVer !== GRID.version || !a.goal || a.goal.r !== targetRC.r || a.goal.c !== targetRC.c) {
    const wp = GRID.waypoints(sr, sc, targetRC.r, targetRC.c, { ignoreObstacles: false });
    if (!wp) return false;
    a.route = wp.slice(1).length ? wp.slice(1) : wp;
    a.legVer = GRID.version; a.goal = targetRC;
  }
  let budget = speed * dt, guard = 8;
  while (budget > 1e-9 && a.route.length && guard-- > 0) {
    const [tr, tc] = a.route[0];
    const dx = (tc + 0.5) - a.x, dy = (tr + 0.5) - a.y, d = Math.hypot(dx, dy);
    if (Math.abs(dx) > 0.02) a.facing = Math.sign(dx);
    if (d <= budget) {
      a.x = tc + 0.5; a.y = tr + 0.5; budget -= d; a.route.shift(); continue;
    }
    const nx = a.x + dx / d * budget, ny = a.y + dy / d * budget;
    if (!walkable(tileR(ny), tileC(nx))) break;
    a.x = nx; a.y = ny; budget = 0;
  }
  if (a.route.length === 0) a.route = null;
  return true;
}

// 战术层（上游只有「敌人 AI 的运动内核」可抄，战术选择无现成范式 ⇒ 按同一结构自写）：
//   - 每队只有「离球最近的 1 人」去抢球，且先站到球的进攻反侧（那边才能把球推向对方门）
//   - 其余人保持队形：一人守自家门前列、其余占中场支援位
//   依据：实测「全队同构追球」会让两队挤成一坨互相抵消，60 秒零进球
function teamStep(list, dt, opts) {
  const B = G.ball;
  const { attackDir, ownX } = opts;
  if (!list.length) return;
  const active = list.filter(a => a.downFor <= 0 && a.stunnedFor <= 0);
  const fieldPlayers = active.filter(a => a.role !== 'goalkeeper');
  const candidates = fieldPlayers.length ? fieldPlayers : active;
  let chaser = null, best = Infinity;
  for (const a of candidates) {
    const d = Math.hypot(a.x - B.x, a.y - B.y);
    if (d < best) { best = d; chaser = a; }
  }
  list.forEach((a, i) => {
    if (a.downFor > 0) { if (a.has('Die')) setAnim(a, 'Die', false); return; }
    if (a.stunnedFor > 0) { setAnim(a, a.has('Stun') ? 'Stun' : 'Default', true); return; }
    let tr, tc;
    if (a.role === 'goalkeeper') {
      tc = ownX;
      tr = tileR(B.y);
    } else if (a === chaser) {
      tc = tileC(B.x) + (attackDir > 0 ? -1 : 1);
      tr = tileR(B.y);
    } else {
      const fieldIndex = fieldPlayers.indexOf(a);
      tc = tileC((B.x + ownX) / 2);
      tr = tileR(B.y) + (fieldIndex % 2 ? 2 : -2);
    }
    tc = Math.max(X0, Math.min(X1, tc));
    tr = Math.max(Y0, Math.min(Y1, tr));
    if (!walkable(tr, tc)) {
      const f = nearestFree(tr, tc);
      if (f) { tr = f.r; tc = f.c; }
    }
    const moved = moveAlong(a, { r: tr, c: tc }, CFG.aiSpeed * CFG.moveScale, dt);
    if (!(a.animHold > 0)) setAnim(a, moved ? 'Move' : 'Default', true);
  });
}

function downActor(a, cause = '足球冲击') {
  if (a.downFor > 0) return;
  a.hp = 0;
  const downMultiplier = a.team !== 0 ? 1 : G.style === 'roaming' ? 0.8 : G.style === 'anchoring' ? 1.15 : 1;
  a.downFor = CFG.downDuration * downMultiplier;
  a.stunnedFor = 0;
  a.route = null; a.target = null; a.goal = null; a.animHold = null;
  setAnim(a, a.has('Die') ? 'Die' : 'Default', false);
  logf(`${a.id.replace(/^\d+_/, '')} 被${cause}击倒，进入喘息状态 ${a.downFor} 秒`);
}
function respawnActor(a) {
  const team = actors.filter(x => x.team === a.team);
  const index = Math.max(0, team.indexOf(a));
  const row = a.role === 'goalkeeper' ? Math.round(CY) : Y0 + 1 + ((index * 2) % (Y1 - Y0 + 1));
  const col = a.role === 'goalkeeper'
    ? (a.team === 0 ? X0 : X1)
    : (a.team === 0 ? Math.min(X1 - 1, X0 + 1 + index) : Math.max(X0 + 1, X1 - 1 - index));
  const free = nearestFree(row, col);
  a.x = (free ? free.c : col) + 0.5;
  a.y = (free ? free.r : row) + 0.5;
  a.hp = a.maxHp; a.downFor = 0; a.stunnedFor = 0;
  a.attackCd = 0; a.barrierAttackCd = 0; a.ballHitCd = 0;
  a.route = null; a.target = null; a.goal = null; a.animHold = null;
  a.facing = a.team === 0 ? 1 : -1;
  setAnim(a, 'Default', true);
  logf(`${a.id.replace(/^\d+_/, '')} 恢复行动`);
}

// ---------------- 主循环 ----------------
let last = performance.now();
function step(dt) {
  if (G.restartWindow > 0) {
    G.restartWindow = Math.max(0, G.restartWindow - dt);
    if (G.restartWindow === 0 && G.restartTeam != null) restartBall(G.restartTeam);
  }
  if (G.over) return;
  if (G.pause > 0) { G.pause = Math.max(0, G.pause - dt); return; }
  G.t -= dt;
  if (G.t <= 0) { G.t = 0; endMatch(); return; }

  const B = G.ball;
  for (const a of actors) {
    a.attackCd = Math.max(0, a.attackCd || 0);
    a.barrierAttackCd = Math.max(0, a.barrierAttackCd || 0);
    a.ballHitCd = Math.max(0, a.ballHitCd || 0);
    if (a.downFor > 0) {
      a.downFor = Math.max(0, a.downFor - dt);
      if (a.downFor === 0) respawnActor(a);
      continue;
    }
    a.stunnedFor = Math.max(0, (a.stunnedFor || 0) - dt);
    const styleHpFactor = a.team === 0 && G.style === 'anchoring' ? 1 + 0.6 * styleProgress() : 1;
    a.maxHp = CFG.operatorHp * styleHpFactor;
    a.hp = Math.min(a.hp, a.maxHp);
    a.attackCd = Math.max(0, a.attackCd - dt);
    a.barrierAttackCd = Math.max(0, a.barrierAttackCd - dt);
    a.ballHitCd = Math.max(0, a.ballHitCd - dt);
  }
  const mine = actors.filter(a => a.team === 0), foes = actors.filter(a => a.team === 1);
  const me = mine[G.controlled];
  if (me && me.downFor <= 0 && me.stunnedFor <= 0) {
    const moved = moveByInput(me, movementInput(), CFG.opSpeed * CFG.moveScale, dt);
    if (!(me.animHold > 0)) setAnim(me, moved ? 'Move' : 'Default', true);
  } else if (me?.downFor > 0 && me.has('Die')) {
    setAnim(me, 'Die', false);
  } else if (me?.stunnedFor > 0) {
    setAnim(me, me.has('Stun') ? 'Stun' : 'Default', true);
  }
  teamStep(mine.filter((_, i) => i !== G.controlled), dt, { attackDir: +1, ownX: X0 });
  teamStep(foes, dt, { attackDir: -1, ownX: X1 });

  // Separate units without allowing normal control to walk through fixed barriers.
  for (const team of [0, 1]) {
    const list = actors.filter(a => a.team === team);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const A = list[i], C = list[j];
      let dx = C.x - A.x, dy = C.y - A.y, d = Math.hypot(dx, dy);
      const min = 0.68;
      if (d < min) {
        if (d < 1e-4) { dx = 1; dy = 0; d = 1; }
        const push = (min - d) / 2;
        A.x -= dx / d * push; A.y -= dy / d * push;
        C.x += dx / d * push; C.y += dy / d * push;
      }
    }
  }

  // A nearby operator attacks on a cooldown; contact alone does not move the football.
  let explodedThisFrame = false;
  for (const a of actors) {
    if (a.downFor > 0 || a.stunnedFor > 0) continue;
    const d = Math.hypot(B.x - a.x, B.y - a.y);
    if (d <= CFG.attackRange && a.attackCd <= 0) {
      a.attackCd = operatorAttackInterval(a);
      const hit = applyOperatorHit(B, {
        id: a.id, x: a.x, y: a.y,
        cellX: tileC(a.x), cellY: tileR(a.y),
        attackDamage: operatorAttackDamage(a),
      });
      if (hit.pushed) {
        logf(`${a.team === 0 ? '我方' : '敌方'}累计伤害达到推动阈值，足球被推动`);
        const attackClip = a.has('Attack') ? 'Attack' : a.has('Interact') ? 'Interact' : 'Default';
        setAnim(a, attackClip, false);
        a.animHold = 0.24;
        if (hit.explode) {
          const explosive = getBallProfile(B.type);
          for (const target of actors) {
            if (target.downFor > 0) continue;
            const radius = Math.hypot(target.x - B.x, target.y - B.y);
            if (radius <= explosive.explosionRadius) {
              target.hp = Math.max(0, target.hp - explosive.explosionDamage);
              const statusMultiplier = aStyleDisablingTarget(target);
              target.stunnedFor = Math.max(target.stunnedFor, explosive.explosionStun * statusMultiplier);
              if (target.hp <= 0) downActor(target, '爆炸足球');
            }
          }
          logf('爆炸足球引爆：范围 1.5，真实伤害 1500，眩晕 3 秒');
          Object.assign(B, createBallState('explosive', B.x, B.y));
          setBallAppearance();
          explodedThisFrame = true;
          break;
        }
      }
    }
  }

  // Operators can also attack nearby formation barriers; the ball uses its own attack value below.
  for (const a of actors) {
    if (a.downFor > 0 || a.stunnedFor > 0 || a.barrierAttackCd > 0) continue;
    if (Math.hypot(B.x - a.x, B.y - a.y) <= CFG.attackRange) continue;
    let target = null, nearest = CFG.barrierAttackRange;
    for (const barrier of barriers) {
      const d = Math.hypot(a.x - (barrier.c + 0.5), a.y - (barrier.r + 0.5));
      if (d < nearest) { nearest = d; target = barrier; }
    }
    if (!target) continue;
    target.hp -= operatorAttackDamage(a);
    a.barrierAttackCd = CFG.attackInterval;
    if (target.hp <= 0) {
      const index = barriers.indexOf(target);
      if (index >= 0) barriers.splice(index, 1);
      rebuildBarriers();
      logf('干员击破阵地屏障');
    }
  }

  if (explodedThisFrame) {
    updateHud();
    return;
  }
  const terrainFriction = terrainFrictionAt(B.x, B.y);
  advanceBallMotion(B, dt, terrainFriction);
  markBallTerrainTrail();
  const profile = getBallProfile(B.type);
  const ballRadius = CFG.ballR * (B.sizeScale || 1);
  if (B.y < Y0 + ballRadius) {
    B.y = Y0 + ballRadius; B.vy = Math.abs(B.vy) * profile.restitution;
  }
  if (B.y > Y1 + 1 - ballRadius) {
    B.y = Y1 + 1 - ballRadius; B.vy = -Math.abs(B.vy) * profile.restitution;
  }

  // Position barriers take damage from ball impacts and can be destroyed.
  for (let i = barriers.length - 1; i >= 0; i--) {
    const b = barriers[i], key = `${b.c}:${b.r}`;
    const cx = b.c + 0.5, cy = b.r + 0.5;
    const hw = 0.43 + ballRadius, hh = 0.43 + ballRadius;
    if (Math.abs(B.x - cx) < hw && Math.abs(B.y - cy) < hh) {
      if (B.barrierContact !== key) {
        b.hp -= profile.attack;
        B.barrierContact = key;
        if (b.hp <= 0) {
          barriers.splice(i, 1);
          rebuildBarriers();
          B.barrierContact = null;
          B.vx *= 0.8; B.vy *= 0.8;
          logf('阵地屏障被足球击破');
          break;
        }
      }
      const ox = hw - Math.abs(B.x - cx), oy = hh - Math.abs(B.y - cy);
      if (ox < oy) {
        B.x = cx + (B.x >= cx ? hw : -hw);
        B.vx = -B.vx * profile.restitution;
      } else {
        B.y = cy + (B.y >= cy ? hh : -hh);
        B.vy = -B.vy * profile.restitution;
      }
    } else if (B.barrierContact === key) {
      B.barrierContact = null;
    }
  }

  // A goalie blocks a ball travelling toward their own goal and allows a five-second restart.
  for (const a of actors) {
    if (a.role !== 'goalkeeper') continue;
    const towardOwnGoal = (a.team === 0 && B.vx < 0) || (a.team === 1 && B.vx > 0);
    if (!towardOwnGoal) continue;
    if (Math.hypot(B.x - a.x, B.y - a.y) <= ballRadius + 0.34) {
      B.vx = 0; B.vy = 0; B.damage = 0; B.barrierContact = null;
      B.x = a.team === 0 ? X0 + 0.8 : X1 + 0.2;
      B.y = Math.max(Y0 + 0.35, Math.min(Y1 + 0.65, a.y));
      G.restartTeam = a.team; G.restartWindow = 5; G.pause = 0.2;
      logf(`${a.team === 0 ? '我方' : '敌方'}守门员挡球：5 秒内可重新开球`);
      syncBallMesh();
      updateHud();
      return;
    }
  }

  const ballImpactSpeed = Math.hypot(B.vx, B.vy);
  for (const a of actors) {
    if (a.role === 'goalkeeper' || a.downFor > 0 || a.ballHitCd > 0 || explodedThisFrame) continue;
    if (ballImpactSpeed < 0.35) continue;
    if (Math.hypot(B.x - a.x, B.y - a.y) > ballRadius + 0.28) continue;
    a.ballHitCd = CFG.ballHitCooldown;
    const damage = ballImpactDamage(a, getBallProfile(B.type).attack);
    a.hp = Math.max(0, a.hp - damage);
    if (a.hp <= 0) downActor(a, getBallProfile(B.type).label);
    else logf(`${a.id.replace(/^\d+_/, '')} 受到足球冲击：-${damage} HP`);
  }

  if (B.x < X0 - 0.15) return goal(-1);
  if (B.x > X1 + 1 + 0.15) return goal(+1);
  syncBallMesh();

  for (const a of actors) {
    if (a.animHold != null) {
      a.animHold -= dt;
      if (a.animHold <= 0) {
        a.animHold = null;
        if (a.downFor > 0) setAnim(a, a.has('Die') ? 'Die' : 'Default', false);
        else if (a.stunnedFor > 0) setAnim(a, a.has('Stun') ? 'Stun' : 'Default', true);
        else setAnim(a, a === me && movementInput().active ? 'Move' : 'Default', true);
      }
    }
  }
}

function endMatch() {
  G.over = true;
  document.getElementById('overImg').src = 'ui/football/match_over.png';
  const margin = G.score.ally - G.score.enemy;
  const stamps = margin >= 4 ? 3 : margin >= 2 ? 2 : margin >= 1 ? 1 : 0;
  const result = document.getElementById('resultText');
  if (result) result.textContent =
    `终场 ${G.score.ally} : ${G.score.enemy}｜净胜球 ${margin}｜嘉奖印章 ${stamps}/3（目标：净胜 1 / 2 / 4 球）`;
  document.getElementById('over').style.display = 'flex';
  logf(`比赛结束 ${G.score.ally} : ${G.score.enemy}`);
}

function frame() {
  try {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (!G.over) step(dt);
    syncThreeCamera(cam, cam3, innerWidth, innerHeight);
    renderer.render(scene, cam3);
    for (const a of actors) {
      const p = cam.project(a.x, a.y, 0);
      a.sp.x = p.x; a.sp.y = p.y;
      const s = 1.2 * p.s / a.natH;
      const sign = a.facing < 0 ? -1 : 1;
      a.sp.scale.set(s * sign, s);
      a.sp.update(dt);
    }
    updateHud();
  } catch (e) { window.__cue = { err: String(e && e.message || e) }; }
  requestAnimationFrame(frame);
}

// ---------------- 启动 ----------------
window.__cu = {
  G, actors, field: { COLS, ROWS, X0, X1, Y0, Y1 }, cfg: CFG, barriers,
  ready: false, camDebug: () => camDebug,
  corners: () => [[0, 0], [COLS, 0], [COLS, ROWS], [0, ROWS]].map(([x, y]) => { const q = cam.project(x, y, 0); return [Math.round(q.x), Math.round(q.y)]; }),
  switchTo: (i) => { switchControlled(i); },
  setInput: (x, y) => { G.joy = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) }; },
  movementInput,
  hitBall: (actorIndex = G.controlled) => {
    const a = actors.filter(x => x.team === 0)[actorIndex];
    return a ? applyOperatorHit(G.ball, { id: a.id, x: a.x, y: a.y, cellX: tileC(a.x), cellY: tileR(a.y), attackDamage: a.attackDamage }) : null;
  },
  camProj: (x, y) => { const q = cam.project(x, y, 0); return [Math.round(q.x), Math.round(q.y)]; },
  moveTo: (r, c) => { const me = actors.filter(a => a.team === 0)[G.controlled]; if (me && walkable(r, c)) { me.target = { r, c }; me.route = null; me.goal = null; return true; } return false; },
  testPick: (sx, sy) => { const h = pickTile(cam, sx, sy, () => 0, [0], 64, 64); return h ? { row: h.row, col: h.col } : null; },
  dbg: (sr, sc, er, ec) => {
    const out = { pass: [], wp: null, err: null };
    for (let r = 0; r < ROWS; r++) { let s = ''; for (let c = 0; c < COLS; c++) s += GRID.groundPassable(r, c) ? '.' : '#'; out.pass.push(s); }
    try { out.wp = GRID.waypoints(sr, sc, er, ec, { ignoreObstacles: false }); } catch (e) { out.err = String(e.message); }
    return out;
  },
};
(async () => {
  // 选人界面
  const pick = document.getElementById('pick');
  const btnBox = document.getElementById('pickBtns');
  for (const id of ROSTER) {
    const b = document.createElement('button');
    b.textContent = id.replace(/^\d+_/, '');
    b.onclick = async () => { pick.style.display = 'none'; await start(id); };
    btnBox.appendChild(b);
  }
  if (location.search.includes('auto=1')) { pick.style.display = 'none'; await start(ROSTER[0]); }
})();

async function start(myId) {
  const selectedType = document.getElementById('ballType')?.value || 'standard';
  Object.assign(G.ball, createBallState(selectedType, CX + 0.5, CY + 0.5));
  G.iceCells.clear();
  G.slimeCells.clear();
  G.style = document.getElementById('teamStyle')?.value || G.style || 'basic';
  setBallAppearance();
  rollBarriers(); GRID = buildGrid();
  const mineIds = [myId, ...ROSTER.filter(x => x !== myId).slice(0, CFG.squad - 1)];
  const foeIds = ROSTER.filter(x => !mineIds.includes(x)).slice(0, CFG.squad);
  for (const id of mineIds) { try { actors.push(await loadChibi(id, 0)); } catch (e) { logf('载入失败 ' + id); } }
  for (const id of foeIds) { try { actors.push(await loadChibi(id, 1)); } catch (e) { logf('载入失败 ' + id); } }
  rebuildBarriers();
  resetPositions(); updateHud(); preloadSfx();
  // 风格条（官方 6 种比赛风格）
  const bar = document.getElementById('stylebar');
  ['basic', 'anchoring', 'offensive', 'roaming', 'supportive', 'disabling'].forEach((s, i) => {
    const img = document.createElement('img');
    img.src = `ui/style/buff_icon_${s}_show.png`;
    img.alt = STYLE_LABELS[s];
    img.title = `${STYLE_LABELS[s]}风格（原型简化规则）`;
    img.setAttribute('role', 'button');
    img.tabIndex = 0;
    if (s === G.style) img.classList.add('on');
    const selectStyle = () => {
      G.style = s;
      bar.querySelectorAll('img').forEach(x => x.classList.toggle('on', x === img));
      const select = document.getElementById('teamStyle');
      if (select) select.value = s;
      logf(`比赛风格 → ${STYLE_LABELS[s]}`);
      updateHud();
    };
    img.onclick = selectStyle;
    img.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectStyle(); } };
    bar.appendChild(img);
  });
  const hud = document.getElementById('hud'), clk = document.getElementById('clock');
  if (hud) hud.style.display = 'flex';
  if (clk) clk.style.display = 'block';
  window.__cu.ready = true;
  requestAnimationFrame(frame);
}
document.getElementById('again').onclick = () => location.reload();
