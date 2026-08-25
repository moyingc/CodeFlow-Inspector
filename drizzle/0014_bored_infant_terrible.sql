CREATE TABLE `deepweb_irrigation_epochs` (
	`id` text PRIMARY KEY NOT NULL,
	`irrigation_run_id` text,
	`stage` text NOT NULL,
	`status` text NOT NULL,
	`score` real NOT NULL,
	`evidence_count` integer NOT NULL,
	`evidence` text NOT NULL,
	`action` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`irrigation_run_id`) REFERENCES `deepweb_irrigation_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deepweb_irrigation_epochs_run_idx` ON `deepweb_irrigation_epochs` (`irrigation_run_id`);--> statement-breakpoint
CREATE INDEX `deepweb_irrigation_epochs_stage_idx` ON `deepweb_irrigation_epochs` (`stage`);--> statement-breakpoint
CREATE INDEX `deepweb_irrigation_epochs_status_idx` ON `deepweb_irrigation_epochs` (`status`);--> statement-breakpoint
CREATE TABLE `deepweb_irrigation_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`irrigation_run_id` text,
	`source_kind` text NOT NULL,
	`source_table` text NOT NULL,
	`source_id` text NOT NULL,
	`source_name` text NOT NULL,
	`target_dimensions` text NOT NULL,
	`quality_score` real NOT NULL,
	`accepted` integer NOT NULL,
	`isolated` integer NOT NULL,
	`batch_status` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`irrigation_run_id`) REFERENCES `deepweb_irrigation_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deepweb_irrigation_evidence_run_idx` ON `deepweb_irrigation_evidence` (`irrigation_run_id`);--> statement-breakpoint
CREATE INDEX `deepweb_irrigation_evidence_source_idx` ON `deepweb_irrigation_evidence` (`source_kind`,`source_table`);--> statement-breakpoint
CREATE INDEX `deepweb_irrigation_evidence_quality_idx` ON `deepweb_irrigation_evidence` (`quality_score`);--> statement-breakpoint
CREATE TABLE `deepweb_irrigation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`cycle_index` integer NOT NULL,
	`status` text NOT NULL,
	`evidence_inflow_count` integer NOT NULL,
	`accepted_evidence_count` integer NOT NULL,
	`isolated_evidence_count` integer NOT NULL,
	`data_quality_score` real NOT NULL,
	`teacher_alignment_score` real NOT NULL,
	`replay_score` real NOT NULL,
	`stability_score` real NOT NULL,
	`supervision_gain` real NOT NULL,
	`stable_snapshot` text NOT NULL,
	`evidence` text NOT NULL,
	`next` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deepweb_irrigation_runs_run_idx` ON `deepweb_irrigation_runs` (`run_id`);--> statement-breakpoint
CREATE INDEX `deepweb_irrigation_runs_status_idx` ON `deepweb_irrigation_runs` (`status`);--> statement-breakpoint
CREATE INDEX `deepweb_irrigation_runs_quality_idx` ON `deepweb_irrigation_runs` (`data_quality_score`);--> statement-breakpoint
CREATE TABLE `deepweb_weight_update_events` (
	`id` text PRIMARY KEY NOT NULL,
	`irrigation_run_id` text,
	`dimension_key` text NOT NULL,
	`before_weight` real NOT NULL,
	`candidate_weight` real NOT NULL,
	`accepted_weight` real NOT NULL,
	`delta` real NOT NULL,
	`gate` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`irrigation_run_id`) REFERENCES `deepweb_irrigation_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deepweb_weight_update_events_run_idx` ON `deepweb_weight_update_events` (`irrigation_run_id`);--> statement-breakpoint
CREATE INDEX `deepweb_weight_update_events_dimension_idx` ON `deepweb_weight_update_events` (`dimension_key`);--> statement-breakpoint
CREATE INDEX `deepweb_weight_update_events_gate_idx` ON `deepweb_weight_update_events` (`gate`);