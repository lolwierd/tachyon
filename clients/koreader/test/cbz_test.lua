-- Standalone test for the CBZ writer. Run from the repo root with:
--   luajit clients/koreader/test/cbz_test.lua
-- It writes a real archive to a temp path and shells out to `unzip` to verify
-- structure + per-file CRC integrity, then checks one CRC against a known value.

package.path = "clients/koreader/tachyon.koplugin/?.lua;" .. package.path
local Cbz = require("cbz")

-- Known-answer check: CRC32("123456789") == 0xCBF43926.
local crc = Cbz._crc32("123456789")
assert(crc % 0x100000000 == 0xCBF43926,
    string.format("CRC32 self-check failed: got %08X", crc % 0x100000000))
print("ok  CRC32 known-answer (0xCBF43926)")

local path = os.tmpname() .. ".cbz"
local files = {
    ["0001.txt"] = "hello tachyon",
    ["0002.txt"] = string.rep("MANGA", 5000), -- 25 KB, exercises larger sizes
    ["0003.bin"] = "\0\1\2\255\254\253binary\0data",
}
local order = { "0001.txt", "0002.txt", "0003.bin" }

local cbz = assert(Cbz.new(path))
for _, name in ipairs(order) do cbz:add(name, files[name]) end
cbz:close()

-- `unzip -t` validates the central directory and recomputes every CRC.
local test = io.popen("unzip -t " .. path .. " 2>&1")
local test_out = test:read("*a")
test:close()
assert(test_out:find("No errors detected"),
    "unzip integrity check failed:\n" .. test_out)
print("ok  unzip -t: No errors detected (CRCs valid)")

-- Round-trip each member and compare bytes exactly.
for _, name in ipairs(order) do
    local p = io.popen("unzip -p " .. path .. " " .. name)
    local got = p:read("*a")
    p:close()
    assert(got == files[name], "content mismatch for " .. name)
end
print("ok  round-trip: 3/3 members byte-identical")

os.remove(path)
print("PASS")
