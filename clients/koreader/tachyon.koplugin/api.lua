--[[
HTTP client for the Tachyon manga server.

Speaks the same JSON+image API the web app uses:
  GET /api/library                                  -> library entries
  GET /api/search?q=                                -> search results
  GET /api/series/{id}/chapters?source=             -> chapters (+ read state)
  GET /api/chapters/{chId}/pages?seriesId=&source=  -> pages (imageUrl rewritten)
  GET /api/media/page?url=...                        -> page image bytes
  GET /api/media/cover/{seriesId}                    -> cover image bytes

Auth is pluggable because the server can sit behind Cloudflare Access. The
default is a CF Access *service token* (machine auth: two headers, no browser
redirect). Basic auth and "none" are also supported for LAN / Tailscale setups.
]]

local http = require("socket.http")
local https = require("ssl.https")
local ltn12 = require("ltn12")
local socket = require("socket")
local socket_url = require("socket.url")
local socketutil = require("socketutil")
local rapidjson = require("rapidjson")
local logger = require("logger")

local Api = {}
Api.__index = Api

--- `config` = { base_url, auth = { kind, ... } }
--   auth.kind == "service_token" -> { client_id, client_secret }
--   auth.kind == "basic"         -> { username, password }
--   auth.kind == "none"          -> {}
function Api.new(config)
    return setmetatable({
        base_url = (config.base_url or ""):gsub("/+$", ""),
        auth = config.auth or { kind = "none" },
    }, Api)
end

function Api:isConfigured()
    return self.base_url ~= nil and self.base_url ~= ""
end

-- Headers the server requires to let a non-browser client through. ------------
function Api:_authHeaders()
    local h = {}
    local auth = self.auth or {}
    if auth.kind == "service_token" and auth.client_id and auth.client_secret then
        h["CF-Access-Client-Id"] = auth.client_id
        h["CF-Access-Client-Secret"] = auth.client_secret
    elseif auth.kind == "basic" and auth.username then
        local mime = require("mime")
        h["Authorization"] = "Basic " .. mime.b64((auth.username or "") .. ":" .. (auth.password or ""))
    end
    return h
end

-- Low-level GET. Returns (ok, body_or_err, content_type, status_code). --------
function Api:_get(path, timeout_block, timeout_total)
    local url = path:find("^https?://") and path or (self.base_url .. path)
    local headers = self:_authHeaders()
    headers["User-Agent"] = "Tachyon-KOReader/1.0"

    local sink = {}
    socketutil:set_timeout(timeout_block or socketutil.DEFAULT_BLOCK_TIMEOUT,
                           timeout_total or socketutil.DEFAULT_TOTAL_TIMEOUT)
    local requester = url:find("^https://") and https.request or http.request
    local code, resp_headers, status = socket.skip(1, requester{
        url = url,
        method = "GET",
        headers = headers,
        sink = ltn12.sink.table(sink),
    })
    socketutil:reset_timeout()

    if type(code) ~= "number" then
        logger.warn("Tachyon: request failed", url, code)
        return false, tostring(code or status or "network error")
    end
    local body = table.concat(sink)
    if code < 200 or code >= 300 then
        logger.warn("Tachyon: HTTP", code, url)
        return false, "HTTP " .. code, nil, code
    end
    local content_type = resp_headers and (resp_headers["content-type"] or resp_headers["Content-Type"])
    return true, body, content_type, code
end

function Api:_getJson(path)
    local ok, body, _, code = self:_get(path)
    if not ok then return false, body, code end
    local decoded, err = rapidjson.decode(body)
    if decoded == nil then return false, "bad JSON: " .. tostring(err) end
    return true, decoded
end

local function urlencode(s)
    return socket_url.escape(tostring(s))
end

-- High-level endpoints. -------------------------------------------------------

function Api:library()
    return self:_getJson("/api/library")
end

function Api:search(query)
    return self:_getJson("/api/search?q=" .. urlencode(query))
end

-- `series_id` may be the internal seriesId or the sourceSeriesId; the server
-- accepts either. `source` is the scraper name from the library entry.
function Api:chapters(series_id, source)
    local path = "/api/series/" .. urlencode(series_id) .. "/chapters"
    if source and source ~= "" then path = path .. "?source=" .. urlencode(source) end
    return self:_getJson(path)
end

function Api:pages(chapter_id, series_id, source)
    local path = "/api/chapters/" .. urlencode(chapter_id) .. "/pages?seriesId=" .. urlencode(series_id)
    if source and source ~= "" then path = path .. "&source=" .. urlencode(source) end
    return self:_getJson(path)
end

-- Raw image bytes. `media_path` is the relative imageUrl from a pages response
-- (e.g. "/api/media/page?url=..."), or a "/api/media/cover/{id}" path.
function Api:image(media_path)
    -- Pages can be large and the upstream CDN slow; give them a longer leash.
    return self:_get(media_path, socketutil.LARGE_BLOCK_TIMEOUT, socketutil.FILE_BLOCK_TIMEOUT)
end

function Api:coverPath(series_id)
    return "/api/media/cover/" .. urlencode(series_id)
end

-- Low-level POST of a JSON body. Returns (ok, body_or_err). -------------------
-- Note: Tachyon's CSRF guard (assertTrustedWriteRequest) only rejects writes
-- that carry a cross-site Origin / Sec-Fetch-Site header. A Lua client sends
-- neither, so a plain POST with the auth headers is accepted.
function Api:_post(path, body_table)
    local url = self.base_url .. path
    local headers = self:_authHeaders()
    headers["User-Agent"] = "Tachyon-KOReader/1.0"
    headers["Content-Type"] = "application/json"
    local payload = rapidjson.encode(body_table)
    headers["Content-Length"] = tostring(#payload)

    local sink = {}
    socketutil:set_timeout()
    local requester = url:find("^https://") and https.request or http.request
    local code = socket.skip(1, requester{
        url = url,
        method = "POST",
        headers = headers,
        source = ltn12.source.string(payload),
        sink = ltn12.sink.table(sink),
    })
    socketutil:reset_timeout()

    if type(code) ~= "number" then
        logger.warn("Tachyon: POST failed", url, code)
        return false, tostring(code or "network error")
    end
    local body = table.concat(sink)
    if code < 200 or code >= 300 then
        return false, "HTTP " .. code
    end
    return true, body
end

-- Persist reading progress for a chapter. `p` carries the fields the server's
-- /api/reader/state schema expects (currentPage/pageCount/completed). On
-- completion the server also scrobbles the series to AniList.
function Api:saveProgress(p)
    local body = {
        seriesId = p.series_id,
        chapterId = p.chapter_id,
        pageCount = math.max(p.total or 1, 1),
        currentPage = math.max(p.page or 0, 0),
    }
    if p.source and p.source ~= "" then body.source = p.source end
    if p.completed then body.completed = true end
    if p.title and p.title ~= "" then body.chapterTitle = p.title end
    if p.chapter_no then body.chapterNo = p.chapter_no end
    if p.updated_at then body.updatedAt = p.updated_at end
    return self:_post("/api/reader/state", body)
end

return Api
