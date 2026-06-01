--[[
Tachyon Manga — a KOReader plugin that browses your self-hosted Tachyon server,
downloads chapters (single, a range, or a whole series), packs them into `.cbz`,
opens them in KOReader's reader, and syncs your read progress back to Tachyon.

No OPDS: it talks to Tachyon's own JSON API directly.

Read sync: when you finish a chapter (or close it part-way), the plugin records
progress and POSTs it to /api/reader/state — which also scrobbles completed
chapters to AniList. Because a Kobo's WiFi is usually off while you read, unsent
updates are persisted to an on-device outbox and flushed the next time you're
online (browse the library, or "Sync read progress now").

Files:
  _meta.lua  plugin metadata
  api.lua    HTTP client + auth (CF Access service token / basic / none)
  cbz.lua    pure-Lua STORED zip writer (unit-tested)
  main.lua   this — settings + browse / download / read-sync UI
]]

local DataStorage = require("datastorage")
local InfoMessage = require("ui/widget/infomessage")
local InputDialog = require("ui/widget/inputdialog")
local Menu = require("ui/widget/menu")
local MultiInputDialog = require("ui/widget/multiinputdialog")
local NetworkMgr = require("ui/network/manager")
local ReaderUI = require("apps/reader/readerui")
local SpinWidget = require("ui/widget/spinwidget")
local Trapper = require("ui/trapper")
local UIManager = require("ui/uimanager")
local WidgetContainer = require("ui/widget/container/widgetcontainer")
local ffiutil = require("ffi/util")
local lfs = require("libs/libkoreader-lfs")
local logger = require("logger")
local _ = require("gettext")
local T = ffiutil.template

local Api = require("api")
local Cbz = require("cbz")
local Util = require("util")

local Tachyon = WidgetContainer:extend{
    name = "tachyon",
    is_doc_only = false,
}

-- Path / format helpers ------------------------------------------------------

local function ensure_dir(path)
    if lfs.attributes(path, "mode") == "directory" then return true end
    local cur = ""
    for part in (path .. "/"):gmatch("([^/]*)/") do
        cur = cur .. part .. "/"
        if part ~= "" and lfs.attributes(cur, "mode") ~= "directory" then
            lfs.mkdir(cur)
        end
    end
    return lfs.attributes(path, "mode") == "directory"
end

local safe_name = Util.safe_name
local ext_for = Util.ext_for

local function clear_dir(dir)
    if lfs.attributes(dir, "mode") ~= "directory" then return end
    for name in lfs.dir(dir) do
        if name ~= "." and name ~= ".." then os.remove(dir .. "/" .. name) end
    end
end

local function remove_dir(dir)
    clear_dir(dir)
    lfs.rmdir(dir)
end

-- Names of "%04d.<ext>" page files currently in `dir`.
local function list_page_files(dir)
    local names = {}
    if lfs.attributes(dir, "mode") == "directory" then
        for name in lfs.dir(dir) do
            if name:match("^%d%d%d%d%.") then names[#names + 1] = name end
        end
    end
    return names
end

local function notify(text, timeout)
    UIManager:show(InfoMessage:new{ text = text, timeout = timeout })
end

-- Lifecycle ------------------------------------------------------------------

function Tachyon:init()
    local LuaSettings = require("luasettings")
    self.settings = LuaSettings:open(DataStorage:getSettingsDir() .. "/tachyon.lua")
    self.download_dir = self.settings:readSetting("download_dir")
        or (DataStorage:getDataDir() .. "/tachyon")
    if self.ui and self.ui.menu then
        self.ui.menu:registerToMainMenu(self)
    end
end

function Tachyon:getApi()
    return Api.new{
        base_url = self.settings:readSetting("base_url"),
        auth = self.settings:readSetting("auth") or { kind = "none" },
    }
end

function Tachyon:addToMainMenu(menu_items)
    menu_items.tachyon = {
        text = _("Tachyon Manga"),
        sub_item_table = {
            {
                text = _("Browse library"),
                callback = function() self:withNetwork(function() self:browseLibrary() end) end,
            },
            {
                text_func = function()
                    local q = self.settings:readSetting("queue") or {}
                    return #q > 0 and T(_("Sync read progress now (%1 pending)"), #q)
                        or _("Sync read progress now")
                end,
                keep_menu_open = true,
                callback = function()
                    self:withNetwork(function() self:flushQueue({ force = true, notify = true }) end)
                end,
            },
            {
                text = _("Server settings"),
                keep_menu_open = true,
                sub_item_table_func = function() return self:settingsMenu() end,
            },
        },
    }
end

function Tachyon:withNetwork(action)
    if not self:getApi():isConfigured() then
        return UIManager:show(InfoMessage:new{
            text = _("Set your Tachyon server URL first:\nMenu → Tachyon Manga → Server settings."),
        })
    end
    NetworkMgr:runWhenConnected(action)
end

-- Navigation: one Menu, switched in place ------------------------------------

function Tachyon:openMenu(title, items)
    if self.menu then
        self.menu:switchItemTable(title, items)
    else
        self.menu = Menu:new{
            title = title,
            item_table = items,
            onMenuSelect = function(_, item)
                if item.callback then item.callback() end
            end,
            onMenuHold = function(_, item)
                if item.hold_callback then item.hold_callback(); return true end
            end,
            close_callback = function() self.menu = nil end,
        }
        UIManager:show(self.menu)
    end
end

-- Browse ---------------------------------------------------------------------

function Tachyon:browseLibrary()
    Trapper:wrap(function()
        Trapper:info(_("Loading library…"))
        local ok, library = self:getApi():library()
        Trapper:clear()
        if not ok then
            return notify(T(_("Couldn't load library:\n%1"), tostring(library)))
        end
        if type(library) ~= "table" or #library == 0 then
            return notify(_("Your Tachyon library is empty."))
        end
        local items = {}
        for _, entry in ipairs(library) do
            local suffix = (entry.unreadChapters or 0) > 0
                and T(_("  · %1 new"), entry.unreadChapters) or ""
            items[#items + 1] = {
                text = safe_name(entry.title) .. suffix,
                callback = function() self:withNetwork(function() self:showSeries(entry) end) end,
            }
        end
        self:openMenu(T(_("Tachyon — %1 series"), #library), items)
        -- We're online here, so opportunistically flush any queued read sync.
        pcall(function() self:flushQueue() end)
    end)
end

function Tachyon:showSeries(entry)
    Trapper:wrap(function()
        Trapper:info(T(_("Loading chapters for\n%1…"), entry.title))
        local series_id = entry.sourceSeriesId or entry.seriesId
        local ok, chapters = self:getApi():chapters(series_id, entry.source)
        Trapper:clear()
        if not ok then
            return notify(T(_("Couldn't load chapters:\n%1"), tostring(chapters)))
        end
        if type(chapters) ~= "table" or #chapters == 0 then
            return notify(_("No chapters found for this series."))
        end

        -- The API returns chapters ascending (oldest first); keep that for
        -- range downloads, but display newest-first.
        local items = {}
        items[#items + 1] = {
            text = T(_("⬇  Download all chapters (%1)"), #chapters),
            callback = function()
                self:withNetwork(function() self:bulkDownload(entry, chapters) end)
            end,
        }
        local unread = {}
        for _, c in ipairs(chapters) do
            if c.readState ~= "read" then unread[#unread + 1] = c end
        end
        if #unread > 0 and #unread < #chapters then
            items[#items + 1] = {
                text = T(_("⬇  Download unread (%1)"), #unread),
                callback = function()
                    self:withNetwork(function() self:bulkDownload(entry, unread) end)
                end,
            }
        end

        for i = #chapters, 1, -1 do
            local ch = chapters[i]
            local mark = "   "
            if ch.readState == "read" then mark = "✓ "
            elseif ch.readState == "in-progress" then mark = "▸ " end
            local from_here = {}
            for j = i, #chapters do from_here[#from_here + 1] = chapters[j] end
            items[#items + 1] = {
                text = mark .. safe_name(ch.title or ("Chapter " .. tostring(ch.chapterNo))),
                callback = function()
                    self:withNetwork(function() self:downloadAndOpen(entry, ch) end)
                end,
                -- Long-press: download this chapter and everything newer.
                hold_callback = function()
                    self:withNetwork(function() self:bulkDownload(entry, from_here) end)
                end,
            }
        end
        self:openMenu(safe_name(entry.title), items)
    end)
end

-- Download -------------------------------------------------------------------

-- Download all `pages` into `dir` as "%04d.<ext>" files. Uses a pool of forked
-- subprocesses when possible (KOReader's HTTP is blocking + single-threaded, so
-- real parallelism means forking), falling back to a sequential loop.
-- `on_progress(done, total)` may return false to cancel. Returns (true) or
-- (false, "cancelled"). Per-page failures are left for the caller to detect via
-- missing files, so one dead page doesn't abort the whole chapter.
function Tachyon:downloadPages(api, pages, dir, parallel, on_progress)
    local total = #pages
    local concurrent = parallel and parallel > 1
        and type(ffiutil.runInSubProcess) == "function"
        and type(ffiutil.isSubProcessDone) == "function"

    local function fetch_to_file(idx)
        local ok, body, content_type = api:image(pages[idx].imageUrl)
        if ok and body and #body > 0 then
            local f = io.open(dir .. "/" .. string.format("%04d%s", idx, ext_for(content_type, pages[idx].imageUrl)), "wb")
            if f then f:write(body); f:close() end
        end
    end

    if not concurrent then
        for i = 1, total do
            if on_progress and on_progress(i, total) == false then return false, "cancelled" end
            fetch_to_file(i)
        end
        return true
    end

    parallel = math.min(parallel, 8)
    local pids = {} -- idx -> pid
    local active, finished, next_idx = 0, 0, 1
    while finished < total do
        while active < parallel and next_idx <= total do
            local idx = next_idx
            local pid = ffiutil.runInSubProcess(function() fetch_to_file(idx) end)
            if pid then pids[idx] = pid; active = active + 1 end
            next_idx = next_idx + 1
        end
        local reaped = false
        for idx, pid in pairs(pids) do
            if ffiutil.isSubProcessDone(pid) then
                pids[idx] = nil; active = active - 1; finished = finished + 1; reaped = true
                if on_progress and on_progress(finished, total) == false then
                    for _, p in pairs(pids) do pcall(ffiutil.terminateSubProcess, p) end
                    return false, "cancelled"
                end
            end
        end
        if not reaped and ffiutil.usleep then ffiutil.usleep(40000) end
    end
    return true
end

-- Build one chapter's CBZ. Returns (path, "ok" | "exists") or (nil, err).
-- `on_progress(page, total)` may return false to cancel.
function Tachyon:buildChapter(api, entry, chapter, on_progress)
    local series_id = entry.sourceSeriesId or entry.seriesId
    local series_dir = self.download_dir .. "/" .. safe_name(entry.title)
    local cname = safe_name(chapter.title or ("Chapter " .. tostring(chapter.chapterNo)))
    local target = series_dir .. "/" .. cname .. ".cbz"

    if lfs.attributes(target, "mode") == "file" then
        self:registerBook(target, entry, chapter)
        return target, "exists"
    end
    if not ensure_dir(series_dir) then
        return nil, "can't create folder: " .. series_dir
    end

    local ok, pages = api:pages(chapter.sourceChapterId, series_id, entry.source)
    if not ok or type(pages) ~= "table" or #pages == 0 then
        return nil, tostring(pages)
    end

    local page_dir = target .. ".pages"
    ensure_dir(page_dir)
    clear_dir(page_dir)

    local parallel = tonumber(self.settings:readSetting("parallel")) or 4
    local dok, derr = self:downloadPages(api, pages, page_dir, parallel, on_progress)
    if not dok then remove_dir(page_dir); return nil, derr end

    local names = list_page_files(page_dir)
    local missing = Util.find_missing(names, #pages)
    if #missing > 0 then
        remove_dir(page_dir)
        return nil, T(_("%1 of %2 pages failed (first missing: %3)"), #missing, #pages, missing[1])
    end
    Util.ordered_pages(names)

    local tmp = target .. ".part"
    local cbz, err = Cbz.new(tmp)
    if not cbz then remove_dir(page_dir); return nil, tostring(err) end
    for _, n in ipairs(names) do
        local f = io.open(page_dir .. "/" .. n, "rb")
        local data = f and f:read("*a")
        if f then f:close() end
        if not data then
            cbz:close(); os.remove(tmp); remove_dir(page_dir)
            return nil, "read failed: " .. n
        end
        cbz:add(n, data)
    end
    cbz:close()
    os.rename(tmp, target)
    remove_dir(page_dir)
    self:registerBook(target, entry, chapter)
    logger.info("Tachyon: saved", target)
    return target, "ok"
end

function Tachyon:downloadAndOpen(entry, chapter)
    Trapper:wrap(function()
        local path, status = self:buildChapter(self:getApi(), entry, chapter, function(i, n)
            return Trapper:info(T(_("Downloading %1 / %2…"), i, n))
        end)
        Trapper:clear()
        if not path then
            return notify(T(_("Download failed:\n%1"), tostring(status)))
        end
        self:openBook(path)
    end)
end

function Tachyon:bulkDownload(entry, list)
    Trapper:wrap(function()
        local api = self:getApi()
        local done, skipped, failed, cancelled = 0, 0, 0, false
        for ci, ch in ipairs(list) do
            local label = safe_name(ch.title or ("Chapter " .. tostring(ch.chapterNo)))
            local path, status = self:buildChapter(api, entry, ch, function(pi, pn)
                return Trapper:info(T(_("Chapter %1 / %2 — %3\nPage %4 / %5"),
                    ci, #list, label, pi, pn))
            end)
            if status == "exists" then skipped = skipped + 1
            elseif path then done = done + 1
            elseif status == "cancelled" then cancelled = true; break
            else failed = failed + 1; logger.warn("Tachyon: chapter failed", label, status) end
        end
        Trapper:clear()
        notify(T(_("%1\n%2 downloaded · %3 already had · %4 failed%5"),
            safe_name(entry.title), done, skipped, failed,
            cancelled and _("\n(cancelled)") or ""))
    end)
end

function Tachyon:openBook(path)
    if self.menu then
        UIManager:close(self.menu)
        self.menu = nil
    end
    UIManager:nextTick(function() ReaderUI:showReader(path) end)
end

-- Read-progress sync ---------------------------------------------------------

function Tachyon:registerBook(path, entry, chapter)
    local books = self.settings:readSetting("books") or {}
    books[path] = {
        series_id = entry.sourceSeriesId or entry.seriesId,
        source = entry.source,
        chapter_id = chapter.sourceChapterId,
        title = chapter.title,
        chapter_no = chapter.chapterNo,
    }
    self.settings:saveSetting("books", books)
    self.settings:flush()
end

function Tachyon:lookupBook(path)
    local books = self.settings:readSetting("books") or {}
    return books[path]
end

-- Add/replace the pending sync for a chapter, then try to flush if online.
function Tachyon:enqueueProgress(book, page, total, completed)
    local queue = self.settings:readSetting("queue") or {}
    local kept = {}
    for _, op in ipairs(queue) do
        if op.chapter_id ~= book.chapter_id then kept[#kept + 1] = op end
    end
    kept[#kept + 1] = {
        series_id = book.series_id, source = book.source, chapter_id = book.chapter_id,
        title = book.title, chapter_no = book.chapter_no,
        page = page, total = total, completed = completed and true or false,
        updated_at = os.date("!%Y-%m-%dT%H:%M:%SZ"),
    }
    self.settings:saveSetting("queue", kept)
    self.settings:flush()
    if NetworkMgr:isConnected() then pcall(function() self:flushQueue() end) end
end

function Tachyon:flushQueue(opts)
    opts = opts or {}
    local queue = self.settings:readSetting("queue") or {}
    if #queue == 0 then
        if opts.notify then notify(_("Nothing to sync — you're all caught up.")) end
        return
    end
    if not opts.force and not NetworkMgr:isConnected() then return end
    local api = self:getApi()
    if not api:isConfigured() then return end

    local remaining, synced = {}, 0
    for _, op in ipairs(queue) do
        if api:saveProgress(op) then synced = synced + 1
        else remaining[#remaining + 1] = op end
    end
    self.settings:saveSetting("queue", remaining)
    self.settings:flush()
    if opts.notify then
        notify(T(_("Synced %1 update(s)%2."), synced,
            #remaining > 0 and T(_(", %1 still pending"), #remaining) or ""))
    end
end

-- Reader events (the plugin also loads inside ReaderUI). ----------------------

function Tachyon:onReaderReady()
    local file = self.ui and self.ui.document and self.ui.document.file
    self._book = file and self:lookupBook(file) or nil
    self._page = nil
    self._completed = false
    if self._book and self.ui.document.getPageCount then
        self._total = self.ui.document:getPageCount()
    else
        self._total = nil
    end
end

function Tachyon:onPageUpdate(page)
    if self._book then self._page = page end
end

function Tachyon:onEndOfBook()
    if self._book and self._total then
        self._completed = true
        self:enqueueProgress(self._book, self._total, self._total, true)
    end
end

function Tachyon:onCloseDocument()
    if self._book and self._page and self._total
        and not self._completed and self._page < self._total then
        self:enqueueProgress(self._book, self._page, self._total, false)
    end
end

-- Settings -------------------------------------------------------------------

function Tachyon:settingsMenu()
    local auth = self.settings:readSetting("auth") or { kind = "none" }
    local kind_label = ({
        none = _("None"),
        basic = _("Basic auth"),
        service_token = _("CF Access service token"),
    })[auth.kind] or _("None")
    return {
        {
            text_func = function()
                return T(_("Server URL: %1"), self.settings:readSetting("base_url") or _("(not set)"))
            end,
            keep_menu_open = true,
            callback = function(touchmenu_instance) self:editServerUrl(touchmenu_instance) end,
        },
        {
            text = T(_("Authentication: %1"), kind_label),
            keep_menu_open = true,
            sub_item_table_func = function() return self:authMenu() end,
        },
        {
            text_func = function()
                return T(_("Parallel page downloads: %1"), tonumber(self.settings:readSetting("parallel")) or 4)
            end,
            keep_menu_open = true,
            callback = function(touchmenu_instance) self:editParallel(touchmenu_instance) end,
        },
        {
            text = _("Test connection"),
            keep_menu_open = true,
            callback = function() self:withNetwork(function() self:testConnection() end) end,
        },
    }
end

function Tachyon:editParallel(touchmenu_instance)
    local spin = SpinWidget:new{
        title_text = _("Parallel page downloads"),
        info_text = _("How many pages to fetch at once. Higher is faster when Tachyon has the chapter cached; lower is gentler on a remote source."),
        value = tonumber(self.settings:readSetting("parallel")) or 4,
        value_min = 1,
        value_max = 8,
        value_step = 1,
        value_hold_step = 2,
        ok_text = _("Set"),
        callback = function(s)
            self.settings:saveSetting("parallel", s.value)
            self.settings:flush()
            if touchmenu_instance then touchmenu_instance:updateItems() end
        end,
    }
    UIManager:show(spin)
end

function Tachyon:editServerUrl(touchmenu_instance)
    local dialog
    dialog = InputDialog:new{
        title = _("Tachyon server URL"),
        input = self.settings:readSetting("base_url") or "https://",
        input_hint = "https://tachyon.example.com",
        buttons = {{
            { text = _("Cancel"), id = "close", callback = function() UIManager:close(dialog) end },
            {
                text = _("Save"),
                is_enter_default = true,
                callback = function()
                    self.settings:saveSetting("base_url", (dialog:getInputText() or ""):gsub("/+$", ""))
                    self.settings:flush()
                    UIManager:close(dialog)
                    if touchmenu_instance then touchmenu_instance:updateItems() end
                end,
            },
        }},
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function Tachyon:authMenu()
    return {
        {
            text = _("CF Access service token (recommended)"),
            keep_menu_open = true,
            callback = function() self:editServiceToken() end,
        },
        {
            text = _("Basic auth"),
            keep_menu_open = true,
            callback = function() self:editBasicAuth() end,
        },
        {
            text = _("None"),
            keep_menu_open = true,
            callback = function()
                self.settings:saveSetting("auth", { kind = "none" })
                self.settings:flush()
                notify(_("Authentication disabled."))
            end,
        },
    }
end

function Tachyon:editServiceToken()
    local cur = self.settings:readSetting("auth") or {}
    local dialog
    dialog = MultiInputDialog:new{
        title = _("CF Access service token"),
        fields = {
            { description = _("Client ID"), text = cur.client_id or "", hint = "xxxxx.access" },
            { description = _("Client Secret"), text = cur.client_secret or "", text_type = "password" },
        },
        buttons = {{
            { text = _("Cancel"), id = "close", callback = function() UIManager:close(dialog) end },
            {
                text = _("Save"),
                callback = function()
                    local f = dialog:getFields()
                    self.settings:saveSetting("auth",
                        { kind = "service_token", client_id = f[1], client_secret = f[2] })
                    self.settings:flush()
                    UIManager:close(dialog)
                    notify(_("Service token saved."))
                end,
            },
        }},
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function Tachyon:editBasicAuth()
    local cur = self.settings:readSetting("auth") or {}
    local dialog
    dialog = MultiInputDialog:new{
        title = _("Basic auth"),
        fields = {
            { description = _("Username"), text = cur.username or "" },
            { description = _("Password"), text = cur.password or "", text_type = "password" },
        },
        buttons = {{
            { text = _("Cancel"), id = "close", callback = function() UIManager:close(dialog) end },
            {
                text = _("Save"),
                callback = function()
                    local f = dialog:getFields()
                    self.settings:saveSetting("auth", { kind = "basic", username = f[1], password = f[2] })
                    self.settings:flush()
                    UIManager:close(dialog)
                    notify(_("Basic auth saved."))
                end,
            },
        }},
    }
    UIManager:show(dialog)
    dialog:onShowKeyboard()
end

function Tachyon:testConnection()
    Trapper:wrap(function()
        Trapper:info(_("Contacting server…"))
        local ok, res = self:getApi():library()
        Trapper:clear()
        if ok then
            notify(T(_("Connected. %1 series in library."), type(res) == "table" and #res or 0))
        else
            notify(T(_("Connection failed:\n%1"), tostring(res)))
        end
    end)
end

return Tachyon
