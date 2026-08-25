CREATE TABLE `deepweb_feature_vectors` (
	`id` text PRIMARY KEY NOT NULL,
	`projection_id` text,
	`source_table` text NOT NULL,
	`source_id` text NOT NULL,
	`dimensions` text NOT NULL,
	`vector` text NOT NULL,
	`magnitude` real NOT NULL,
	`confidence` real NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`projection_id`) REFERENCES `deepweb_projections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deepweb_feature_vectors_projection_idx` ON `deepweb_feature_vectors` (`projection_id`);--> statement-breakpoint
CREATE INDEX `deepweb_feature_vectors_source_idx` ON `deepweb_feature_vectors` (`source_table`,`source_id`);--> statement-breakpoint
CREATE INDEX `deepweb_feature_vectors_confidence_idx` ON `deepweb_feature_vectors` (`confidence`);