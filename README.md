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
4. **点击地面** = 操作角色前往该处；碰到球即推球
5. 把球踢进**右侧红色球门**得分，球进左侧蓝色球门则对方得分
6. 5 分钟一局，比分高者胜

## 官方依据

| 项目 | 来源 |
|---|---|
| 场地布局 **13 列 × 9 行**（col0 = 盟友门列 / col12 = 敌方门列 / row0,row8 = 界外；内区 11×7 = `tile_football`） | `data/level_act1multi_football.json`（`mapData.map` 实测） |
| 一局 **300 秒**、**移动倍率 0.5**、初始费用 30、费用增速 0.85 | 同文件 `options` |
| 玩法规则（对球造成伤害达「推动伤害阈值」才踢动、门前阵地屏障、净胜球计印章） | PRTS 促融共竞条目 |
| 视觉（**非绿茵场**：灰白水泥大板 + 青色发光边线 + 左蓝右红钢桁架球门 + 深色看台） | 官方预览图 `multi_v3_01-football_preview` 像素实测 |

## 复用的框架件（来自 Stronghold-Protocol）

| 文件 | 用途 | 说明 |
|---|---|---|
| `lib/projection.js` | **官方相机模型**（`officialCamera` / `pickTile` / `syncThreeCamera` + 13 个官方相机预设） | 零依赖，可原样搬 |
| `lib/grid.js` | **官方 SPFA 流场寻路**（`Grid.waypoints`）—— AI 的移动内核 | 依赖下两项 |
| `lib/sim-constants.js`、`lib/shared-constants.js`、`lib/detmath.js` | 上者的依赖闭包（`GEO` / `hypot` 等） | 改了两处 import 路径，并把 `N_` 就地换成恒等函数 |

AI 的运动沿用上游范式：**流场航路点 → 逐段推进 → 每步校验可通行 → 网格版本失效即重规划**。
战术层（谁是追击者、谁保形）上游没有现成范式可抄，是本项目自写的。

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
