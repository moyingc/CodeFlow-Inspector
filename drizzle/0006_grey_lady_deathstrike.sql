CREATE TABLE `deepweb_contrastive_pairs` (
	`id` text PRIMARY KEY NOT NULL,
	`anchor_vector_id` text NOT NULL,
	`positive_vector_id` text NOT NULL,
	`negative_vector_id` text NOT NULL,
	`label` text NOT NULL,
	`margin` real NOT NULL,
	`confidence` real NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_contrastive_pairs_label_idx` ON `deepweb_contrastive_pairs` (`label`);--> statement-breakpoint
CREATE INDEX `deepweb_contrastive_pairs_anchor_idx` ON `deepweb_contrastive_pairs` (`anchor_vector_id`);--> statement-breakpoint
CREATE TABLE `deepweb_label_centroids` (
	`id` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`sample_count` integer NOT NULL,
	`vector` text NOT NULL,
	`dominant_dimensions` text NOT NULL,
	`confidence` real NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_label_centroids_label_idx` ON `deepweb_label_centroids` (`label`);--> statement-breakpoint
CREATE INDEX `deepweb_label_centroids_confidence_idx` ON `deepweb_label_centroids` (`confidence`);--> statement-breakpoint
CREATE TABLE `deepweb_self_supervised_epochs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text,
	`epoch_index` integer NOT NULL,
	`vector_count` integer NOT NULL,
	`pseudo_label_count` integer NOT NULL,
	`contrastive_pair_count` integer NOT NULL,
	`loss_before` real NOT NULL,
	`loss_after` real NOT NULL,
	`learning_rate` real NOT NULL,
	`updated_weights` text NOT NULL,
	`status` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deepweb_self_supervised_epochs_run_idx` ON `deepweb_self_supervised_epochs` (`run_id`);--> statement-breakpoint
CREATE INDEX `deepweb_self_supervised_epochs_status_idx` ON `deepweb_self_supervised_epochs` (`status`);