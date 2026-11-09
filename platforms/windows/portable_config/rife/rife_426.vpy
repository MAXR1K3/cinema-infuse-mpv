from fractions import Fraction

import vapoursynth as vs
from vsrife import rife

core = vs.core

# ------------------------------------------------------------
# mpv input / timing
# ------------------------------------------------------------
clip = video_in
fps = Fraction(str(container_fps)).limit_denominator(1000001)

clip = core.std.AssumeFPS(
    clip,
    fpsnum=fps.numerator,
    fpsden=fps.denominator,
)

src_format = clip.format.id

# ------------------------------------------------------------
# SDR BT.709 -> RGB FP16
# RGBH makes vs-rife use FP16 inference.
# ------------------------------------------------------------
clip = core.resize.Bicubic(
    clip,
    format=vs.RGBH,
    matrix_in_s="709",
)

# ------------------------------------------------------------
# Scene-change detection without MiscFilters.dll
# Mirrors current upstream vs-rife sc_detect():
# compare adjacent frames with PlaneStats and write
# _SceneChangeNext on the source frame.
# ------------------------------------------------------------
SC_THRESHOLD = 0.15

sc_clip = clip.resize.Bicubic(
    format=vs.GRAY8,
    matrix_s="709",
)
sc_next = sc_clip[1:] + sc_clip[-1]
sc_stats = sc_next.std.PlaneStats(sc_clip)


def set_scene_change(n, f):
    out = f[0].copy()
    diff = f[1].props.get("PlaneStatsDiff", 0.0)
    out.props["_SceneChangeNext"] = int(diff > SC_THRESHOLD)
    return out


clip = clip.std.ModifyFrame(
    clips=[clip, sc_stats],
    selector=set_scene_change,
)

# ------------------------------------------------------------
# RIFE 4.26, 2x interpolation
# CUDA FP16 on GPU. TensorRT remains disabled because the
# current TRT path on this machine produced regular dot artifacts.
# sc_threshold=None tells vs-rife to consume our precomputed
# _SceneChangeNext property instead of invoking MiscFilters.
# ------------------------------------------------------------
clip = rife(
    clip,
    device_index=0,
    model="4.26",
    auto_download=True,
    factor_num=2,
    factor_den=1,
    scale=1.0,
    ensemble=False,
    sc=True,
    sc_threshold=None,
    trt=False,
)

# ------------------------------------------------------------
# RGB FP16 -> original source format
# ------------------------------------------------------------
clip = core.resize.Bicubic(
    clip,
    format=src_format,
    matrix_s="709",
)

# ------------------------------------------------------------
# Explicit 2x output timing / frame duration
# ------------------------------------------------------------
out_fps = fps * 2
clip = core.std.AssumeFPS(
    clip,
    fpsnum=out_fps.numerator,
    fpsden=out_fps.denominator,
)

clip.set_output()
