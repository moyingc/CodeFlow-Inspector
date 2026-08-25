CREATE TABLE `deepweb_validation_scenarios` (
	`id` text PRIMARY KEY NOT NULL,
	`dimension_key` text NOT NULL,
	`validation_kind` text NOT NULL,
	`source_table` text NOT NULL,
	`required_evidence` text NOT NULL,
	`pass_criteria` text NOT NULL,
	`maturity_weight` real NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_validation_scenarios_dimension_idx` ON `deepweb_validation_scenarios` (`dimension_key`);--> statement-breakpoint
CREATE INDEX `deepweb_validation_scenarios_kind_idx` ON `deepweb_validation_scenarios` (`validation_kind`);--> statement-breakpoint
CREATE INDEX `deepweb_validation_scenarios_source_idx` ON `deepweb_validation_scenarios` (`source_table`);