-- Remove collection-scoped update schedules (target_type no longer supported)
DELETE FROM `update_schedule` WHERE `target_type` = 'collection';
--> statement-breakpoint

-- Drop collection tables
DROP TABLE IF EXISTS `collection_series`;
--> statement-breakpoint
DROP TABLE IF EXISTS `collection`;
