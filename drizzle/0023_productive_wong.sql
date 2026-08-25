CREATE TABLE `deepweb_trainable_head_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`model_version_id` text NOT NULL,
	`status` text NOT NULL,
	`architecture` text NOT NULL,
	`training_sample_count` integer NOT NULL,
	`validation_sample_count` integer NOT NULL,
	`class_count` integer NOT NULL,
	`epoch_count` integer NOT NULL,
	`learning_rate` real NOT NULL,
	`train_loss_before` real NOT NULL,
	`train_loss_after` real NOT NULL,
	`validation_loss_before` real NOT NULL,
	`validation_loss_after` real NOT NULL,
	`improvement` real NOT NULL,
	`inherited` integer NOT NULL,
	`parameters` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_trainable_head_runs_run_idx` ON `deepweb_trainable_head_runs` (`run_id`,`status`,`created_at`);--> statement-breakpoint
ALTER TABLE `deepweb_model_versions` ADD `network_parameters` text;