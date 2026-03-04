import { sqliteTable, text, integer, real, primaryKey, unique } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";


export const series = sqliteTable("series", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text("title").notNull(),
  altTitles: text("alt_titles"),
  description: text("description"),
  coverUrl: text("cover_url"),
  anilistId: integer("anilist_id"),
  status: text("status", { enum: ["ongoing", "complete", "hiatus", "canceled"] }),
  contentType: text("content_type", { enum: ["manga", "manhwa", "manhua", "oel"] }),
  year: integer("year"),
  adult: integer("adult", { mode: "boolean" }),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const seriesRelations = relations(series, ({ many, one }) => ({
  sourceMappings: many(sourceMapping),
  chapters: many(chapter),
  libraryEntry: one(libraryEntry),
  collectionSeries: many(collectionSeries),
  seriesTags: many(seriesTag),
  readingProgress: one(readingProgress),
  seriesPreferences: one(seriesPreferences),
  bookmarks: many(bookmark),
  notes: many(note),
  activityEvents: many(activityEvent),
  anilistSync: one(anilistSync),
}));


export const sourceMapping = sqliteTable(
  "source_mapping",
  {
    id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
    seriesId: text("series_id").notNull().references(() => series.id),
    source: text("source", { enum: ["weebcentral", "comix"] }).notNull(),
    sourceSeriesId: text("source_series_id").notNull(),
    sourceUrl: text("source_url"),
  },
  (t) => [unique("uq_source_series").on(t.source, t.sourceSeriesId)],
);

export const sourceMappingRelations = relations(sourceMapping, ({ one }) => ({
  series: one(series, { fields: [sourceMapping.seriesId], references: [series.id] }),
}));


export const chapter = sqliteTable("chapter", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  seriesId: text("series_id").notNull().references(() => series.id),
  source: text("source").notNull(),
  sourceChapterId: text("source_chapter_id").notNull(),
  chapterNo: real("chapter_no").notNull(),
  volumeNo: real("volume_no"),
  title: text("title"),
  pageCount: integer("page_count").default(0),
  publishedAt: integer("published_at", { mode: "timestamp" }),
  sortKey: real("sort_key").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const chapterRelations = relations(chapter, ({ one, many }) => ({
  series: one(series, { fields: [chapter.seriesId], references: [series.id] }),
  chapterProgress: one(chapterProgress),
  mediaCache: one(mediaCache),
  bookmarks: many(bookmark),
  notes: many(note),
  activityEvents: many(activityEvent),
}));


export const libraryEntry = sqliteTable("library_entry", {
  seriesId: text("series_id").primaryKey().references(() => series.id),
  status: text("status", {
    enum: ["reading", "completed", "paused", "dropped", "rereading", "planning"],
  }).notNull(),
  addedAt: integer("added_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  rating: integer("rating"),
  favorite: integer("favorite", { mode: "boolean" }).default(false),
});

export const libraryEntryRelations = relations(libraryEntry, ({ one }) => ({
  series: one(series, { fields: [libraryEntry.seriesId], references: [series.id] }),
}));


export const collection = sqliteTable("collection", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  description: text("description"),
  icon: text("icon"),
  sortOrder: integer("sort_order").default(0),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const collectionRelations = relations(collection, ({ many }) => ({
  collectionSeries: many(collectionSeries),
}));


export const collectionSeries = sqliteTable(
  "collection_series",
  {
    collectionId: text("collection_id").notNull().references(() => collection.id),
    seriesId: text("series_id").notNull().references(() => series.id),
    sortOrder: integer("sort_order").default(0),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.seriesId] })],
);

export const collectionSeriesRelations = relations(collectionSeries, ({ one }) => ({
  collection: one(collection, { fields: [collectionSeries.collectionId], references: [collection.id] }),
  series: one(series, { fields: [collectionSeries.seriesId], references: [series.id] }),
}));


export const tag = sqliteTable("tag", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull().unique(),
  color: text("color"),
  type: text("type", { enum: ["mood", "genre", "theme", "custom"] }).notNull(),
});

export const tagRelations = relations(tag, ({ many }) => ({
  seriesTags: many(seriesTag),
}));


export const seriesTag = sqliteTable(
  "series_tag",
  {
    seriesId: text("series_id").notNull().references(() => series.id),
    tagId: text("tag_id").notNull().references(() => tag.id),
  },
  (t) => [primaryKey({ columns: [t.seriesId, t.tagId] })],
);

export const seriesTagRelations = relations(seriesTag, ({ one }) => ({
  series: one(series, { fields: [seriesTag.seriesId], references: [series.id] }),
  tag: one(tag, { fields: [seriesTag.tagId], references: [tag.id] }),
}));


export const readingProgress = sqliteTable("reading_progress", {
  seriesId: text("series_id").primaryKey().references(() => series.id),
  currentChapterId: text("current_chapter_id").references(() => chapter.id),
  currentPage: integer("current_page").default(0),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const readingProgressRelations = relations(readingProgress, ({ one }) => ({
  series: one(series, { fields: [readingProgress.seriesId], references: [series.id] }),
  currentChapter: one(chapter, { fields: [readingProgress.currentChapterId], references: [chapter.id] }),
}));


export const chapterProgress = sqliteTable("chapter_progress", {
  chapterId: text("chapter_id").primaryKey().references(() => chapter.id),
  seriesId: text("series_id").notNull().references(() => series.id),
  lastPage: integer("last_page").default(0),
  completed: integer("completed", { mode: "boolean" }).default(false),
  startedAt: integer("started_at", { mode: "timestamp" }),
  completedAt: integer("completed_at", { mode: "timestamp" }),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const chapterProgressRelations = relations(chapterProgress, ({ one }) => ({
  chapter: one(chapter, { fields: [chapterProgress.chapterId], references: [chapter.id] }),
  series: one(series, { fields: [chapterProgress.seriesId], references: [series.id] }),
}));


export const seriesPreferences = sqliteTable("series_preferences", {
  seriesId: text("series_id").primaryKey().references(() => series.id),
  readingDirection: text("reading_direction", { enum: ["ltr", "rtl", "vertical"] }).default("vertical"),
  fitMode: text("fit_mode", { enum: ["width", "height", "original"] }).default("width"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const seriesPreferencesRelations = relations(seriesPreferences, ({ one }) => ({
  series: one(series, { fields: [seriesPreferences.seriesId], references: [series.id] }),
}));


export const bookmark = sqliteTable("bookmark", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  seriesId: text("series_id").notNull().references(() => series.id),
  chapterId: text("chapter_id").notNull().references(() => chapter.id),
  pageIndex: integer("page_index").notNull(),
  label: text("label"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const bookmarkRelations = relations(bookmark, ({ one }) => ({
  series: one(series, { fields: [bookmark.seriesId], references: [series.id] }),
  chapter: one(chapter, { fields: [bookmark.chapterId], references: [chapter.id] }),
}));


export const note = sqliteTable("note", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  seriesId: text("series_id").notNull().references(() => series.id),
  chapterId: text("chapter_id").references(() => chapter.id),
  pageIndex: integer("page_index"),
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const noteRelations = relations(note, ({ one }) => ({
  series: one(series, { fields: [note.seriesId], references: [series.id] }),
  chapter: one(chapter, { fields: [note.chapterId], references: [chapter.id] }),
}));


export const activityEvent = sqliteTable("activity_event", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  type: text("type").notNull(),
  seriesId: text("series_id").references(() => series.id),
  chapterId: text("chapter_id").references(() => chapter.id),
  payload: text("payload"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const activityEventRelations = relations(activityEvent, ({ one }) => ({
  series: one(series, { fields: [activityEvent.seriesId], references: [series.id] }),
  chapter: one(chapter, { fields: [activityEvent.chapterId], references: [chapter.id] }),
}));


export const anilistAccount = sqliteTable("anilist_account", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  accessToken: text("access_token").notNull(),
  tokenType: text("token_type").notNull().default("Bearer"),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  viewerId: integer("viewer_id"),
  viewerName: text("viewer_name"),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});


export const anilistSync = sqliteTable("anilist_sync", {
  seriesId: text("series_id").primaryKey().references(() => series.id),
  anilistId: integer("anilist_id").notNull(),
  mediaListEntryId: integer("media_list_entry_id"),
  lastSyncedAt: integer("last_synced_at", { mode: "timestamp" }),
  syncState: text("sync_state", { enum: ["idle", "running", "success", "error", "conflict"] })
    .notNull()
    .default("idle"),
  lastDirection: text("last_direction", { enum: ["import", "push", "pull", "merge"] }),
  lastError: text("last_error"),
  remoteStatus: text("remote_status"),
  remoteProgress: integer("remote_progress").default(0),
  remoteUpdatedAt: integer("remote_updated_at", { mode: "timestamp" }),
});

export const anilistSyncRelations = relations(anilistSync, ({ one }) => ({
  series: one(series, { fields: [anilistSync.seriesId], references: [series.id] }),
}));


export const syncLog = sqliteTable("sync_log", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  seriesId: text("series_id").references(() => series.id),
  direction: text("direction", { enum: ["import", "push", "pull", "merge"] }).notNull(),
  status: text("status", { enum: ["success", "error", "conflict"] }).notNull(),
  details: text("details").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(() => new Date()),
});

export const syncLogRelations = relations(syncLog, ({ one }) => ({
  series: one(series, { fields: [syncLog.seriesId], references: [series.id] }),
}));


export const mediaCache = sqliteTable("media_cache", {
  chapterId: text("chapter_id").primaryKey().references(() => chapter.id),
  state: text("state", { enum: ["missing", "partial", "ready"] }).notNull(),
  bytes: integer("bytes").default(0),
  cachedAt: integer("cached_at", { mode: "timestamp" }),
  path: text("path"),
});

export const mediaCacheRelations = relations(mediaCache, ({ one }) => ({
  chapter: one(chapter, { fields: [mediaCache.chapterId], references: [chapter.id] }),
}));
