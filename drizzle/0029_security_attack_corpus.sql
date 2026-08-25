CREATE TABLE IF NOT EXISTS `security_attack_corpora` (
  `id` text PRIMARY KEY NOT NULL,
  `version` text NOT NULL,
  `checksum` text NOT NULL,
  `case_count` integer NOT NULL,
  `provenance` text NOT NULL,
  `status` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `security_assertion_runs` (
  `id` text PRIMARY KEY NOT NULL,
  `corpus_id` text NOT NULL,
  `project_id` text NOT NULL,
  `sample_id` text NOT NULL,
  `status` text NOT NULL,
  `runtime_run_id` text NOT NULL,
  `evidence` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`corpus_id`) REFERENCES `security_attack_corpora`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `security_assertion_runs_project_idx` ON `security_assertion_runs` (`project_id`);
--> statement-breakpoint
CREATE INDEX `security_assertion_runs_status_idx` ON `security_assertion_runs` (`status`);
