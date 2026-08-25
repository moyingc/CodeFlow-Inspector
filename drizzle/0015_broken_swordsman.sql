CREATE TABLE `deepweb_replay_comparisons` (
	`id` text PRIMARY KEY NOT NULL,
	`current_snapshot_id` text NOT NULL,
	`baseline_snapshot_id` text,
	`status` text NOT NULL,
	`drift_score` real NOT NULL,
	`regression_score` real NOT NULL,
	`improvement_score` real NOT NULL,
	`changed_dimensions` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`current_snapshot_id`) REFERENCES `deepweb_replay_memory_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`baseline_snapshot_id`) REFERENCES `deepweb_replay_memory_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deepweb_replay_comparisons_current_idx` ON `deepweb_replay_comparisons` (`current_snapshot_id`);--> statement-breakpoint
CREATE INDEX `deepweb_replay_comparisons_baseline_idx` ON `deepweb_replay_comparisons` (`baseline_snapshot_id`);--> statement-breakpoint
CREATE INDEX `deepweb_replay_comparisons_status_idx` ON `deepweb_replay_comparisons` (`status`);--> statement-breakpoint
CREATE TABLE `deepweb_replay_memory_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`irrigation_run_id` text,
	`project_name` text NOT NULL,
	`project_hash` text NOT NULL,
	`file_count` integer NOT NULL,
	`function_count` integer NOT NULL,
	`issue_count` integer NOT NULL,
	`deepweb_coverage` real NOT NULL,
	`irrigation_score` real NOT NULL,
	`optimization_score` real NOT NULL,
	`accepted_evidence_count` integer NOT NULL,
	`isolated_evidence_count` integer NOT NULL,
	`vector_count` integer NOT NULL,
	`inference_run_count` integer NOT NULL,
	`teacher_trust_score` real NOT NULL,
	`teacher_consensus_rate` real NOT NULL,
	`maturity_score` real NOT NULL,
	`stable_snapshot` text NOT NULL,
	`status` text NOT NULL,
	`dimension_scores` text NOT NULL,
	`label_breakdown` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`irrigation_run_id`) REFERENCES `deepweb_irrigation_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deepweb_replay_memory_snapshots_project_idx` ON `deepweb_replay_memory_snapshots` (`project_hash`);--> statement-breakpoint
CREATE INDEX `deepweb_replay_memory_snapshots_status_idx` ON `deepweb_replay_memory_snapshots` (`status`);--> statement-breakpoint
CREATE INDEX `deepweb_replay_memory_snapshots_created_idx` ON `deepweb_replay_memory_snapshots` (`created_at`);--> statement-breakpoint
CREATE TABLE `deepweb_replay_promotion_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`snapshot_id` text NOT NULL,
	`target_kind` text NOT NULL,
	`target_id` text NOT NULL,
	`gate` text NOT NULL,
	`score` real NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`snapshot_id`) REFERENCES `deepweb_replay_memory_snapshots`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deepweb_replay_promotion_decisions_snapshot_idx` ON `deepweb_replay_promotion_decisions` (`snapshot_id`);--> statement-breakpoint
CREATE INDEX `deepweb_replay_promotion_decisions_target_idx` ON `deepweb_replay_promotion_decisions` (`target_kind`,`target_id`);--> statement-breakpoint
CREATE INDEX `deepweb_replay_promotion_decisions_gate_idx` ON `deepweb_replay_promotion_decisions` (`gate`);