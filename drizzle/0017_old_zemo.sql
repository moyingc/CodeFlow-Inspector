CREATE TABLE `deepweb_local_storage_engines` (
	`id` text PRIMARY KEY NOT NULL,
	`engine_kind` text NOT NULL,
	`storage_mode` text NOT NULL,
	`status` text NOT NULL,
	`row_count` integer NOT NULL,
	`last_synced_at` integer NOT NULL,
	`evidence` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_local_storage_engines_kind_idx` ON `deepweb_local_storage_engines` (`engine_kind`);--> statement-breakpoint
CREATE INDEX `deepweb_local_storage_engines_status_idx` ON `deepweb_local_storage_engines` (`status`);