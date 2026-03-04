CREATE TABLE `activity_event` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`series_id` text,
	`chapter_id` text,
	`payload` text,
	`created_at` integer,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapter`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `bookmark` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`chapter_id` text NOT NULL,
	`page_index` integer NOT NULL,
	`label` text,
	`created_at` integer,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapter`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `chapter` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`source` text NOT NULL,
	`source_chapter_id` text NOT NULL,
	`chapter_no` real NOT NULL,
	`volume_no` real,
	`title` text,
	`page_count` integer DEFAULT 0,
	`published_at` integer,
	`sort_key` real NOT NULL,
	`created_at` integer,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `chapter_progress` (
	`chapter_id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`last_page` integer DEFAULT 0,
	`completed` integer DEFAULT false,
	`started_at` integer,
	`completed_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapter`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `collection` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`icon` text,
	`sort_order` integer DEFAULT 0,
	`created_at` integer
);
--> statement-breakpoint
CREATE TABLE `collection_series` (
	`collection_id` text NOT NULL,
	`series_id` text NOT NULL,
	`sort_order` integer DEFAULT 0,
	PRIMARY KEY(`collection_id`, `series_id`),
	FOREIGN KEY (`collection_id`) REFERENCES `collection`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `library_entry` (
	`series_id` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`added_at` integer,
	`updated_at` integer,
	`rating` integer,
	`favorite` integer DEFAULT false,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `media_cache` (
	`chapter_id` text PRIMARY KEY NOT NULL,
	`state` text NOT NULL,
	`bytes` integer DEFAULT 0,
	`cached_at` integer,
	`path` text,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapter`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `note` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`chapter_id` text,
	`page_index` integer,
	`body` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapter`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `reading_progress` (
	`series_id` text PRIMARY KEY NOT NULL,
	`current_chapter_id` text,
	`current_page` integer DEFAULT 0,
	`updated_at` integer,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_chapter_id`) REFERENCES `chapter`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `series` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`alt_titles` text,
	`description` text,
	`cover_url` text,
	`status` text,
	`content_type` text,
	`year` integer,
	`adult` integer,
	`created_at` integer,
	`updated_at` integer
);
--> statement-breakpoint
CREATE TABLE `series_preferences` (
	`series_id` text PRIMARY KEY NOT NULL,
	`reading_direction` text DEFAULT 'vertical',
	`fit_mode` text DEFAULT 'width',
	`updated_at` integer,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `series_tag` (
	`series_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`series_id`, `tag_id`),
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`tag_id`) REFERENCES `tag`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `source_mapping` (
	`id` text PRIMARY KEY NOT NULL,
	`series_id` text NOT NULL,
	`source` text NOT NULL,
	`source_series_id` text NOT NULL,
	`source_url` text,
	FOREIGN KEY (`series_id`) REFERENCES `series`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_source_series` ON `source_mapping` (`source`,`source_series_id`);--> statement-breakpoint
CREATE TABLE `tag` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`color` text,
	`type` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tag_name_unique` ON `tag` (`name`);