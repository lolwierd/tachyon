ALTER TABLE `series` ADD `anilist_id` integer;
--> statement-breakpoint
CREATE TABLE `anilist_account` (
	`id` text PRIMARY KEY NOT NULL,
	`access_token` text NOT NULL,
	`token_type` text DEFAULT 'Bearer' NOT NULL,
	`expires_at` integer,
	`viewer_id` integer,
	`viewer_name` text,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `anilist_sync` (
	`series_id` text PRIMARY KEY NOT NULL,
	`anilist_id` integer NOT NULL,
	`media_list_entry_id` integer,
	`last_synced_at` integer,
	`sync_state` text DEFAULT 'idle' NOT NULL,
	`last_direction` text,
	`last_error` text,
	`remote_status` text,
	`remote_progress` integer DEFAULT 0,
	`remote_updated_at` integer,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `sync_log` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text,
	`direction` text NOT NULL,
	`status` text NOT NULL,
	`details` text NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
