-- Cinema launches only: associations are scoped by account, item and source version.
local utils=require 'mp.utils'
local initial=os.getenv('MPV_CINEMA_SUBTITLE_FILE')
if not initial or initial=='' then return end
local expected=os.getenv('MPV_CINEMA_MEDIA_URL')
local queue_file=os.getenv('MPV_CINEMA_QUEUE_FILE')
local file,active,loading,missing=nil,false,false,{}
local default_delay=mp.get_property_number('sub-delay',0)
local default_visible=mp.get_property_bool('sub-visibility',true)
local function read_json(path)
    local f=path and io.open(path,'r');if not f then return nil end
    local text=f:read(1048577);f:close();if not text or #text>1048576 then return nil end
    return utils.parse_json(text)
end
local function local_path(value)
    if type(value)~='string' or value=='' or #value>32768 then return nil end
    if value:match('^%a[%w+.-]*:') and not value:match('^%a:[/\\]') then return nil end
    if not value:match('^[/\\]') and not value:match('^%a:[/\\]') then value=utils.join_path(mp.get_property('working-directory'),value) end
    return value
end
local function save()
    if not active or loading or not file then return end
    local files,seen,selected={}, {}, 'no'
    local sid=mp.get_property_native('sid')
    for _,track in ipairs(mp.get_property_native('track-list',{})) do
        if track.type=='sub' then
            local path=track.external and local_path(track['external-filename'])
            if path and not seen[path] and #files<100 then files[#files+1]=path;seen[path]=true end
            if track.id==sid then selected=path and {path=path} or {id=track.id} end
        end
    end
    for _,path in ipairs(missing) do if not seen[path] and #files<100 then files[#files+1]=path;seen[path]=true end end
    local data={version=1,files=files,selected=selected,delay=mp.get_property_number('sub-delay',0),visible=mp.get_property_bool('sub-visibility',true)}
    local output=io.open(file,'w');if output then output:write(utils.format_json(data));output:close() end
end
mp.register_event('start-file',function() active=false;loading=false end)
mp.register_event('file-loaded',function()
    local media=mp.get_property('path');file=nil;missing={}
    local queue=read_json(queue_file)
    if queue and queue.entries and queue.entries[media] then file=queue.entries[media].subtitleFile
    elseif media==expected then file=initial end
    active=file~=nil;if not active then return end
    loading=true
    mp.set_property_number('sub-delay',default_delay)
    mp.set_property_bool('sub-visibility',default_visible)
    local state=read_json(file)
    if state and state.version==1 and type(state.files)=='table' then
        local existing={}
        for _,track in ipairs(mp.get_property_native('track-list',{})) do local p=track.external and local_path(track['external-filename']);if p then existing[p]=true end end
        for i,value in ipairs(state.files) do
            if i>100 then break end
            local path=local_path(value)
            if path and not existing[path] then
                local info=utils.file_info(path)
                if info and info.is_file then mp.command_native({'sub-add',path,'auto'});existing[path]=true else missing[#missing+1]=path end
            end
        end
        if state.selected=='no' then mp.set_property('sid','no')
        elseif type(state.selected)=='table' then
            for _,track in ipairs(mp.get_property_native('track-list',{})) do
                if track.type=='sub' and ((state.selected.path and local_path(track['external-filename'])==state.selected.path) or (state.selected.id and not track.external and track.id==state.selected.id)) then mp.set_property_number('sid',track.id);break end
            end
        end
        if type(state.delay)=='number' and math.abs(state.delay)<86400 then mp.set_property_number('sub-delay',state.delay) end
        if type(state.visible)=='boolean' then mp.set_property_bool('sub-visibility',state.visible) end
    end
    loading=false
end)
for _,property in ipairs({'track-list','sid','sub-delay','sub-visibility'}) do mp.observe_property(property,'native',save) end
mp.add_hook('on_unload',4,save)
mp.register_event('end-file',function() active=false end)
mp.register_event('shutdown',save)
