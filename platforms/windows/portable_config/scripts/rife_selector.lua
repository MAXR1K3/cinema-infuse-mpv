-- RIFE selector v3: SDR + HDR10/PQ
local mp = require "mp"

local models = {
    ["4.25"] = {
        path = "~~/rife/rife_425.vpy",
        name = "RIFE 4.25 SDR",
        hdr = false,
    },
    ["4.26"] = {
        path = "~~/rife/rife_426.vpy",
        name = "RIFE 4.26 SDR",
        hdr = false,
    },
    ["4.26.heavy"] = {
        path = "~~/rife/rife_426h.vpy",
        name = "RIFE 4.26 Heavy SDR",
        hdr = false,
    },
    ["hdr10-balanced"] = {
        path = "~~/rife/rife_hdr10_425_balanced.vpy",
        name = "RIFE 4.25 HDR10 2x / Balanced",
        hdr = true,
    },
    ["hdr10-quality"] = {
        path = "~~/rife/rife_hdr10_425_quality.vpy",
        name = "RIFE 4.25 HDR10 2x / Quality",
        hdr = true,
    },
}

local selected = "4.25"
local enabled = false
local hdr_active = false
local dv_profile = nil
local dv_compatibility = nil

-- mpv's Matroska demuxer reports the DV profile before file-loaded. Capture
-- that record from the already-open stream instead of opening RaiDrive files
-- a second time with ffprobe during playback.
local function capture_dv_record(event)
    if not event.text or not event.text:find("Dolby Vision %- version:") then return end
    dv_profile = tonumber(event.text:match("profile: (%d+)"))
    dv_compatibility = tonumber(event.text:match("ID: (%d+)"))
    mp.enable_messages("warn")
end

mp.register_event("start-file", function()
    dv_profile = nil
    dv_compatibility = nil
    mp.enable_messages("debug")
end)
mp.register_event("log-message", capture_dv_record)
mp.enable_messages("debug")

local function seek_resync()
    if mp.get_property_native("time-pos") ~= nil then
        mp.command("no-osd seek 0 relative+exact")
    end
end

local function remove_rife()
    pcall(function() mp.command("vf remove @rife") end)
end

local function remove_dv_strip()
    pcall(function() mp.command("vf remove @dvtest") end)
end

local verification_id = 0

-- A Profile 5 base layer is not HDR10-compatible. Stripping its RPU and
-- interpreting the remaining pixels as BT.2020/PQ makes the picture green.
local function hdr_source_problem()
    local primaries = mp.get_property("video-params/primaries")
    local transfer = mp.get_property("video-params/gamma")
    if primaries ~= "bt.2020" or transfer ~= "pq" then
        return "此模式需要 BT.2020/PQ HDR 视频"
    end

    if mp.get_property("video-params/colormatrix") ~= "dolbyvision" then
        return nil
    end

    if not dv_compatibility then
        return "无法读取 DV 基础层信息，保留原生 DV 播放"
    end
    if dv_compatibility ~= 1 then
        return string.format("DV Profile %s 无 HDR10 兼容基础层，已保留原生 DV 播放",
                             tostring(dv_profile or "?"))
    end
    return nil
end

local function verify_after_enable(expected, id)
    local deadline = mp.get_time() + (models[expected].hdr and 45 or 12)

    local function check()
        if not enabled or selected ~= expected or verification_id ~= id then return end

        local src_fps = mp.get_property_number("container-fps", 0) or 0
        local vf_fps = mp.get_property_number("estimated-vf-fps", 0) or 0

        if src_fps > 0 and vf_fps >= src_fps * 1.5 then
            mp.osd_message(
                string.format("%s ON\nVF FPS: %.3f", models[selected].name, vf_fps),
                3
            )
        elseif mp.get_time() < deadline then
            -- After adding VapourSynth, mpv initially reports the old FPS.
            mp.add_timeout(0.5, check)
        else
            mp.osd_message(
                string.format(
                    "%s 未达到 2x\n源 %.3f fps / VF %.3f fps\n请检查 mpv 日志和掉帧",
                    models[selected].name, src_fps, vf_fps
                ),
                5
            )
            mp.msg.error(
                string.format(
                    "RIFE verify timed out: selected=%s source=%.3f vf=%.3f",
                    selected, src_fps, vf_fps
                )
            )
        end
    end

    mp.add_timeout(0.5, check)
end

local function add_selected()
    local m = models[selected]
    if not m then
        mp.osd_message("未知 RIFE 模型: " .. tostring(selected), 3)
        return
    end

    if m.hdr then
        local problem = hdr_source_problem()
        if problem then
            verification_id = verification_id + 1
            remove_rife()
            if hdr_active then remove_dv_strip() end
            hdr_active = false
            enabled = false
            pcall(function() mp.commandv("script-message-to", "dynamic_crop", "release-for-rife") end)
            mp.osd_message(problem .. "\nHDR RIFE 未开启", 6)
            mp.msg.warn("HDR RIFE blocked: " .. problem)
            return
        end
    end

    local was_hdr = hdr_active
    local resume_after_hdr = m.hdr and not mp.get_property_bool("pause", false)
    if resume_after_hdr then mp.set_property_bool("pause", true) end
    remove_rife()

    if m.hdr then
        pcall(function() mp.commandv("script-message-to", "dynamic_crop", "hold-for-rife") end)
    elseif was_hdr then
        pcall(function() mp.commandv("script-message-to", "dynamic_crop", "release-for-rife") end)
    end

    -- VapourSynth does not preserve Dolby Vision RPU/EL timing for generated
    -- intermediate frames. HDR mode therefore uses HDR10-compatible BL.
    if m.hdr then
        remove_dv_strip()
        mp.command("vf add @dvtest:format=dolbyvision=no")
        hdr_active = true
    else
        if hdr_active then remove_dv_strip() end
        hdr_active = false
    end

    local cmd = 'vf add @rife:vapoursynth="' .. m.path .. '":4:2'
    local ok, err = pcall(function() mp.command(cmd) end)

    if not ok then
        enabled = false
        if hdr_active then
            remove_dv_strip()
            hdr_active = false
        end
        mp.osd_message(m.name .. " 加载失败", 4)
        mp.msg.error("Failed to add RIFE filter: " .. tostring(err))
        if m.hdr then
            pcall(function() mp.commandv("script-message-to", "dynamic_crop", "release-for-rife") end)
        end
        if resume_after_hdr then mp.set_property_bool("pause", false) end
        return
    end

    enabled = true
    verification_id = verification_id + 1
    -- The HDR TensorRT filter needs a short setup window before resyncing mpv's PTS.
    if m.hdr then
        local id = verification_id
        mp.add_timeout(0.75, function()
            if not enabled or verification_id ~= id then return end
            seek_resync()
            if resume_after_hdr then mp.set_property_bool("pause", false) end
        end)
    end
    -- Do not seek during SDR vs-rife startup: VSScript/PyTorch can abort.
    mp.osd_message(m.name .. " 正在加载…", 2)
    verify_after_enable(selected, verification_id)
end

local function turn_off()
    verification_id = verification_id + 1
    remove_rife()
    if hdr_active then
        remove_dv_strip()
        hdr_active = false
        pcall(function() mp.commandv("script-message-to", "dynamic_crop", "release-for-rife") end)
    end
    enabled = false
    -- mpv rebuilds the filter graph here. Seeking while vs-rife/PyTorch
    -- enters or leaves VSScript can abort Python's thread state.
    mp.osd_message("RIFE OFF（已选择 " .. models[selected].name .. "）", 2)
end

local function toggle()
    if enabled then
        turn_off()
    else
        add_selected()
    end
end

local function select_model(name)
    if not models[name] then
        mp.osd_message("不支持的 RIFE 模型: " .. tostring(name), 3)
        return
    end

    selected = name
    if enabled then
        add_selected()
    else
        mp.osd_message("已选择 " .. models[selected].name .. "（当前 OFF）", 2)
    end
end

local function activate(name)
    if not models[name] then
        mp.osd_message("不支持的 RIFE 模型: " .. tostring(name), 3)
        return
    end
    selected = name
    add_selected()
end

local function status()
    local state = enabled and "ON" or "OFF"
    local src_fps = mp.get_property_number("container-fps", 0) or 0
    local vf_fps = mp.get_property_number("estimated-vf-fps", 0) or 0
    mp.osd_message(
        string.format(
            "RIFE: %s\n模式: %s\n源 FPS: %.3f\nVF FPS: %.3f",
            state, models[selected].name, src_fps, vf_fps
        ),
        5
    )
end

mp.register_event("file-loaded", function()
    enabled = false
    hdr_active = false
end)

mp.register_script_message("toggle", toggle)
mp.register_script_message("off", turn_off)
mp.register_script_message("select", select_model)
mp.register_script_message("activate", activate)
mp.register_script_message("status", status)


