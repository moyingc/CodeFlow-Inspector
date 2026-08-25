CREATE TABLE `deepweb_local_snapshot_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`engine_id` text NOT NULL,
	`export_kind` text NOT NULL,
	`row_count` integer NOT NULL,
	`table_count` integer NOT NULL,
	`payload_bytes` integer NOT NULL,
	`status` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_local_snapshot_exports_engine_idx` ON `deepweb_local_snapshot_exports` (`engine_id`);--> statement-breakpoint
CREATE INDEX `deepweb_local_snapshot_exports_status_idx` ON `deepweb_local_snapshot_exports` (`status`);--> statement-breakpoint
CREATE INDEX `deepweb_local_snapshot_exports_created_idx` ON `deepweb_local_snapshot_exports` (`created_at`);