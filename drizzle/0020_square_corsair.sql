CREATE TABLE `digital_twin_experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`experiment_kind` text NOT NULL,
	`name` text NOT NULL,
	`objective` text NOT NULL,
	`evidence_grade` text NOT NULL,
	`status` text NOT NULL,
	`confidence` real NOT NULL,
	`affected_node_ids` text NOT NULL,
	`input_model` text NOT NULL,
	`expected_behavior` text NOT NULL,
	`observed_or_estimated` text NOT NULL,
	`metrics` text NOT NULL,
	`evidence` text NOT NULL,
	`next_action` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `digital_twin_experiments_run_idx` ON `digital_twin_experiments` (`run_id`);--> statement-breakpoint
CREATE INDEX `digital_twin_experiments_kind_idx` ON `digital_twin_experiments` (`experiment_kind`);--> statement-breakpoint
CREATE INDEX `digital_twin_experiments_status_idx` ON `digital_twin_experiments` (`status`);--> statement-breakpoint
CREATE TABLE `digital_twin_variants` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`name` text NOT NULL,
	`target` text NOT NULL,
	`change_summary` text NOT NULL,
	`evidence_grade` text NOT NULL,
	`performance_gain` real NOT NULL,
	`stability_delta` real NOT NULL,
	`security_delta` real NOT NULL,
	`resource_delta` real NOT NULL,
	`fit_score` real NOT NULL,
	`validation_gate` text NOT NULL,
	`recommendation` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `digital_twin_variants_run_idx` ON `digital_twin_variants` (`run_id`);--> statement-breakpoint
CREATE INDEX `digital_twin_variants_fit_idx` ON `digital_twin_variants` (`fit_score`);--> statement-breakpoint
CREATE INDEX `digital_twin_variants_recommendation_idx` ON `digital_twin_variants` (`recommendation`);