CREATE TABLE `runtime_execution_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`project_name` text NOT NULL,
	`adapter` text NOT NULL,
	`status` text NOT NULL,
	`evidence_grade` text NOT NULL,
	`entry_path` text NOT NULL,
	`command_label` text NOT NULL,
	`exit_code` integer,
	`timed_out` integer NOT NULL,
	`duration_ms` integer NOT NULL,
	`stdout` text NOT NULL,
	`stderr` text NOT NULL,
	`stdout_truncated` integer NOT NULL,
	`stderr_truncated` integer NOT NULL,
	`compile_output` text NOT NULL,
	`file_count` integer NOT NULL,
	`total_bytes` integer NOT NULL,
	`isolation` text NOT NULL,
	`evidence` text NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `runtime_execution_runs_project_idx` ON `runtime_execution_runs` (`project_id`);--> statement-breakpoint
CREATE INDEX `runtime_execution_runs_status_idx` ON `runtime_execution_runs` (`status`);--> statement-breakpoint
CREATE INDEX `runtime_execution_runs_started_idx` ON `runtime_execution_runs` (`started_at`);