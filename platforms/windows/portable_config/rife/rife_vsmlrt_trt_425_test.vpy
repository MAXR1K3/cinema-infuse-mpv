import vapoursynth as vs
from fractions import Fraction
from vsmlrt import RIFE, RIFEModel, Backend

core = vs.core
clip = video_in

fps = Fraction(str(container_fps)).limit_denominator(1000001)
clip = core.std.AssumeFPS(
    clip,
    fpsnum=fps.numerator,
    fpsden=fps.denominator
)

src_format = clip.format.id

# SDR BT.709 -> RGB FP16
rgb = core.resize.Bicubic(
    clip,
    format=vs.RGBH,
    matrix_in_s="709",
    range_in_s="limited",
    range_s="full"
)

# RIFE 对尺寸有对齐要求，补齐到 32 的倍数
pad_w = (-rgb.width) % 32
pad_h = (-rgb.height) % 32

if pad_w or pad_h:
    rgb = core.std.AddBorders(
        rgb,
        right=pad_w,
        bottom=pad_h
    )

backend = Backend.TRT(
    fp16=True,
    device_id=0,
    num_streams=2,
    use_cuda_graph=True,
    static_shape=True,
    output_format=1
)

rgb = RIFE(
    rgb,
    multi=Fraction(2),
    model=RIFEModel.v4_25,
    backend=backend
)

if pad_w or pad_h:
    rgb = core.std.Crop(
        rgb,
        right=pad_w,
        bottom=pad_h
    )

# RGB FP16 -> 原始 SDR YUV
out = core.resize.Bicubic(
    rgb,
    format=src_format,
    matrix_s="709",
    range_in_s="full",
    range_s="limited"
)

# mpv rebuilds output PTS by summing frame durations. Keep each original
# interval, including long/VFR frames; the RIFE graph above assumes CFR.
# Output frames 2*n and 2*n+1 each occupy half of input frame n's interval.
source_timing = core.std.Interleave([video_in, video_in], modify_duration=False)

def restore_source_duration(n, f):
    frame = f[0].copy()
    props = f[1].props
    num = props.get("_DurationNum", 0)
    den = props.get("_DurationDen", 0)
    if num > 0 and den > 0:
        duration = Fraction(num, den * 2)
    else:
        # A terminal frame may not have a following timestamp.
        duration = 1 / (fps * 2)
    frame.props["_DurationNum"] = duration.numerator
    frame.props["_DurationDen"] = duration.denominator
    return frame

out = core.std.ModifyFrame(out, [out, source_timing], restore_source_duration)
out.set_output()


