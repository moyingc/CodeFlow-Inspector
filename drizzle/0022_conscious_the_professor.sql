CREATE TABLE `deepweb_model_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`parent_version_id` text,
	`feature_schema_version` text NOT NULL,
	`model_mode` text NOT NULL,
	`status` text NOT NULL,
	`weights` text NOT NULL,
	`selected_genome_id` text NOT NULL,
	`training_sample_count` integer NOT NULL,
	`validation_evidence_count` integer NOT NULL,
	`trust_score` real NOT NULL,
	`consensus_rate` real NOT NULL,
	`fitness_score` real NOT NULL,
	`regression_risk_score` real NOT NULL,
	`checksum` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_model_versions_run_idx` ON `deepweb_model_versions` (`run_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `deepweb_model_versions_status_idx` ON `deepweb_model_versions` (`status`,`fitness_score`);--> statement-breakpoint
CREATE TABLE `deepweb_supervised_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`vector_id` text NOT NULL,
	`vector_name` text NOT NULL,
	`predicted_label` text NOT NULL,
	`teacher_label` text NOT NULL,
	`trust_score` real NOT NULL,
	`consensus_score` real NOT NULL,
	`corrected` integer NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_supervised_assignments_run_idx` ON `deepweb_supervised_assignments` (`run_id`,`corrected`);--> statement-breakpoint
CREATE INDEX `deepweb_supervised_assignments_vector_idx` ON `deepweb_supervised_assignments` (`vector_id`);--> statement-breakpoint
ALTER TABLE `runtime_execution_runs` ADD `sandbox_kind` text NOT NULL DEFAULT 'process_boundary';--> statement-breakpoint
ALTER TABLE `runtime_execution_runs` ADD `sandbox_status` text NOT NULL DEFAULT 'unavailable';--> statement-breakpoint
ALTER TABLE `runtime_execution_runs` ADD `sandbox_evidence` text NOT NULL DEFAULT '';--> statement-breakpoint
ALTER TABLE `runtime_execution_runs` ADD `cpu_time_ms` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `runtime_execution_runs` ADD `peak_memory_bytes` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `runtime_execution_runs` ADD `child_process_count` integer NOT NULL DEFAULT 0;--> statement-breakpoint
ALTER TABLE `runtime_execution_runs` ADD `child_processes` text NOT NULL DEFAULT '[]';--> statement-breakpoint
ALTER TABLE `runtime_execution_runs` ADD `file_changes` text NOT NULL DEFAULT '[]';
