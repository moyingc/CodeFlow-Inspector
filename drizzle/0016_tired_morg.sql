CREATE TABLE `deepweb_local_sqlite_journal` (
	`id` text PRIMARY KEY NOT NULL,
	`target_table` text NOT NULL,
	`target_primary_key` text NOT NULL,
	`project_hash` text NOT NULL,
	`payload` text NOT NULL,
	`sql_text` text NOT NULL,
	`sync_status` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_local_sqlite_journal_table_idx` ON `deepweb_local_sqlite_journal` (`target_table`);--> statement-breakpoint
CREATE INDEX `deepweb_local_sqlite_journal_target_idx` ON `deepweb_local_sqlite_journal` (`target_table`,`target_primary_key`);--> statement-breakpoint
CREATE INDEX `deepweb_local_sqlite_journal_status_idx` ON `deepweb_local_sqlite_journal` (`sync_status`);