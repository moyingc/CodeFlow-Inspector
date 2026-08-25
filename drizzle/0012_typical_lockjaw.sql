CREATE TABLE `deepweb_validation_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`scenario_id` text NOT NULL,
	`dimension_key` text NOT NULL,
	`evidence_kind` text NOT NULL,
	`source_table` text NOT NULL,
	`source_id` text NOT NULL,
	`source_name` text NOT NULL,
	`dimensions` text NOT NULL,
	`confidence` real NOT NULL,
	`passed` integer NOT NULL,
	`replay` integer NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_validation_evidence_scenario_idx` ON `deepweb_validation_evidence` (`scenario_id`);--> statement-breakpoint
CREATE INDEX `deepweb_validation_evidence_dimension_idx` ON `deepweb_validation_evidence` (`dimension_key`);--> statement-breakpoint
CREATE INDEX `deepweb_validation_evidence_kind_idx` ON `deepweb_validation_evidence` (`evidence_kind`);--> statement-breakpoint
CREATE INDEX `deepweb_validation_evidence_source_idx` ON `deepweb_validation_evidence` (`source_table`,`source_id`);