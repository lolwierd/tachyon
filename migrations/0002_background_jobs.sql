CREATE TABLE `background_run` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`trigger` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`scope_json` text,
	`total_tasks` integer DEFAULT 0 NOT NULL,
	`done_tasks` integer DEFAULT 0 NOT NULL,
	`failed_tasks` integer DEFAULT 0 NOT NULL,
	`canceled_tasks` integer DEFAULT 0 NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`cancel_requested_at` integer,
	`last_error` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `background_task` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`queue` text NOT NULL,
	`task_type` text NOT NULL,
	`source_series_id` text,
	`source_chapter_id` text,
	`payload_json` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'queued' NOT NULL,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer DEFAULT 3 NOT NULL,
	`next_attempt_at` integer,
	`lease_owner` text,
	`lease_expires_at` integer,
	`started_at` integer,
	`finished_at` integer,
	`last_error` text,
	`dedupe_key` text,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `background_run`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_bg_task_queue_state_due` ON `background_task` (`queue`,`state`,`next_attempt_at`,`priority`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_bg_task_series_state` ON `background_task` (`source_series_id`,`state`);
--> statement-breakpoint
CREATE INDEX `idx_bg_task_run_state` ON `background_task` (`run_id`,`state`);
--> statement-breakpoint
CREATE INDEX `idx_bg_task_run_priority` ON `background_task` (`run_id`,`priority`,`created_at`);
--> statement-breakpoint
CREATE INDEX `idx_bg_task_dedupe` ON `background_task` (`dedupe_key`);
--> statement-breakpoint
CREATE TABLE `update_schedule` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`target_type` text NOT NULL,
	`target_value_json` text,
	`interval_minutes` integer NOT NULL,
	`jitter_seconds` integer DEFAULT 0 NOT NULL,
	`next_run_at` integer,
	`last_run_id` text,
	`last_run_at` integer,
	`overlap_policy` text DEFAULT 'cancel_old_start_new' NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_update_schedule_due` ON `update_schedule` (`enabled`,`next_run_at`);
--> statement-breakpoint
CREATE TABLE `series_download_policy` (
	`series_id` text PRIMARY KEY NOT NULL,
	`source_series_id` text NOT NULL,
	`auto_download_new_enabled` integer DEFAULT false NOT NULL,
	`auto_download_new_limit` integer DEFAULT 3 NOT NULL,
	`updated_at` integer,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `app_setting` (
	`key` text PRIMARY KEY NOT NULL,
	`value_json` text NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `worker_heartbeat` (
	`worker_id` text PRIMARY KEY NOT NULL,
	`version` text,
	`last_seen_at` integer NOT NULL
);
