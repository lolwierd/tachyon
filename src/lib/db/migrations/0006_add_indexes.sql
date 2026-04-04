CREATE INDEX IF NOT EXISTS `idx_chapter_series` ON `chapter` (`series_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_chapter_series_source_srcid` ON `chapter` (`series_id`,`source`,`source_chapter_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_source_mapping_series` ON `source_mapping` (`series_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_chapter_progress_series` ON `chapter_progress` (`series_id`,`completed`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_activity_event_series` ON `activity_event` (`series_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_activity_event_chapter` ON `activity_event` (`chapter_id`);
