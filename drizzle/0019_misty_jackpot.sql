CREATE TABLE `workspace_projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source` text NOT NULL,
	`root_hint` text NOT NULL,
	`file_count` integer NOT NULL,
	`language_summary` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workspace_projects_source_idx` ON `workspace_projects` (`source`);--> statement-breakpoint
CREATE INDEX `workspace_projects_updated_idx` ON `workspace_projects` (`updated_at`);--> statement-breakpoint
CREATE TABLE `workspace_project_files` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`path` text NOT NULL,
	`language` text NOT NULL,
	`content` text NOT NULL,
	`hash` text NOT NULL,
	`size` integer NOT NULL,
	`last_modified` integer,
	`imports` text NOT NULL,
	`environment_refs` text NOT NULL,
	`device_refs` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `workspace_projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workspace_project_files_project_idx` ON `workspace_project_files` (`project_id`);--> statement-breakpoint
CREATE INDEX `workspace_project_files_path_idx` ON `workspace_project_files` (`path`);--> statement-breakpoint
CREATE INDEX `workspace_project_files_language_idx` ON `workspace_project_files` (`language`);--> statement-breakpoint
CREATE TABLE `workspace_project_state` (
	`id` text PRIMARY KEY NOT NULL,
	`active_project_id` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`active_project_id`) REFERENCES `workspace_projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workspace_project_events` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`event_kind` text NOT NULL,
	`active_project_id` text,
	`project_count` integer NOT NULL,
	`file_count` integer NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `workspace_projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `workspace_project_events_project_idx` ON `workspace_project_events` (`project_id`);--> statement-breakpoint
CREATE INDEX `workspace_project_events_kind_idx` ON `workspace_project_events` (`event_kind`);--> statement-breakpoint
CREATE INDEX `workspace_project_events_created_idx` ON `workspace_project_events` (`created_at`);--> statement-breakpoint
CREATE TABLE `workspace_project_storage_engines` (
	`id` text PRIMARY KEY NOT NULL,
	`engine_kind` text NOT NULL,
	`storage_mode` text NOT NULL,
	`status` text NOT NULL,
	`project_count` integer NOT NULL,
	`file_count` integer NOT NULL,
	`table_count` integer NOT NULL,
	`last_synced_at` integer NOT NULL,
	`evidence` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `workspace_project_storage_engines_kind_idx` ON `workspace_project_storage_engines` (`engine_kind`);--> statement-breakpoint
CREATE INDEX `workspace_project_storage_engines_status_idx` ON `workspace_project_storage_engines` (`status`);
