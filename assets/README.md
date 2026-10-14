# assets/ —— 运行需要的官方素材（**未随仓库分发**）

本目录**故意不入库**。

## 为什么

本仓库的**代码**是开源的（MIT）。但运行画面里的这些内容是《明日方舟》的官方素材，
**版权归鹰角网络 / Yostar**：

| 子目录 | 内容 | 来源 |
|---|---|---|
| `ui/football/` | 足球 HUD（比分 / 倒计时 / 开赛结束 / 图标…） | 客户端 `ui/footballcup/**` |
| `ui/style/` | 6 种比赛风格 buff 图标 | 客户端 `arts/ui/[uc]multiv3.ab` |
| `ui/audio/` | 得分 / 失分音效 | 客户端 `audio/custom_se/act1multi.ab` |
| `ui/scene/` | 战场地面与背景贴图 | 客户端 `arts/maps/multi_player/res.ab` 等 |
| `chibi/<干员id>/` | 小人 Spine 骨骼（`.skel` / `.atlas` / `.png`） | 客户端 `chararts/char_<id>.ab` 的 `build_char_<id>.skel` |

把官方美术/音频再分发到公开仓库是有版权风险的，所以仓库只发代码，素材请**你自己从本机客户端生成**。

## 怎么生成

前置：本机装有《明日方舟》PC 客户端；Python 3.10+。

```bash
pip install UnityPy lz4 Pillow
python tools/extract-assets.py --ab "<客户端>/Arknights_Data/StreamingAssets/AB/Windows"
```

脚本会把上表内容解到 `assets/` 下。**只在你自己的机器上用**，别上传。

## 缺素材时会怎样

不会崩：页面照常运行，只是官方 HUD / 音效 / 小人缺失（小人会打印「载入失败」）。
球场、球门、足球、计分与玩法逻辑全部是自建/程序化生成的，**不依赖 assets/**。

## 版权声明

《明日方舟》相关名称、美术、音频、文本、数据版权归**鹰角网络 / Yostar**。
本仓库对其仅作**个人学习/研究**用途，**不再分发、不商用**。
