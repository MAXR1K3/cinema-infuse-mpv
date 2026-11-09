import vapoursynth as vs

core = vs.core
src = video_in
src_format = src.format.id

# HDR10 BT.2020/PQ -> RGBH
rgb = core.resize.Bicubic(
    src,
    format=vs.RGBH,
    matrix_in_s="2020ncl",
    transfer_in_s="st2084",
    primaries_in_s="2020",
    range_in_s="limited",
    transfer_s="st2084",
    primaries_s="2020",
    range_s="full"
)

# 不进行 AI 插帧，仅把每个源帧复制一次。
# Interleave 默认会同时把 FPS ×2、帧时长 ÷2。
rgb2x = core.std.Interleave(
    [rgb, rgb],
    modify_duration=True
)

# RGBH -> HDR10 BT.2020/PQ
out = core.resize.Bicubic(
    rgb2x,
    format=src_format,
    transfer_in_s="st2084",
    primaries_in_s="2020",
    range_in_s="full",
    matrix_s="2020ncl",
    transfer_s="st2084",
    primaries_s="2020",
    range_s="limited"
)

out.set_output()
