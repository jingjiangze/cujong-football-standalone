import sys, os
sys.path.insert(0, r"C:/DDDD/Agent Work/stronghold-server/tools/local-extract")
import aklz4
import UnityPy
from PIL import Image

AB = r"C:/Program Files/DDDD/game/Hypergryph Launcher/games/Arknights/Arknights_Data/StreamingAssets/AB/Windows"
OUT = r"C:/DDDD/Agent Work/_tmp/cujong-standalone-2026-10-14/app/ui/scene"
os.makedirs(OUT, exist_ok=True)

JOBS = [
    (AB + r"/arts/maps/multi_player/res.ab", None),
    (AB + r"/activity/[uc]multiv3.ab", {"ground_base_tile", "land_poly_albedo", "act3vmulti_entry_ground_atlas"}),
]
n = 0
for path, want in JOBS:
    print("=" * 60); print(os.path.basename(path))
    try:
        env = UnityPy.load(path)
    except Exception as e:
        print("  LOAD ERR", type(e).__name__, str(e)[:160]); continue
    for o in env.objects:
        if o.type.name not in ("Texture2D", "Sprite"):
            continue
        try:
            d = o.read()
        except Exception as e:
            continue
        name = getattr(d, "m_Name", "?")
        if want and name not in want:
            continue
        try:
            img = d.image
        except Exception as e:
            print("   decode fail", name, type(e).__name__); continue
        if img is None:
            continue
        fn = os.path.join(OUT, name.replace("/", "_") + ".png")
        img.save(fn)
        print(f"   saved {name}  {img.size[0]}x{img.size[1]}  {img.mode}")
        n += 1
print("total saved:", n)
