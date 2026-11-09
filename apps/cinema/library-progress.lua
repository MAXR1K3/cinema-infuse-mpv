-- Loaded only for a play request from this local library. No global mpv settings are changed.
local utils = require 'mp.utils'
local file = os.getenv('MPV_CINEMA_PROGRESS_FILE')
local expected = os.getenv('MPV_CINEMA_MEDIA_URL')
local queue_file = os.getenv('MPV_CINEMA_QUEUE_FILE')
if not file or not expected then return end
local active, position, duration, sequence = false, nil, nil, 0
local entry, queue = nil, nil
local waiting = nil
local function refresh_queue()
    if not queue_file or queue_file == '' then return end
    local input = io.open(queue_file,'r')
    if not input then return end
    local data = utils.parse_json(input:read('*a')); input:close()
    if data and data.entries then queue=data; entry=queue.entries[expected] end
end
local function advance_if_ready()
    if not waiting then return end
    local next_entry=entry and entry.next and queue.entries[entry.next]
    if next_entry then
        waiting=nil
        mp.command_native({'loadfile',entry.next,'replace',-1,{start=tostring(next_entry.startSeconds or 0),['force-media-title']=next_entry.title or '',pause='no'}})
    elseif not entry or entry.resolved or entry.error or mp.get_time()>waiting then
        if entry and (entry.error or not entry.resolved) then mp.osd_message(entry.error or '下一集加载超时，请回片库重试',6) end
        waiting=nil
    end
end
local function capture(event, completed)
    if not active then return end
    local p = mp.get_property_number('time-pos')
    local d = mp.get_property_number('duration')
    if p and p >= 0 then position = p end
    if d and d > 0 then duration = d end
    if not position or not duration then return end
    sequence = sequence + 1
    local data = utils.format_json({position=position,duration=duration,paused=mp.get_property_bool('pause',false),event=event or 'progress',completed=completed or false,sequence=sequence})
    local output = io.open(file,'w')
    if output then output:write(data); output:close() end
end
mp.register_event('file-loaded',function()
    waiting=nil
    refresh_queue()
    local media = mp.get_property('path')
    if queue and queue.entries[media] then
        expected=media; entry=queue.entries[media]; file=entry.file; sequence=0
        if entry.title then mp.set_property('file-local-options/force-media-title',entry.title) end
    end
    active = mp.get_property('path') == expected
    if active then position=nil; duration=nil; capture('start') end
end)
mp.observe_property('time-pos','number',function(_,value) if active and value and value >= 0 then position=value end end)
mp.observe_property('duration','number',function(_,value) if active and value and value > 0 then duration=value end end)
mp.add_periodic_timer(5,function() capture('progress') end)
if queue_file and queue_file ~= '' then mp.add_periodic_timer(0.5,function() refresh_queue(); advance_if_ready() end) end
mp.observe_property('playlist-count','number',function(_,count) if count == 0 then waiting=nil end end)
mp.register_event('start-file',function() waiting=nil end)
mp.observe_property('pause','bool',function(_,paused) capture(paused and 'pause' or 'unpause') end)
mp.register_event('playback-restart',function() capture('progress') end)
mp.add_hook('on_unload',5,function() capture('progress') end)
mp.register_event('end-file',function(event)
    local was_active=active
    local normal_end=event.reason == 'eof' and position and duration and position >= duration * 0.95
    capture('stopped',normal_end)
    active=false
    -- Only a normal end advances. Closing, stopping, or a failed/truncated stream never starts another video.
    if was_active and normal_end then
        refresh_queue()
        if entry then
            waiting=mp.get_time()+20
            if not entry.resolved and not entry.next then mp.osd_message('正在准备下一集…',3) end
            advance_if_ready()
        end
    else waiting=nil end
end)
mp.register_event('shutdown',function() waiting=nil; capture('stopped') end)
