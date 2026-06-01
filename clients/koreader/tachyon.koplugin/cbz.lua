--[[
Minimal STORED (uncompressed) ZIP writer used to pack downloaded manga pages
into a `.cbz` archive on-device.

Why STORED and not DEFLATE: manga pages are already-compressed JPEG/WebP/PNG,
so re-compressing them buys nothing and would mean depending on a zlib binding
being present on every Kobo firmware. A STORED zip is just headers + raw bytes,
so this module is pure Lua with zero external dependencies — which also makes it
unit-testable with a plain `luajit` outside of KOReader.

Deliberately scoped to what a CBZ needs: no directories, no zip64, no data
descriptors. Files are expected to be < 4 GiB (a single manga chapter).
]]

local bit = require("bit")
local band, bxor, rshift = bit.band, bit.bxor, bit.rshift

-- CRC-32 (IEEE, polynomial 0xEDB88320), table-driven. ------------------------
local crc_table
local function init_crc_table()
    crc_table = {}
    for i = 0, 255 do
        local c = i
        for _ = 1, 8 do
            if band(c, 1) == 1 then
                c = bxor(0xEDB88320, rshift(c, 1))
            else
                c = rshift(c, 1)
            end
        end
        crc_table[i] = c
    end
end

local function crc32(str)
    if not crc_table then init_crc_table() end
    local crc = 0xFFFFFFFF
    for i = 1, #str do
        crc = bxor(rshift(crc, 8), crc_table[band(bxor(crc, string.byte(str, i)), 0xFF)])
    end
    return bxor(crc, 0xFFFFFFFF)
end

-- Little-endian integer packers. band() also normalises luajit's signed 32-bit
-- results (e.g. from the CRC's final xor) into the correct byte pattern. -------
local function u16(n)
    return string.char(band(n, 0xFF), band(rshift(n, 8), 0xFF))
end

local function u32(n)
    return string.char(
        band(n, 0xFF),
        band(rshift(n, 8), 0xFF),
        band(rshift(n, 16), 0xFF),
        band(rshift(n, 24), 0xFF))
end

local Cbz = {}
Cbz.__index = Cbz

--- Open `path` for writing. Returns (cbz, nil) or (nil, err_string).
function Cbz.new(path)
    local fh, err = io.open(path, "wb")
    if not fh then return nil, err end
    return setmetatable({ fh = fh, offset = 0, central = {}, count = 0 }, Cbz)
end

function Cbz:_write(s)
    self.fh:write(s)
    self.offset = self.offset + #s
end

--- Append one file. `name` is the in-archive path, `data` its raw bytes.
function Cbz:add(name, data)
    local crc = crc32(data)
    local sz = #data
    local local_offset = self.offset

    -- Local file header (30 bytes fixed + name).
    self:_write("PK\3\4"
        .. u16(20) .. u16(0) .. u16(0)   -- version needed, flags, method=stored
        .. u16(0) .. u16(0)              -- mod time, mod date (unset)
        .. u32(crc) .. u32(sz) .. u32(sz)
        .. u16(#name) .. u16(0))         -- name length, extra length
    self:_write(name)
    self:_write(data)

    -- Central directory record (46 bytes fixed + name), buffered until close().
    self.central[#self.central + 1] = "PK\1\2"
        .. u16(20) .. u16(20) .. u16(0) .. u16(0)  -- ver made, ver needed, flags, method
        .. u16(0) .. u16(0)                        -- mod time, mod date
        .. u32(crc) .. u32(sz) .. u32(sz)
        .. u16(#name) .. u16(0) .. u16(0)          -- name, extra, comment lengths
        .. u16(0) .. u16(0) .. u32(0)              -- disk start, internal attrs, external attrs
        .. u32(local_offset)
        .. name
    self.count = self.count + 1
end

--- Write the central directory + end-of-central-directory record and close.
function Cbz:close()
    local cd_offset = self.offset
    local cd_size = 0
    for _, record in ipairs(self.central) do
        self:_write(record)
        cd_size = cd_size + #record
    end
    self:_write("PK\5\6"
        .. u16(0) .. u16(0)                  -- this disk, disk with central dir
        .. u16(self.count) .. u16(self.count) -- entries this disk, total entries
        .. u32(cd_size) .. u32(cd_offset)
        .. u16(0))                            -- comment length
    self.fh:close()
    self.fh = nil
end

-- Exposed for unit testing.
Cbz._crc32 = crc32

return Cbz
