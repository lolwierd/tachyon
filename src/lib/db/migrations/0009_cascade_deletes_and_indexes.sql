-- Migration: Add ON DELETE CASCADE/SET NULL to foreign keys + missing indexes
-- SQLite requires table recreation to change FK constraints.

PRAGMA foreign_keys=OFF;
--> statement-breakpoint

-- 1. source_mapping: series_id → CASCADE
CREATE TABLE `__new_source_mapping` (
    `id` text PRIMARY KEY NOT NULL,
    `series_id` text NOT NULL REFERENCES `series`(`id`) ON DELETE CASCADE,
    `source` text NOT NULL,
    `source_series_id` text NOT NULL,
    `source_url` text
);
--> statement-breakpoint
INSERT INTO `__new_source_mapping` SELECT * FROM `source_mapping`;
--> statement-breakpoint
DROP TABLE `source_mapping`;
--> statement-breakpoint
ALTER TABLE `__new_source_mapping` RENAME TO `source_mapping`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_source_series` ON `source_mapping` (`source`, `source_series_id`);
--> statement-breakpoint
CREATE INDEX `idx_source_mapping_series` ON `source_mapping` (`series_id`);
--> statement-breakpoint

-- 2. chapter: series_id → CASCADE
CREATE TABLE `__new_chapter` (
    `id` text PRIMARY KEY NOT NULL,
    `series_id` text NOT NULL REFERENCES `series`(`id`) ON DELETE CASCADE,
    `source` text NOT NULL,
    `source_chapter_id` text NOT NULL,
    `chapter_no` real NOT NULL,
    `volume_no` real,
    `title` text,
    `page_count` integer DEFAULT 0,
    `published_at` integer,
    `sort_key` real NOT NULL,
    `created_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_chapter` SELECT * FROM `chapter`;
--> statement-breakpoint
DROP TABLE `chapter`;
--> statement-breakpoint
ALTER TABLE `__new_chapter` RENAME TO `chapter`;
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_chapter_identity` ON `chapter` (`series_id`, `source`, `source_chapter_id`);
--> statement-breakpoint
CREATE INDEX `idx_chapter_series` ON `chapter` (`series_id`);
--> statement-breakpoint
CREATE INDEX `idx_chapter_series_source_srcid` ON `chapter` (`series_id`, `source`, `source_chapter_id`);
--> statement-breakpoint

-- 3. library_entry: series_id → CASCADE
CREATE TABLE `__new_library_entry` (
    `series_id` text PRIMARY KEY NOT NULL REFERENCES `series`(`id`) ON DELETE CASCADE,
    `status` text NOT NULL,
    `added_at` integer,
    `updated_at` integer,
    `rating` integer,
    `favorite` integer DEFAULT false
);
--> statement-breakpoint
INSERT INTO `__new_library_entry` SELECT * FROM `library_entry`;
--> statement-breakpoint
DROP TABLE `library_entry`;
--> statement-breakpoint
ALTER TABLE `__new_library_entry` RENAME TO `library_entry`;
--> statement-breakpoint

-- 4. series_tag: series_id → CASCADE, tag_id → CASCADE
CREATE TABLE `__new_series_tag` (
    `series_id` text NOT NULL REFERENCES `series`(`id`) ON DELETE CASCADE,
    `tag_id` text NOT NULL REFERENCES `tag`(`id`) ON DELETE CASCADE,
    PRIMARY KEY(`series_id`, `tag_id`)
);
--> statement-breakpoint
INSERT INTO `__new_series_tag` SELECT * FROM `series_tag`;
--> statement-breakpoint
DROP TABLE `series_tag`;
--> statement-breakpoint
ALTER TABLE `__new_series_tag` RENAME TO `series_tag`;
--> statement-breakpoint
CREATE INDEX `idx_series_tag_series` ON `series_tag` (`series_id`);
--> statement-breakpoint
CREATE INDEX `idx_series_tag_tag` ON `series_tag` (`tag_id`);
--> statement-breakpoint

-- 5. reading_progress: series_id → CASCADE, current_chapter_id → SET NULL
CREATE TABLE `__new_reading_progress` (
    `series_id` text PRIMARY KEY NOT NULL REFERENCES `series`(`id`) ON DELETE CASCADE,
    `current_chapter_id` text REFERENCES `chapter`(`id`) ON DELETE SET NULL,
    `current_page` integer DEFAULT 0,
    `updated_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_reading_progress` SELECT * FROM `reading_progress`;
--> statement-breakpoint
DROP TABLE `reading_progress`;
--> statement-breakpoint
ALTER TABLE `__new_reading_progress` RENAME TO `reading_progress`;
--> statement-breakpoint

-- 6. chapter_progress: chapter_id → CASCADE, series_id → CASCADE
CREATE TABLE `__new_chapter_progress` (
    `chapter_id` text PRIMARY KEY NOT NULL REFERENCES `chapter`(`id`) ON DELETE CASCADE,
    `series_id` text NOT NULL REFERENCES `series`(`id`) ON DELETE CASCADE,
    `last_page` integer DEFAULT 0,
    `completed` integer DEFAULT false,
    `started_at` integer,
    `completed_at` integer,
    `updated_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_chapter_progress` SELECT * FROM `chapter_progress`;
--> statement-breakpoint
DROP TABLE `chapter_progress`;
--> statement-breakpoint
ALTER TABLE `__new_chapter_progress` RENAME TO `chapter_progress`;
--> statement-breakpoint
CREATE INDEX `idx_chapter_progress_series` ON `chapter_progress` (`series_id`, `completed`);
--> statement-breakpoint
CREATE INDEX `idx_chapter_progress_completed_at` ON `chapter_progress` (`series_id`, `completed_at`);
--> statement-breakpoint

-- 7. series_preferences: series_id → CASCADE
CREATE TABLE `__new_series_preferences` (
    `series_id` text PRIMARY KEY NOT NULL REFERENCES `series`(`id`) ON DELETE CASCADE,
    `reading_direction` text DEFAULT 'vertical',
    `fit_mode` text DEFAULT 'width',
    `updated_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_series_preferences` SELECT * FROM `series_preferences`;
--> statement-breakpoint
DROP TABLE `series_preferences`;
--> statement-breakpoint
ALTER TABLE `__new_series_preferences` RENAME TO `series_preferences`;
--> statement-breakpoint

-- 8. bookmark: series_id → CASCADE, chapter_id → CASCADE
CREATE TABLE `__new_bookmark` (
    `id` text PRIMARY KEY NOT NULL,
    `series_id` text NOT NULL REFERENCES `series`(`id`) ON DELETE CASCADE,
    `chapter_id` text NOT NULL REFERENCES `chapter`(`id`) ON DELETE CASCADE,
    `page_index` integer NOT NULL,
    `label` text,
    `created_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_bookmark` SELECT * FROM `bookmark`;
--> statement-breakpoint
DROP TABLE `bookmark`;
--> statement-breakpoint
ALTER TABLE `__new_bookmark` RENAME TO `bookmark`;
--> statement-breakpoint
CREATE INDEX `idx_bookmark_series` ON `bookmark` (`series_id`);
--> statement-breakpoint

-- 9. note: series_id → CASCADE, chapter_id → SET NULL
CREATE TABLE `__new_note` (
    `id` text PRIMARY KEY NOT NULL,
    `series_id` text NOT NULL REFERENCES `series`(`id`) ON DELETE CASCADE,
    `chapter_id` text REFERENCES `chapter`(`id`) ON DELETE SET NULL,
    `page_index` integer,
    `body` text NOT NULL,
    `created_at` integer,
    `updated_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_note` SELECT * FROM `note`;
--> statement-breakpoint
DROP TABLE `note`;
--> statement-breakpoint
ALTER TABLE `__new_note` RENAME TO `note`;
--> statement-breakpoint
CREATE INDEX `idx_note_series` ON `note` (`series_id`);
--> statement-breakpoint
CREATE INDEX `idx_note_chapter` ON `note` (`chapter_id`);
--> statement-breakpoint

-- 10. activity_event: series_id → SET NULL, chapter_id → SET NULL
CREATE TABLE `__new_activity_event` (
    `id` text PRIMARY KEY NOT NULL,
    `type` text NOT NULL,
    `series_id` text REFERENCES `series`(`id`) ON DELETE SET NULL,
    `chapter_id` text REFERENCES `chapter`(`id`) ON DELETE SET NULL,
    `payload` text,
    `created_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_activity_event` SELECT * FROM `activity_event`;
--> statement-breakpoint
DROP TABLE `activity_event`;
--> statement-breakpoint
ALTER TABLE `__new_activity_event` RENAME TO `activity_event`;
--> statement-breakpoint
CREATE INDEX `idx_activity_event_series` ON `activity_event` (`series_id`);
--> statement-breakpoint
CREATE INDEX `idx_activity_event_chapter` ON `activity_event` (`chapter_id`);
--> statement-breakpoint

-- 11. anilist_sync: series_id → CASCADE
CREATE TABLE `__new_anilist_sync` (
    `series_id` text PRIMARY KEY NOT NULL REFERENCES `series`(`id`) ON DELETE CASCADE,
    `anilist_id` integer NOT NULL,
    `media_list_entry_id` integer,
    `last_synced_at` integer,
    `sync_state` text NOT NULL DEFAULT 'idle',
    `last_direction` text,
    `last_error` text,
    `remote_status` text,
    `remote_progress` integer DEFAULT 0,
    `remote_updated_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_anilist_sync` SELECT * FROM `anilist_sync`;
--> statement-breakpoint
DROP TABLE `anilist_sync`;
--> statement-breakpoint
ALTER TABLE `__new_anilist_sync` RENAME TO `anilist_sync`;
--> statement-breakpoint

-- 12. sync_log: series_id → SET NULL
CREATE TABLE `__new_sync_log` (
    `id` text PRIMARY KEY NOT NULL,
    `series_id` text REFERENCES `series`(`id`) ON DELETE SET NULL,
    `direction` text NOT NULL,
    `status` text NOT NULL,
    `details` text NOT NULL,
    `created_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_sync_log` SELECT * FROM `sync_log`;
--> statement-breakpoint
DROP TABLE `sync_log`;
--> statement-breakpoint
ALTER TABLE `__new_sync_log` RENAME TO `sync_log`;
--> statement-breakpoint
CREATE INDEX `idx_sync_log_series` ON `sync_log` (`series_id`);
--> statement-breakpoint

-- 13. media_cache: chapter_id → CASCADE
CREATE TABLE `__new_media_cache` (
    `chapter_id` text PRIMARY KEY NOT NULL REFERENCES `chapter`(`id`) ON DELETE CASCADE,
    `state` text NOT NULL,
    `bytes` integer DEFAULT 0,
    `cached_at` integer,
    `path` text
);
--> statement-breakpoint
INSERT INTO `__new_media_cache` SELECT * FROM `media_cache`;
--> statement-breakpoint
DROP TABLE `media_cache`;
--> statement-breakpoint
ALTER TABLE `__new_media_cache` RENAME TO `media_cache`;
--> statement-breakpoint

-- 14. series_download_policy: series_id → CASCADE
CREATE TABLE `__new_series_download_policy` (
    `series_id` text PRIMARY KEY NOT NULL REFERENCES `series`(`id`) ON DELETE CASCADE,
    `source_series_id` text NOT NULL,
    `auto_download_new_enabled` integer NOT NULL DEFAULT false,
    `auto_download_new_limit` integer NOT NULL DEFAULT 3,
    `updated_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_series_download_policy` SELECT * FROM `series_download_policy`;
--> statement-breakpoint
DROP TABLE `series_download_policy`;
--> statement-breakpoint
ALTER TABLE `__new_series_download_policy` RENAME TO `series_download_policy`;
--> statement-breakpoint

-- 15. background_task: run_id → CASCADE
CREATE TABLE `__new_background_task` (
    `id` text PRIMARY KEY NOT NULL,
    `run_id` text NOT NULL REFERENCES `background_run`(`id`) ON DELETE CASCADE,
    `queue` text NOT NULL,
    `task_type` text NOT NULL,
    `source_series_id` text,
    `source_chapter_id` text,
    `payload_json` text,
    `priority` integer NOT NULL DEFAULT 0,
    `state` text NOT NULL DEFAULT 'queued',
    `attempt` integer NOT NULL DEFAULT 0,
    `max_attempts` integer NOT NULL DEFAULT 3,
    `next_attempt_at` integer,
    `lease_owner` text,
    `lease_expires_at` integer,
    `started_at` integer,
    `finished_at` integer,
    `last_error` text,
    `dedupe_key` text,
    `created_at` integer,
    `updated_at` integer
);
--> statement-breakpoint
INSERT INTO `__new_background_task` SELECT * FROM `background_task`;
--> statement-breakpoint
DROP TABLE `background_task`;
--> statement-breakpoint
ALTER TABLE `__new_background_task` RENAME TO `background_task`;
--> statement-breakpoint
CREATE INDEX `idx_bg_task_queue_state_due` ON `background_task` (`queue`, `state`, `next_attempt_at`, `priority`, `created_at`);
--> statement-breakpoint
CREATE INDEX `idx_bg_task_series_state` ON `background_task` (`source_series_id`, `state`);
--> statement-breakpoint
CREATE INDEX `idx_bg_task_run_state` ON `background_task` (`run_id`, `state`);
--> statement-breakpoint
CREATE INDEX `idx_bg_task_run_priority` ON `background_task` (`run_id`, `priority`, `created_at`);
--> statement-breakpoint
CREATE INDEX `idx_bg_task_dedupe` ON `background_task` (`dedupe_key`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_bg_task_active_dedupe` ON `background_task` (`dedupe_key`) WHERE `dedupe_key` is not null and `state` in ('queued', 'retry_wait', 'running');
--> statement-breakpoint

PRAGMA foreign_keys=ON;
