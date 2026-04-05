CREATE UNIQUE INDEX IF NOT EXISTS `uq_chapter_identity` ON `chapter` (`series_id`,`source`,`source_chapter_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `uq_bg_task_active_dedupe`
  ON `background_task` (`dedupe_key`)
  WHERE `dedupe_key` IS NOT NULL AND `state` IN ('queued', 'retry_wait', 'running');
