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
  playTime: 300,                // options.maxPlayTime
  moveScale: 0.5,               // options.moveMultiplier
  squad: 3,                     // 1 名玩家操作 + 2 名 AI 队友（官方 characterLimit=4）
  opRadius: 0.40,
  opSpeed: 2.6,                 // 格/秒（×moveScale 后仍比敌人快一点，保证可玩）
  aiSpeed: 2.2,
  ballR: 0.26,
  ballFriction: 0.34,
  ballRestitution: 0.66,
  kickSpeed: 5.6,
  kickCd: 0.22,
  barrierBounce: 0.72,
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
    box(SLAB - 0.045, SLAB - 0.045, 0.10, color, c + 0.5, r + 0.5, inside || c === 0 || c === COLS - 1 ? 0 : 0.0,
      { rough: inside ? 0.96 : 0.7, metal: inside ? 0.02 : 0.25 });
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

// 足球：程序化生成（官方无球体素材；白底 + 黑五边形，CC0 安全）
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
    used.forEach(r => barriers.push({ r, c: col }));
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
    x: 0, y: 0, kx: 0, route: null, legVer: -1, target: null };
}
function setAnim(a, name, loop) {
  if (!a.has(name) || a.anim === name) return;
  a.anim = name; a.sp.state.setAnimation(0, name, loop);
}

// ---------------- 比赛状态 ----------------
const G = {
  ball: { x: CX + 0.5, y: CY + 0.5, vx: 0, vy: 0 },
  score: { ally: 0, enemy: 0 },
  t: CFG.playTime, over: false, pause: 0, log: [],
  controlled: 0,          // 当前操作的己方小人索引
};
const logf = (m) => { G.log.push(m); if (G.log.length > 6) G.log.shift(); hudSide(); };
function hudSide() {
  const el = document.getElementById('side');
  if (!el) return;
  el.textContent =
    `相机 ${camDebug}｜模式 单人（${CFG.squad} 人小队：操作 1 + AI 队友 ${CFG.squad - 1}）\n` +
    `球 (${G.ball.x.toFixed(2)}, ${G.ball.y.toFixed(2)}) 速度 ${Math.hypot(G.ball.vx, G.ball.vy).toFixed(2)}｜当前操作：${ROSTER[G.controlled] || '-'}\n` +
    G.log.join('\n');
}

function resetPositions() {
  const mine = actors.filter(a => a.team === 0), foes = actors.filter(a => a.team === 1);
  const place = (a, r, c) => { const f = nearestFree(r, c); a.x = (f ? f.c : c) + 0.5; a.y = (f ? f.r : r) + 0.5; };
  mine.forEach((a, i) => place(a, Y0 + 1 + i * 2.5, X0 + 1));
  foes.forEach((a, i) => place(a, Y0 + 1 + i * 2.5, X1 - 1));
  for (const a of actors) { a.route = null; a.target = null; a.goal = null; }
  G.ball.x = CX + 0.5; G.ball.y = CY + 0.5; G.ball.vx = 0; G.ball.vy = 0;
}
function goal(side) {     // side=+1 我方进球（球进右门）, -1 敌方进球
  if (side > 0) { G.score.ally++; sfx('win'); logf('⚽ 我方进球！'); }
  else { G.score.enemy++; sfx('lose'); logf('⚽ 敌方进球'); }
  G.pause = CFG.resetAfterGoal;
  rollBarriers(); rebuildBarriers();
  resetPositions();
  updateHud();
}
function updateHud() {
  const n = document.getElementById('sNum'), a = document.getElementById('sAlly'), e = document.getElementById('sEnemy');
  if (n) {
    const lead = G.score.ally > G.score.enemy, behind = G.score.ally < G.score.enemy;
    n.src = lead ? 'ui/football/img_ally_score.png' : behind ? 'ui/football/img_enemy_score.png' : 'ui/football/img_draw_score.png';
    if (a) a.style.display = 'none';   // 官方素材是三张独立 badge，只显示当前生效的那张
    if (e) e.style.display = 'none';
  }
  const c = document.getElementById('clock');
  if (c) c.textContent = `${String(Math.floor(Math.max(0, G.t) / 60)).padStart(2, '0')}:${String(Math.floor(Math.max(0, G.t) % 60)).padStart(2, '0')}`;
  const sw = document.getElementById('switcher');
  if (sw) {
    sw.innerHTML = actors.filter(a => a.team === 0)
      .map((a, i) => `<button data-i="${i}" class="${i === G.controlled ? 'on' : ''}">${i + 1}·${a.id.replace(/^\d+_/, '')}</button>`).join('');
    sw.querySelectorAll('button').forEach(b => b.onclick = () => { G.controlled = +b.dataset.i; logf('切换操作 → ' + ROSTER[G.controlled]); updateHud(); });
  }
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

// ---------------- 交互：点击地面 = 操作角色前往；Tab/1-3 = 切角色 ----------------
let clickTarget = null;
host.addEventListener('pointerdown', (e) => {
  if (e.target.closest('#hud') || e.target.closest('#tip') || e.target.closest('#side') || e.target.closest('#switcher') || e.target.closest('#pick')) return;
  const hit = pickTile(cam, e.clientX, e.clientY, () => 0, [0], 64, 64);
  if (!hit) return;
  clickTarget = { x: hit.col, y: hit.row };
  const me = actors.filter(a => a.team === 0)[G.controlled];
  if (me && walkable(hit.row, hit.col)) { me.target = { r: hit.row, c: hit.col }; me.route = null; }
});
addEventListener('keydown', (e) => {
  if (e.key === 'Tab') { e.preventDefault(); G.controlled = (G.controlled + 1) % CFG.squad; logf('切换操作'); updateHud(); }
  if (/^[1-9]$/.test(e.key)) { const i = +e.key - 1; if (i < CFG.squad) { G.controlled = i; logf('切换操作'); updateHud(); } }
});

// ---------------- AI（照上游范式：流场航路点逐段推进 + 每步校验 + 版本失效重规划） ----------------
function moveAlong(a, targetRC, speed, dt) {
  let sr = tileR(a.y), sc = tileC(a.x);
  if (!walkable(sr, sc)) { const f = nearestFree(sr, sc); if (f) { sr = f.r; sc = f.c; a.route = null; a.goal = null; } }
  if (!a.route || a.legVer !== GRID.version || !a.goal || a.goal.r !== targetRC.r || a.goal.c !== targetRC.c) {
    const wp = GRID.waypoints(sr, sc, targetRC.r, targetRC.c, { ignoreObstacles: false });
    if (!wp) return false;
    a.route = wp.slice(1).length ? wp.slice(1) : wp;   // 丢掉「当前所在格」，直接从下一格开始
    a.legVer = GRID.version; a.goal = targetRC;
  }
  let budget = speed * dt, guard = 8;
  while (budget > 1e-9 && a.route.length && guard-- > 0) {
    const [tr, tc] = a.route[0];
    const dx = (tc + 0.5) - a.x, dy = (tr + 0.5) - a.y, d = Math.hypot(dx, dy);
    if (d <= budget) { a.x = tc + 0.5; a.y = tr + 0.5; budget -= d; a.route.shift(); continue; }
    const nx = a.x + dx / d * budget, ny = a.y + dy / d * budget;
    if (!walkable(tileR(ny), tileC(nx))) break;          // 每步校验可通行（floor 取格）
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
  let chaser = null, best = Infinity;
  for (const a of list) {
    const d = Math.hypot(a.x - B.x, a.y - B.y);
    if (d < best) { best = d; chaser = a; }
  }
  list.forEach((a, i) => {
    let tr, tc;
    if (a === chaser) {
      tc = tileC(B.x) + (attackDir > 0 ? -1 : 1);              // 球的进攻反侧
      tr = tileR(B.y);
    } else if (i === 0) {
      tc = ownX + attackDir;                                    // 门将：自家门前列
      tr = tileR(B.y);
    } else {
      tc = tileC((B.x + ownX) / 2);                             // 中场支援
      tr = tileR(B.y) + (i % 2 ? 2 : -2);
    }
    tc = Math.max(X0, Math.min(X1, tc)); tr = Math.max(Y0, Math.min(Y1, tr));
    if (!walkable(tr, tc)) { const f = nearestFree(tr, tc); if (f) { tr = f.r; tc = f.c; } }
    const moved = moveAlong(a, { r: tr, c: tc }, CFG.aiSpeed, dt);
    setAnim(a, moved ? 'Move' : 'Default', true);
  });
}

// ---------------- 主循环 ----------------
let last = performance.now();
function step(dt) {
  if (G.over) return;
  if (G.pause > 0) { G.pause -= dt; return; }
  G.t -= dt;
  if (G.t <= 0) { G.t = 0; endMatch(); return; }

  const B = G.ball;
  const mine = actors.filter(a => a.team === 0), foes = actors.filter(a => a.team === 1);

  // 玩家操作的角色
  const me = mine[G.controlled];
  if (me) {
    if (me.target) {
      const ok = moveAlong(me, me.target, CFG.opSpeed, dt);
      setAnim(me, ok ? 'Move' : 'Default', true);
      if (me.route === null) me.target = null;
    } else setAnim(me, 'Default', true);
  }
  // AI 队友（进攻方向 = 右，自家门在左）；玩家操作的那名不参与 AI
  teamStep(mine.filter((_, i) => i !== G.controlled), dt, { attackDir: +1, ownX: X0 });
  // 敌方 AI（进攻方向 = 左，自家门在右）
  teamStep(foes, dt, { attackDir: -1, ownX: X1 });

  // 队内分离（避免叠人）
  for (const team of [0, 1]) {
    const list = actors.filter(a => a.team === team);
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const A = list[i], C = list[j];
      let dx = C.x - A.x, dy = C.y - A.y, d = Math.hypot(dx, dy);
      const min = 0.85;
      if (d < min) {
        if (d < 1e-4) { dx = 1; dy = 0; d = 1; }
        const push = (min - d) / 2;
        A.x -= dx / d * push; A.y -= dy / d * push;
        C.x += dx / d * push; C.y += dy / d * push;
      }
    }
  }

  // 踢球锁：一脚之后短暂锁定，让球真正滚出去（否则两队贴身互踢会把球钉在中场）
  B.kickLock = Math.max(0, (B.kickLock || 0) - dt);

  // 干员 → 球：接触即踢（朝进攻方向）
  for (const a of actors) {
    a.kx = (a.kx || 0) - dt;
    const dx = B.x - a.x, dy = B.y - a.y, d = Math.hypot(dx, dy);
    if (kx(a) && !(B.kickLock > 0) && d < CFG.opRadius + CFG.ballR + 0.10) {
      a.kx = CFG.kickCd; B.kickLock = 0.20;
      const attackDir = a.team === 0 ? 1 : -1;
      const gx = (attackDir > 0 ? X1 + 1.5 : X0 - 0.5) - B.x;
      const gy = (CY + 0.5) - B.y;
      const gd = Math.hypot(gx, gy) || 1;
      const dirx = 0.42 * (dx / (d || 1)) + 0.58 * (gx / gd);
      const diry = 0.42 * (dy / (d || 1)) + 0.58 * (gy / gd);
      const n = Math.hypot(dirx, diry) || 1;
      B.vx = dirx / n * CFG.kickSpeed; B.vy = diry / n * CFG.kickSpeed;
      setAnim(a, a.has('Interact') ? 'Interact' : 'Default', false);
      a.animHold = 0.3;
    }
  }

  // 球物理
  B.x += B.vx * dt; B.y += B.vy * dt;
  const fr = Math.pow(1 - CFG.ballFriction, dt);
  B.vx *= fr; B.vy *= fr;
  if (Math.hypot(B.vx, B.vy) < 0.02) { B.vx = 0; B.vy = 0; }

  // 上下界反弹（row 0 / row 8 是界外）
  if (B.y < Y0 + CFG.ballR) { B.y = Y0 + CFG.ballR; B.vy = Math.abs(B.vy) * CFG.ballRestitution; }
  if (B.y > Y1 + 1 - CFG.ballR) { B.y = Y1 + 1 - CFG.ballR; B.vy = -Math.abs(B.vy) * CFG.ballRestitution; }
  // 屏障反弹
  for (const b of barriers) {
    const cx = b.c + 0.5, cyy = b.r + 0.5, hw = 0.43 + CFG.ballR, hh = 0.43 + CFG.ballR;
    if (Math.abs(B.x - cx) < hw && Math.abs(B.y - cyy) < hh) {
      const ox = hw - Math.abs(B.x - cx), oy = hh - Math.abs(B.y - cyy);
      if (ox < oy) { B.x = cx + Math.sign(B.x - cx) * hw; B.vx = -B.vx * CFG.barrierBounce; }
      else { B.y = cyy + Math.sign(B.y - cyy) * hh; B.vy = -B.vy * CFG.barrierBounce; }
    }
  }
  // 进球：球越过球门列（col 0 = 我方门，col 12 = 敌方门）
  if (B.x < X0 - 0.15) return goal(-1);
  if (B.x > X1 + 1 + 0.15) return goal(+1);

  ball.position.set(B.x, B.y, CFG.ballR);

  for (const a of actors) {
    if (a.animHold != null) { a.animHold -= dt; if (a.animHold <= 0) { a.animHold = null; setAnim(a, 'Default', true); } }
  }
}
const kx = (a) => !(a.kx > 0);
function endMatch() {
  G.over = true;
  document.getElementById('overImg').src = 'ui/football/match_over.png';
  document.getElementById('over').style.display = 'flex';
  logf(`🏁 比赛结束 ${G.score.ally} : ${G.score.enemy}`);
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
      const sign = a.sp.scale.x < 0 ? -1 : 1;
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
  switchTo: (i) => { G.controlled = i; updateHud(); },
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
    if (i === 0) img.classList.add('on');
    img.onclick = () => { bar.querySelectorAll('img').forEach(x => x.classList.remove('on')); img.classList.add('on'); logf('风格 → ' + s); };
    bar.appendChild(img);
  });
  const hud = document.getElementById('hud'), clk = document.getElementById('clock');
  if (hud) hud.style.display = 'flex';
  if (clk) clk.style.display = 'block';
  window.__cu.ready = true;
  requestAnimationFrame(frame);
}
document.getElementById('again').onclick = () => location.reload();
