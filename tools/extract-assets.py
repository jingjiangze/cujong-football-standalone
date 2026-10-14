#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从本机《明日方舟》PC 客户端解出运行所需的官方素材到 assets/。

用法:
    python tools/extract-assets.py --ab "<…>/StreamingAssets/AB/Windows" [--groups ui,scene,audio,chibi]

依赖:  pip install UnityPy lz4 Pillow

⚠ 解出的素材版权归鹰角网络 / Yostar，仅供个人学习；**不要把它们提交到公开仓库**（.gitignore 已排除）。
"""
import argparse, os, sys, io, json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"


def load_env(ab_path):
    """注册 LZ4AK（明日方舟自定义压缩）后再交给 UnityPy。"""
    try:
        import UnityPy
    except ImportError:
        sys.exit("需要 UnityPy：pip install UnityPy lz4 Pillow")
    # 明日方舟的 AB 用 LZ4AK（compressionType 常被识别为 LZHAM），需要注册解压器
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    try:
        import aklz4  # noqa: F401  （导入即注册）
    except ImportError:
        print("⚠ 未找到 aklz4.py：若报 LZHAM 解压失败，请把上游 tools/local-extract/aklz4.py 放到 tools/ 下")
    return UnityPy


def save_texture(obj, out_dir: Path, only=None):
    d = obj.read()
    name = getattr(d, "m_Name", "?")
    if only and name not in only:
        return False
    img = getattr(d, "image", None)
    if img is None:
        return False
    out_dir.mkdir(parents=True, exist_ok=True)
    img.save(out_dir / f"{name.replace('/', '_')}.png")
    return True


def group_ui(UnityPy, AB: Path):
    """足球 HUD（ui/footballcup）+ 比赛风格图标（arts/ui/[uc]multiv3.ab）"""
    n = 0
    fb = AB / "ui/footballcup/battle/football_cup_battle_ui_plugin.ab"
    if fb.exists():
        for o in UnityPy.load(str(fb)).objects:
            if o.type.name in ("Texture2D", "Sprite"):
                n += save_texture(o, ASSETS / "ui/football")
    st = AB / "arts/ui/[uc]multiv3.ab"
    if st.exists():
        for o in UnityPy.load(str(st)).objects:
            if o.type.name in ("Texture2D", "Sprite"):
                d = o.read()
                nm = getattr(d, "m_Name", "")
                if nm.startswith("buff_icon_"):
                    n += save_texture(o, ASSETS / "ui/style")
        # footballcup 里更全的 HUD（含 flag 等）
    print(f"[ui] {n} 张")


def group_scene(UnityPy, AB: Path):
    """战场地面/背景贴图 + 地面地块"""
    n = 0
    jobs = [
        (AB / "arts/maps/multi_player/res.ab", None),
        (AB / "activity/[uc]multiv3.ab", {"ground_base_tile", "land_poly_albedo"}),
    ]
    for path, only in jobs:
        if not path.exists():
            print(f"  跳过（不存在）: {path.name}")
            continue
        for o in UnityPy.load(str(path)).objects:
            if o.type.name in ("Texture2D", "Sprite"):
                n += save_texture(o, ASSETS / "ui/scene", only)
    print(f"[scene] {n} 张")


def group_audio(AB: Path):
    """得分/失分音效：客户端里是 .ab，需要 UnityPy 解 AudioClip。"""
    import UnityPy
    n = 0
    for name in ("act1multi.ab", "act2multi.ab"):
        p = AB / "audio/custom_se" / name
        if not p.exists():
            continue
        for o in UnityPy.load(str(p)).objects:
            if o.type.name != "AudioClip":
                continue
            d = o.read()
            nm = getattr(d, "m_Name", "clip")
            samples = getattr(d, "samples", None)
            if not samples:
                continue
            (ASSETS / "ui/audio").mkdir(parents=True, exist_ok=True)
            for key, buf in samples.items():
                (ASSETS / "ui/audio" / f"{nm}.wav").write_bytes(buf if isinstance(buf, bytes) else bytes(buf))
                n += 1
                break
    print(f"[audio] {n} 个")


def group_chibi(UnityPy, AB: Path):
    """小人骨骼：chararts/char_<id>.ab 里的 build_char_<id>.skel + 同名 .atlas + 页面 png。"""
    n = 0
    root = AB / "chararts"
    if not root.is_dir():
        print("  chararts/ 不存在")
        return
    for ab in sorted(root.glob("char_*.ab")):
        try:
            env = UnityPy.load(str(ab))
        except Exception:
            continue
        skels = {}
        for o in env.objects:
            if o.type.name != "TextAsset":
                continue
            d = o.read()
            nm = getattr(d, "m_Name", "")
            if nm.endswith(".skel"):
                skels[nm] = bytes(d.m_Script) if not isinstance(d.m_Script, str) else d.m_Script.encode("latin-1")
        for skel_name, skel_bytes in skels.items():
            stem = skel_name[:-5]                      # build_char_002_amiya
            safe = skel_name.replace("#", "_")[:-5]
            out = ASSETS / "chibi" / safe
            out.mkdir(parents=True, exist_ok=True)
            (out / f"{safe}.skel").write_bytes(skel_bytes)
        # atlas + 页面 png 与 skel 同 bundle
        if skels:
            for o in env.objects:
                d = o.read()
                nm = getattr(d, "m_Name", "")
                if nm.endswith(".atlas"):
                    safe = nm.replace("#", "_")[:-6]
                    out = ASSETS / "chibi" / safe
                    out.mkdir(parents=True, exist_ok=True)
                    txt = d.m_Script if isinstance(d.m_Script, str) else bytes(d.m_Script).decode("utf-8", "ignore")
                    (out / f"{safe}.atlas").write_text(txt.replace("#", "_"), encoding="utf-8")
                elif o.type.name == "Texture2D" and nm.endswith(".png"):
                    safe = nm.replace("#", "_")[:-4]
                    out = ASSETS / "chibi" / safe
                    img = getattr(d, "image", None)
                    if img is not None:
                        out.mkdir(parents=True, exist_ok=True)
                        img.save(out / f"{safe}.png")
            n += len(skels)
    print(f"[chibi] {n} 套骨骼")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ab", required=True, help="…/Arknights_Data/StreamingAssets/AB/Windows")
    ap.add_argument("--groups", default="ui,scene,audio,chibi")
    a = ap.parse_args()
    AB = Path(a.ab)
    if not AB.is_dir():
        sys.exit(f"AB 目录不存在: {AB}")
    ASSETS.mkdir(parents=True, exist_ok=True)
    UnityPy = load_env(AB)
    groups = {g.strip() for g in a.groups.split(",") if g.strip()}
    if "ui" in groups: group_ui(UnityPy, AB)
    if "scene" in groups: group_scene(UnityPy, AB)
    if "audio" in groups: group_audio(AB)
    if "chibi" in groups: group_chibi(UnityPy, AB)
    print("完成。运行: python serve.py")


if __name__ == "__main__":
    main()
