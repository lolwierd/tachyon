-- Remove collection-scoped update schedules (target_type no longer supported)
DELETE FROM `update_schedule` WHERE `target_type` = 'collection';

-- Drop collection tables
DROP TABLE IF EXISTS `collection_series`;
DROP TABLE IF EXISTS `collection`;
