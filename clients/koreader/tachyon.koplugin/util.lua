--[[
Pure helpers with no KOReader dependencies, so they can be unit-tested with a
plain `luajit` (see ../test/util_test.lua).
]]

local Util = {}

--- Pick a file extension for a downloaded page from its content-type (preferred)
--  or, failing that, the URL.
function Util.ext_for(content_type, url)
    content_type = (content_type or ""):lower()
    if content_type:find("png") then return ".png" end
    if content_type:find("webp") then return ".webp" end
    if content_type:find("avif") then return ".avif" end
    if content_type:find("gif") then return ".gif" end
    if content_type:find("jpeg") or content_type:find("jpg") then return ".jpg" end
    local e = url and (url:match("%.(%w%w?%w?%w?)[?&]") or url:match("%.(%w%w?%w?%w?)$"))
    return e and ("." .. e:lower()) or ".jpg"
end

--- Strip characters that are illegal/awkward in filenames across FAT/ext.
function Util.safe_name(s)
    s = tostring(s or ""):gsub('[/\\:*?"<>|%c]', " "):gsub("%s+", " ")
        :gsub("^%s+", ""):gsub("%s+$", "")
    if s == "" then s = "untitled" end
    return s:sub(1, 120)
end

--- Page files are named "%04d.<ext>"; return the leading 1-based index or nil.
function Util.page_index(name)
    return tonumber(name and name:match("^(%d%d%d%d)"))
end

--- Sort page filenames into page order (zero-padded names sort lexically).
function Util.ordered_pages(names)
    table.sort(names)
    return names
end

--- Given the page files present and the expected count, return the list of
--  missing 1-based page indexes (empty when every page downloaded).
function Util.find_missing(names, expected)
    local present = {}
    for _, n in ipairs(names) do
        local i = Util.page_index(n)
        if i then present[i] = true end
    end
    local missing = {}
    for i = 1, expected do
        if not present[i] then missing[#missing + 1] = i end
    end
    return missing
end

return Util
