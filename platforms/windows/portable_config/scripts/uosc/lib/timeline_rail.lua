local M={}
local function clamp(v,a,b) return math.max(a,math.min(b,v)) end
function M.geometry(ax,bx,size,scale,duration,time,top)
    local expanded=size>=12*scale
    local inset=expanded and math.min(14*scale,(bx-ax)/8) or 0
    local left,right=ax+inset,bx-inset
    local thickness=expanded and 4*scale or math.min(size,2*scale)
    return {left=left,right=right,y=top+(expanded and 3*scale or 0),thickness=thickness,expanded=expanded,
        playhead=left+(right-left)*clamp(duration>0 and time/duration or 0,0,1)}
end
function M.time_at_x(g,x,duration)
    return duration*clamp((x-g.left)/math.max(1,g.right-g.left),0,1)
end
-- uosc supplies missing ranges. Invert their union, preserving disjoint cached islands.
-- nil means unavailable cache data, while an empty table means the whole file is cached.
function M.cached(duration,uncached)
    if not uncached or duration<=0 then return {} end
    local ranges={}
    for _,r in ipairs(uncached) do
        if type(r[1])=='number' and type(r[2])=='number' and r[2]>r[1] then
            ranges[#ranges+1]={clamp(r[1],0,duration),clamp(r[2],0,duration)}
        end
    end
    table.sort(ranges,function(a,b) return a[1]<b[1] end)
    local result,cursor={},0
    for _,r in ipairs(ranges) do
        if r[1]>cursor then result[#result+1]={cursor,r[1]} end
        cursor=math.max(cursor,r[2])
    end
    if cursor<duration then result[#result+1]={cursor,duration} end
    return result
end
function M.missing(duration,cached,bof,eof)
    local ranges={}
    for _,r in ipairs(cached or {}) do
        local a,b=tonumber(r.start),tonumber(r['end'])
        if a and b and b>a then ranges[#ranges+1]={clamp(a,0,duration),clamp(b,0,duration)} end
    end
    table.sort(ranges,function(a,b) return a[1]<b[1] end)
    if #ranges>0 then
        if bof then ranges[1][1]=0 end
        if eof then
            local last=ranges[1]
            for _,r in ipairs(ranges) do if r[2]>last[2] then last=r end end
            last[2]=duration
        end
    end
    return M.cached(duration,ranges)
end
return M
