CREATE TABLE `deepweb_quarantined_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`vector_id` text NOT NULL,
	`vector_name` text NOT NULL,
	`source_kind` text NOT NULL,
	`candidate_labels` text NOT NULL,
	`reason` text NOT NULL,
	`confidence` real NOT NULL,
	`evidence` text NOT NULL,
	`recommended_action` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_quarantined_labels_vector_idx` ON `deepweb_quarantined_labels` (`vector_id`);--> statement-breakpoint
CREATE INDEX `deepweb_quarantined_labels_source_idx` ON `deepweb_quarantined_labels` (`source_kind`);--> statement-breakpoint
CREATE INDEX `deepweb_quarantined_labels_reason_idx` ON `deepweb_quarantined_labels` (`reason`);--> statement-breakpoint
CREATE TABLE `deepweb_rollback_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`protected_tables` text NOT NULL,
	`trigger` text NOT NULL,
	`rollback_policy` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deepweb_rollback_snapshots_run_idx` ON `deepweb_rollback_snapshots` (`run_id`);--> statement-breakpoint
CREATE INDEX `deepweb_rollback_snapshots_trigger_idx` ON `deepweb_rollback_snapshots` (`trigger`);--> statement-breakpoint
CREATE TABLE `deepweb_teacher_reliability` (
	`id` text PRIMARY KEY NOT NULL,
	`source_kind` text NOT NULL,
	`label_count` integer NOT NULL,
	`accepted_count` integer NOT NULL,
	`quarantined_count` integer NOT NULL,
	`conflict_count` integer NOT NULL,
	`reliability_score` real NOT NULL,
	`status` text NOT NULL,
	`evidence` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_teacher_reliability_source_idx` ON `deepweb_teacher_reliability` (`source_kind`);--> statement-breakpoint
CREATE INDEX `deepweb_teacher_reliability_status_idx` ON `deepweb_teacher_reliability` (`status`);--> statement-breakpoint
CREATE INDEX `deepweb_teacher_reliability_score_idx` ON `deepweb_teacher_reliability` (`reliability_score`);