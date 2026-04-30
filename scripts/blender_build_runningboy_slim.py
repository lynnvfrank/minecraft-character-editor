"""
Build RunningboyRigSlim.fbx: Alex-style arms (3/4 width along body-outward X).

Uses vertex groups Arm:{Left,Right}:{Upper,Lower}. Geometry scales from the
shoulder (inner X). UV: on polygons that are entirely one arm and span X,
compress texture U toward the face mean by 3/4 so the skin does not stretch.

After edits, the 2nd Layer overlay offset (previously only in matrix_local) is
baked into vertex positions and the object is rebound like Character so FBX
export does not emit bogus object scale/location (which broke jacket/sleeves/
pants in the web viewer).

Regenerate with:
  "C:\\Program Files\\Blender Foundation\\Blender 3.6\\blender.exe" ^
    --background --python scripts/blender_build_runningboy_slim.py
"""
from __future__ import annotations

import os

import bpy
from mathutils import Matrix

SLIM = 3.0 / 4.0
X_SPAN_EPS = 1e-4

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), ".."))
FBX_IN = os.path.join(ROOT, "public", "models", "RunningboyRig.fbx")
FBX_OUT = os.path.join(ROOT, "public", "models", "RunningboyRigSlim.fbx")


def _bake_second_layer_bind_matrix(
    char: bpy.types.Object,
    layer: bpy.types.Object,
    matrix_local_before_edit: Matrix,
) -> None:
    """
    Original 2nd Layer keeps overlay offset in matrix_local (scale ~1.612 + translation).
    After vertex edits, FBX export mis-serializes that as huge object scale/location.
    Bake M into mesh space, then bind with the same matrix_local as Character (Z nudge only).
    """
    mesh = layer.data
    C = char.matrix_local.copy()
    T = C.inverted() @ matrix_local_before_edit
    for v in mesh.vertices:
        v.co = T @ v.co
    mesh.update()
    bpy.context.view_layer.update()
    if layer.parent:
        layer.matrix_world = layer.parent.matrix_world @ C


def _vg_idx(obj: bpy.types.Object, name: str) -> int:
    return obj.vertex_groups[name].index


def _verts_in_groups(mesh: bpy.types.Mesh, gidx: set[int], thresh: float = 0.05) -> set[int]:
    out: set[int] = set()
    for v in mesh.vertices:
        for g in v.groups:
            if g.group in gidx and g.weight > thresh:
                out.add(v.index)
                break
    return out


def _slim_object(obj: bpy.types.Object) -> None:
    mesh = obj.data
    gr = {_vg_idx(obj, n) for n in ("Arm:Right:Upper", "Arm:Right:Lower")}
    gl = {_vg_idx(obj, n) for n in ("Arm:Left:Upper", "Arm:Left:Lower")}

    vi_r = _verts_in_groups(mesh, gr)
    vi_l = _verts_in_groups(mesh, gl)
    if not vi_r and not vi_l:
        return

    if vi_r:
        inner_r = max(mesh.vertices[i].co.x for i in vi_r)
        for i in vi_r:
            v = mesh.vertices[i]
            v.co.x = inner_r + (v.co.x - inner_r) * SLIM

    if vi_l:
        inner_l = min(mesh.vertices[i].co.x for i in vi_l)
        for i in vi_l:
            v = mesh.vertices[i]
            v.co.x = inner_l + (v.co.x - inner_l) * SLIM

    mesh.update()

    uv_layer = mesh.uv_layers.active
    if not uv_layer:
        return
    uvd = uv_layer.data

    for poly in mesh.polygons:
        vis = [mesh.loops[li].vertex_index for li in poly.loop_indices]
        all_r = all(v in vi_r for v in vis)
        all_l = all(v in vi_l for v in vis)
        if not (all_r or all_l):
            continue

        xs = [mesh.vertices[v].co.x for v in vis]
        if max(xs) - min(xs) < X_SPAN_EPS:
            continue

        loop_indices = list(poly.loop_indices)
        mu = sum(uvd[li].uv.x for li in loop_indices) / len(loop_indices)
        for li in loop_indices:
            u = uvd[li].uv
            u.x = mu + (u.x - mu) * SLIM


def main() -> None:
    if not os.path.isfile(FBX_IN):
        raise SystemExit(f"Missing input FBX: {FBX_IN}")

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.fbx(filepath=FBX_IN)

    char_ob = bpy.context.scene.objects.get("Character")
    layer_ob = bpy.context.scene.objects.get("2nd Layer")
    if not char_ob or not layer_ob:
        raise SystemExit("Expected Character and 2nd Layer mesh objects in FBX")

    matrix_local_2nd_before = layer_ob.matrix_local.copy()

    for name in ("Character", "2nd Layer"):
        ob = bpy.context.scene.objects.get(name)
        if ob and ob.type == "MESH":
            _slim_object(ob)

    _bake_second_layer_bind_matrix(char_ob, layer_ob, matrix_local_2nd_before)

    os.makedirs(os.path.dirname(FBX_OUT), exist_ok=True)
    bpy.ops.export_scene.fbx(
        filepath=FBX_OUT,
        use_selection=False,
        bake_anim=False,
        mesh_smooth_type="FACE",
        add_leaf_bones=False,
        primary_bone_axis="Y",
        secondary_bone_axis="X",
        axis_forward="-Z",
        axis_up="Y",
    )
    print(f"Wrote {FBX_OUT}")


if __name__ == "__main__":
    main()
