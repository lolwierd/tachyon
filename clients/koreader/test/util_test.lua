-- Standalone tests for the pure helpers. Run from the repo root:
--   luajit clients/koreader/test/util_test.lua
package.path = "clients/koreader/tachyon.koplugin/?.lua;" .. package.path
local U = require("util")

local function eq(got, want, msg)
    assert(got == want, string.format("%s: got %q, want %q", msg, tostring(got), tostring(want)))
end

-- ext_for: content-type wins, URL is the fallback.
eq(U.ext_for("image/png", "x"), ".png", "png ct")
eq(U.ext_for("image/webp", "x"), ".webp", "webp ct")
eq(U.ext_for("image/avif", "x"), ".avif", "avif ct")
eq(U.ext_for("image/jpeg", "x"), ".jpg", "jpeg ct")
eq(U.ext_for(nil, "https://h/p/img.PNG"), ".png", "url ext (trailing)")
eq(U.ext_for("", "https://h/p/img.webp?sig=1"), ".webp", "url ext (before query)")
eq(U.ext_for(nil, "https://h/p/noext"), ".jpg", "default jpg")
print("ok  ext_for")

-- safe_name: strip path/control chars, collapse whitespace, cap length.
eq(U.safe_name("Vol 1: A/B?"), "Vol 1 A B", "sanitize")
eq(U.safe_name("   "), "untitled", "blank -> untitled")
eq(#U.safe_name(string.rep("x", 300)), 120, "length cap")
print("ok  safe_name")

-- page_index
eq(U.page_index("0007.webp"), 7, "index parse")
eq(U.page_index("cover.jpg"), nil, "non-page -> nil")
print("ok  page_index")

-- ordered_pages: 0001..0012 sort numerically because they're zero-padded.
local names = { "0012.jpg", "0001.png", "0002.webp", "0010.jpg" }
U.ordered_pages(names)
eq(table.concat(names, ","), "0001.png,0002.webp,0010.jpg,0012.jpg", "order")
print("ok  ordered_pages")

-- find_missing: detect gaps against expected count.
eq(#U.find_missing({ "0001.jpg", "0002.jpg", "0003.jpg" }, 3), 0, "complete -> none")
local miss = U.find_missing({ "0001.jpg", "0003.jpg" }, 4)
eq(table.concat(miss, ","), "2,4", "missing 2 and 4")
print("ok  find_missing")

print("PASS")
