# 促融共竞 · 阵地足球（独立场景与玩法）

一个**独立**的网页小游戏：复刻《明日方舟》限时玩法「促融共竞」中的**阵地足球**子项目。
不是宿主游戏的 mod、也不是它的一个模式——**单独一套场景与玩法**，只借用
[`sganggs/Stronghold-Protocol`](https://github.com/sganggs/Stronghold-Protocol) 的框架件。

## 玩

```bash
python serve.py            # 默认 0.0.0.0:8100
# 浏览器打开 http://localhost:8100
```

1. **选 1 个角色**（单人模式）
2. 另外 2 名是 **AI 队友**；对面 3 名 AI 对手
3. 比赛中随时按 **1 / 2 / 3** 或 **Tab** **切换你操作的角色**
4. 使用摇杆（或 WASD / 方向键）连续移动当前角色；1 / 2 / 3 或 Tab 切换角色
5. 角色进入足球攻击范围后会自动攻击；**只有累计伤害达到该足球的推动阈值才会推动**，接触本身不会踢球
6. 推球方向取角色中心到足球的延长线；同格攻击固定向右；远距离攻击对既有球运动方向的影响减弱
7. 守门员可挡下朝己方球门飞来的足球，挡球后可在 5 秒内重新开球；阵地屏障会受球撞击并可被击破
8. 5 分钟一局；净胜 1 / 2 / 4 球对应 1 / 2 / 3 枚嘉奖印章

## 官方依据

| 项目 | 来源 |
|---|---|
| 场地布局 **13 列 × 9 行**（col0 = 盟友门列 / col12 = 敌方门列 / row0,row8 = 界外；内区 11×7 = `tile_football`） | `data/level_act1multi_football.json`（`mapData.map` 实测） |
| 一局 **300 秒**、**移动倍率 0.5**、初始费用 30、费用增速 0.85 | 同文件 `options` |
| 足球规则（10 种足球的推动伤害阈值、攻击/摩擦/弹性/推力、特殊球效果、守门位、阵地屏障、净胜球印章） | PRTS 促融共竞条目；参数集中在 `lib/football-rules.mjs` |
| 视觉（**非绿茵场**：灰白水泥大板 + 青色发光边线 + 左蓝右红钢桁架球门 + 深色看台） | 官方预览图 `multi_v3_01-football_preview` 像素实测 |

## 复用的框架件（来自 Stronghold-Protocol）

| 文件 | 用途 | 说明 |
|---|---|---|
| `lib/projection.js` | **官方相机模型**（`officialCamera` / `pickTile` / `syncThreeCamera` + 13 个官方相机预设） | 零依赖，可原样搬 |
| `lib/grid.js` | **官方 SPFA 流场寻路**（`Grid.waypoints`）—— AI 的移动内核 | 依赖下两项 |
| `lib/sim-constants.js`、`lib/shared-constants.js`、`lib/detmath.js` | 上者的依赖闭包（`GEO` / `hypot` 等） | 改了两处 import 路径，并把 `N_` 就地换成恒等函数 |

玩家操作改为基建「行动模式」的摇杆连续移动；浏览器端另提供 WASD / 方向键。AI 仍沿用 Stronghold 的流场航路点、
逐段推进、每步校验可通行与网格版本失效后重规划。足球规则拆成纯函数模块 `lib/football-rules.mjs`，
可独立测试；镜头和 Grid 只作为框架参考，不把 Stronghold 的自动战斗循环伪装成足球玩法。

## 自建的部分（官方素材里没有）

审计确认：客户端**没有任何足球场景几何**——`battle/prefabs/effects/football.ab` 只有粒子特效，
`ui/footballcup` 只有 HUD 图标，`activity/[uc]multiv3.ab` 是纯 UI 包（0 个 Level/MapData），
`scenes/activities/` 下 act*multi 的关卡包已被赛季清理。所以：

- **球场 / 球门 / 足球 / 灯光条纹** = three.js 自建几何
- **足球贴图** = canvas 程序化生成（白底 + 黑五边形），无第三方素材依赖
- **球物理 / 推球 / 计分 / 计时 / AI 战术层** = 自写

## 素材（`assets/`，**不入库**）

官方 HUD、音效、小人骨骼版权归**鹰角网络 / Yostar**，仓库不再分发。
请按 [`assets/README.md`](assets/README.md) 用 `tools/extract-assets.py` 从你自己的客户端生成。
缺素材时页面照常运行，只是相应内容不显示。

## 第三方

`vendor/`：pixi.js 7.4.2（MIT）、pixi-spine 4.0.6（MIT）、three.js r186（MIT）。

## 许可

代码 MIT（见 `LICENSE`）。官方素材与 `data/level_act1multi_football.json` 不在 MIT 覆盖范围内。


## 规则边界与验证

- `lib/football-rules.mjs` 集中存放 10 种足球的公开参数，包含推动阈值、攻击、摩擦、弹性、推力；并实现伤害累计、爆炸触发、三倍得分、漏气/膨胀的尺寸与阈值变化，以及冰面/黏液地形摩擦。
- 选人页的足球下拉框是独立原型的规则测试入口；它把不同官方足球规则放到同一个单人练习场，不代表官方活动用一个菜单让玩家自由切换足球类型。
- 六种比赛风格图标现已会影响演示玩法：基础、锚定、进攻、游走、辅助、制约；受独立原型没有完整部署/技能/治疗/SP系统限制，未能复现所有官方加成与道具，风格效果是对可表达部分的简化映射。
- 干员生命值、攻击间隔和屏障耐久仍按本原型尺度统一校准；足球攻击力、推动阈值、弹性/摩擦和特殊足球效果按 PRTS 公布数据建模。
- `node --test tools/test-football-rules.mjs` 可独立运行足球规则测试。
- `tools/extract-assets.py --groups scene` 或 `tools/extract-scene-textures.py --ab "<客户端>/Arknights_Data/StreamingAssets/AB/Windows"` 会把官方场地贴图提取到本地 `assets/ui/scene/`；公开仓库只保留加载逻辑，不分发版权素材。
- 当前仍是独立单人原型：已按公开参数建模 10 种足球，但球体位移被换算为网页格子尺度；干员攻击伤害、生命值、AI 战术与屏障耐久为简化近似。尚未完整复刻官方多人协作、费用与部署、技能位移、各队正式阵容与战术、六种比赛风格的全部增减益及道具事件。不会把这些近似描述成官方精确实现。
- Forge 的工坊包不能直接替换宿主核心场景与每帧主循环，因此本仓库继续作为独立页面；仅参考其模组 API 边界，并复用 Stronghold 的镜头 / Grid 思路。
