import vapoursynth as vs

core = vs.core
src = video_in
src_format = src.format.id

# HDR10 BT.2020/PQ -> RGB FP16
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

# RGB FP16 -> HDR10 BT.2020/PQ
out = core.resize.Bicubic(
    rgb,
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
