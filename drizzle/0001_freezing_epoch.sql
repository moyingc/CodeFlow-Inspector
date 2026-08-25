CREATE TABLE `rule_matches` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`function_id` text NOT NULL,
	`function_name` text NOT NULL,
	`file_name` text NOT NULL,
	`line` integer NOT NULL,
	`category` text NOT NULL,
	`severity` text NOT NULL,
	`confidence` real NOT NULL,
	`matched_signals` text NOT NULL,
	`evidence` text NOT NULL,
	`recommendation` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `knowledge_rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rule_matches_rule_idx` ON `rule_matches` (`rule_id`);--> statement-breakpoint
CREATE INDEX `rule_matches_function_idx` ON `rule_matches` (`function_id`);--> statement-breakpoint
CREATE INDEX `rule_matches_severity_idx` ON `rule_matches` (`severity`);