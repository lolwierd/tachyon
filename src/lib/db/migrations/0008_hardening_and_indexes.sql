CREATE INDEX IF NOT EXISTS "idx_series_tag_series" ON "series_tag" ("series_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_bookmark_series" ON "bookmark" ("series_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_note_series" ON "note" ("series_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_sync_log_series" ON "sync_log" ("series_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_chapter_progress_completed_at" ON "chapter_progress" ("series_id", "completed_at");
