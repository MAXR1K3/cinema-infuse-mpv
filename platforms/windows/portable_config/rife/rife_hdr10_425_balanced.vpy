import vapoursynth as vs
from fractions import Fraction
from vsmlrt import RIFE, RIFEModel, Backend

core = vs.core
source = video_in
fps = Fraction(str(container_fps)).limit_denominator(1000001)
clip = core.std.AssumeFPS(source, fpsnum=fps.numerator, fpsden=fps.denominator)
source_format = clip.format.id
rgb = core.resize.Bicubic(
    clip, format=vs.RGBS, width=clip.width // 3, height=clip.height // 3,
    matrix_in_s="2020ncl", transfer_in_s="st2084", primaries_in_s="2020",
    range_in_s="limited", transfer_s="st2084", primaries_s="2020", range_s="full",
)
# Detect hard cuts on a small luma image so RIFE does not blend across scenes.
scene_luma = core.resize.Bicubic(clip, format=vs.GRAY8, width=480, height=270)
scene_next = scene_luma[1:] + scene_luma[-1]
scene_stats = core.std.PlaneStats(scene_next, scene_luma)

def mark_scene_change(n, f):
    frame = f[0].copy()
    frame.props["_SceneChangeNext"] = int(f[1].props.get("PlaneStatsDiff", 0.0) > 0.15)
    return frame

rgb = core.std.ModifyFrame(rgb, [rgb, scene_stats], mark_scene_change)
pad_w = (-rgb.width) % 32
pad_h = (-rgb.height) % 32
if pad_w or pad_h:
    rgb = core.std.AddBorders(rgb, right=pad_w, bottom=pad_h)
backend = Backend.TRT(fp16=False, device_id=0, num_streams=2, use_cuda_graph=True,
                      static_shape=True, output_format=0)
rgb = RIFE(rgb, multi=Fraction(2), model=RIFEModel.v4_25,
           backend=backend, _implementation=2)
if pad_w or pad_h:
    rgb = core.std.Crop(rgb, right=pad_w, bottom=pad_h)
out = core.resize.Bicubic(
    rgb, format=source_format, width=source.width, height=source.height,
    matrix_s="2020ncl", transfer_in_s="st2084", primaries_in_s="2020",
    range_in_s="full", transfer_s="st2084", primaries_s="2020", range_s="limited",
)
source_timing = core.std.Interleave([source, source], modify_duration=False)

def restore_duration(n, f):
    frame = f[0].copy()
    props = f[1].props
    num, den = props.get("_DurationNum", 0), props.get("_DurationDen", 0)
    duration = Fraction(num, den * 2) if num > 0 and den > 0 else 1 / (fps * 2)
    frame.props["_DurationNum"] = duration.numerator
    frame.props["_DurationDen"] = duration.denominator
    return frame

out = core.std.ModifyFrame(out, [out, source_timing], restore_duration)
out.set_output()


