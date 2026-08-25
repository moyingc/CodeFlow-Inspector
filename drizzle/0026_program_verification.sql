CREATE TABLE `program_verification_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`status` text NOT NULL,
	`score` real NOT NULL,
	`soundness_cap` real NOT NULL,
	`obligation_count` integer NOT NULL,
	`proved_count` integer NOT NULL,
	`observed_count` integer NOT NULL,
	`violated_count` integer NOT NULL,
	`unproved_count` integer NOT NULL,
	`blocked_count` integer NOT NULL,
	`runtime_evidence_count` integer NOT NULL,
	`benchmark_evidence_count` integer NOT NULL,
	`formal_evidence_count` integer NOT NULL,
	`gaps` text NOT NULL,
	`next_steps` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `program_verification_runs_run_idx` ON `program_verification_runs` (`run_id`);
--> statement-breakpoint
CREATE INDEX `program_verification_runs_status_idx` ON `program_verification_runs` (`status`);
--> statement-breakpoint
CREATE TABLE `verification_obligations` (
	`id` text PRIMARY KEY NOT NULL,
	`verification_run_id` text NOT NULL,
	`run_id` text NOT NULL,
	`source_ids` text NOT NULL,
	`domain` text NOT NULL,
	`title` text NOT NULL,
	`requirement` text NOT NULL,
	`status` text NOT NULL,
	`evidence_grade` text NOT NULL,
	`confidence` real NOT NULL,
	`evidence` text NOT NULL,
	`missing_evidence` text NOT NULL,
	`suggested_action` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`verification_run_id`) REFERENCES `program_verification_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `verification_obligations_run_idx` ON `verification_obligations` (`verification_run_id`);
--> statement-breakpoint
CREATE INDEX `verification_obligations_status_idx` ON `verification_obligations` (`status`);
--> statement-breakpoint
CREATE TABLE `verified_repair_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`verification_run_id` text NOT NULL,
	`run_id` text NOT NULL,
	`variant_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`safe_to_write_back` integer NOT NULL,
	`summary` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`verification_run_id`) REFERENCES `program_verification_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `verified_repair_candidates_run_idx` ON `verified_repair_candidates` (`verification_run_id`);
--> statement-breakpoint
CREATE INDEX `verified_repair_candidates_status_idx` ON `verified_repair_candidates` (`status`);
--> statement-breakpoint
CREATE TABLE `repair_verification_gates` (
	`id` text PRIMARY KEY NOT NULL,
	`candidate_id` text NOT NULL,
	`gate_kind` text NOT NULL,
	`status` text NOT NULL,
	`evidence` text NOT NULL,
	`required_action` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`candidate_id`) REFERENCES `verified_repair_candidates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `repair_verification_gates_candidate_idx` ON `repair_verification_gates` (`candidate_id`);
--> statement-breakpoint
CREATE INDEX `repair_verification_gates_status_idx` ON `repair_verification_gates` (`status`);
--> statement-breakpoint
CREATE TABLE `formal_verification_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`obligation_id` text NOT NULL,
	`title` text NOT NULL,
	`status` text NOT NULL,
	`solver` text NOT NULL,
	`solver_version` text NOT NULL,
	`formula_hash` text NOT NULL,
	`formula` text NOT NULL,
	`result` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`sandbox_status` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL,
	`file_name` text,
	`function_id` text,
	`line` integer,
	`counterexample` text,
	`call_chain` text DEFAULT '[]' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `formal_verification_runs_project_idx` ON `formal_verification_runs` (`project_id`);
--> statement-breakpoint
CREATE INDEX `formal_verification_runs_status_idx` ON `formal_verification_runs` (`status`);
