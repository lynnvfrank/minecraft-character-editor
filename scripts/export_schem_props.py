#!/usr/bin/env python3
"""
Export Minecraft .schem props to .glb for use as scene decorations.

Reuses the in-game mesher from the Girl Powers II schematics tooling
(render_ingame_preview.build_ingame_mesh), so geometry, textures and
Minecraft per-face shading match the -ingame preview PNGs.

Output: public/props/<name>.glb  +  public/props/manifest.json

Usage:
  python scripts/export_schem_props.py barrels/barrels-calm-kettle-x2-z65.schem ...
  python scripts/export_schem_props.py --category vegetation --limit 5
"""
from __future__ import annotations

import argparse
import io
import json
import struct
import sys
from pathlib import Path

import numpy as np

SCHEM_ROOT = Path(
    r"C:\Users\lynnv\AppData\Roaming\ModrinthApp\profiles\Girl Powers II 1.0.0\schematics"
)
OUT_DIR = Path(__file__).resolve().parent.parent / "public" / "props"


def _import_tooling(root: Path):
    sys.path.insert(0, str(root))
    # glm/moderngl are only used by the PNG renderer, not the mesher; stub them if absent.
    import importlib.util
    import types

    for mod in ("glm", "moderngl"):
        if importlib.util.find_spec(mod) is None:
            sys.modules[mod] = types.ModuleType(mod)
    import render_ingame_preview as rip  # noqa: E402
    from mc_block_models import DEFAULT_JAR, MinecraftAssets  # noqa: E402

    return rip, MinecraftAssets(DEFAULT_JAR)


def build_mesh(rip, assets, schem: Path):
    width, height, length, arr, idx_to_name = rip.load_schem(schem)
    used: list[str] = []
    for z in range(length):
        for y in range(height):
            for x in range(width):
                state = idx_to_name[arr[rip.idx_xyz(x, y, z, width, length)]]
                if rip.base_name(state) in rip.EMPTY_BLOCKS:
                    continue
                for quad in assets.bake_quads(state):
                    used.append(quad["tex"])
    atlas, uv_map = rip.pack_atlas(used, assets)
    pos, uv, col = rip.build_ingame_mesh(width, height, length, arr, idx_to_name, assets, uv_map)
    return np.asarray(pos, "f4"), np.asarray(uv, "f4"), np.asarray(col, "f4"), atlas


def write_glb(path: Path, pos: np.ndarray, uv: np.ndarray, col: np.ndarray, atlas) -> dict:
    # Center on X/Z, sit on the ground (min Y = 0). 1 block = 1 unit.
    mn, mx = pos.min(axis=0), pos.max(axis=0)
    pos = pos - np.array([(mn[0] + mx[0]) / 2, mn[1], (mn[2] + mx[2]) / 2], "f4")
    mn, mx = pos.min(axis=0), pos.max(axis=0)

    png = io.BytesIO()
    atlas.save(png, "PNG")
    chunks = [pos.tobytes(), uv.tobytes(), col.tobytes(), png.getvalue()]
    views, blob, off = [], b"", 0
    for c in chunks:
        pad = (-len(c)) % 4
        views.append({"buffer": 0, "byteOffset": off, "byteLength": len(c)})
        blob += c + b"\0" * pad
        off += len(c) + pad
    n = len(pos)
    gltf = {
        "asset": {"version": "2.0", "generator": "export_schem_props.py"},
        "scene": 0,
        "scenes": [{"nodes": [0]}],
        "nodes": [{"mesh": 0, "name": path.stem}],
        "meshes": [{"primitives": [{
            "attributes": {"POSITION": 0, "TEXCOORD_0": 1, "COLOR_0": 2},
            "material": 0,
        }]}],
        "materials": [{
            "pbrMetallicRoughness": {
                "baseColorTexture": {"index": 0},
                "metallicFactor": 0.0,
                "roughnessFactor": 1.0,
            },
            "alphaMode": "MASK",
            "alphaCutoff": 0.1,
            "doubleSided": True,
        }],
        "textures": [{"source": 0, "sampler": 0}],
        "samplers": [{"magFilter": 9728, "minFilter": 9728, "wrapS": 33071, "wrapT": 33071}],
        "images": [{"bufferView": 3, "mimeType": "image/png"}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": n, "type": "VEC3",
             "min": mn.tolist(), "max": mx.tolist()},
            {"bufferView": 1, "componentType": 5126, "count": n, "type": "VEC2"},
            {"bufferView": 2, "componentType": 5126, "count": n, "type": "VEC3"},
        ],
        "bufferViews": views[:3] + [views[3]],
        "buffers": [{"byteLength": len(blob)}],
    }
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(js), 0x4E4F534A) + js)
        f.write(struct.pack("<II", len(blob), 0x004E4942) + blob)
    return {"size": [round(float(v), 3) for v in (mx - mn)], "triangles": n // 3}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("schems", nargs="*", help="Paths relative to the schematics folder (or absolute)")
    ap.add_argument("--category", help="Export a whole folder, e.g. barrels")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--root", type=Path, default=SCHEM_ROOT)
    ap.add_argument("--out", type=Path, default=OUT_DIR)
    a = ap.parse_args()

    files = [p if Path(p).is_absolute() else a.root / p for p in a.schems]
    if a.category:
        files += sorted((a.root / a.category).glob("*.schem"))
    if a.limit:
        files = files[: a.limit]
    if not files:
        ap.error("no schematics given")

    rip, assets = _import_tooling(a.root)
    manifest_path = a.out / "manifest.json"
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
    for schem in files:
        pos, uv, col, atlas = build_mesh(rip, assets, Path(schem))
        if len(pos) == 0:
            print(f"skip (empty): {schem}")
            continue
        info = write_glb(a.out / f"{Path(schem).stem}.glb", pos, uv, col, atlas)
        manifest[Path(schem).stem] = {"file": f"props/{Path(schem).stem}.glb", **info}
        print(f"{Path(schem).stem}: {info}")
    manifest_path.write_text(json.dumps(dict(sorted(manifest.items())), indent=2))


if __name__ == "__main__":
    main()
