CREATE TABLE `deepweb_supervised_epochs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`teacher_sample_count` integer NOT NULL,
	`matched_teacher_count` integer NOT NULL,
	`corrected_prediction_count` integer NOT NULL,
	`false_positive_guard_count` integer NOT NULL,
	`loss_before` real NOT NULL,
	`loss_after` real NOT NULL,
	`improvement` real NOT NULL,
	`trust_score` real NOT NULL,
	`calibration_weights` text NOT NULL,
	`status` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deepweb_supervised_epochs_run_idx` ON `deepweb_supervised_epochs` (`run_id`);--> statement-breakpoint
CREATE INDEX `deepweb_supervised_epochs_status_idx` ON `deepweb_supervised_epochs` (`status`);--> statement-breakpoint
CREATE INDEX `deepweb_supervised_epochs_trust_idx` ON `deepweb_supervised_epochs` (`trust_score`);--> statement-breakpoint
CREATE TABLE `deepweb_supervision_labels` (
	`id` text PRIMARY KEY NOT NULL,
	`source_kind` text NOT NULL,
	`source_id` text NOT NULL,
	`target_vector_id` text,
	`target_pattern` text NOT NULL,
	`label` text NOT NULL,
	`confidence` real NOT NULL,
	`trust_score` real NOT NULL,
	`evidence` text NOT NULL,
	`corrective_action` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_supervision_labels_source_idx` ON `deepweb_supervision_labels` (`source_kind`,`source_id`);--> statement-breakpoint
CREATE INDEX `deepweb_supervision_labels_target_idx` ON `deepweb_supervision_labels` (`target_vector_id`);--> statement-breakpoint
CREATE INDEX `deepweb_supervision_labels_label_idx` ON `deepweb_supervision_labels` (`label`);--> statement-breakpoint
CREATE INDEX `deepweb_supervision_labels_trust_idx` ON `deepweb_supervision_labels` (`trust_score`);