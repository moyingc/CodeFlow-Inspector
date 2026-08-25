CREATE TABLE `deepweb_feature_spaces` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`dimension_key` text NOT NULL,
	`weight` real NOT NULL,
	`signal_sources` text NOT NULL,
	`normalization` text NOT NULL,
	`target_tables` text NOT NULL,
	`purpose` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_feature_spaces_dimension_idx` ON `deepweb_feature_spaces` (`dimension_key`);--> statement-breakpoint
CREATE INDEX `deepweb_feature_spaces_weight_idx` ON `deepweb_feature_spaces` (`weight`);--> statement-breakpoint
CREATE TABLE `deepweb_inference_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`function_id` text,
	`model_layer_id` text,
	`vector_hash` text NOT NULL,
	`dimensions` text NOT NULL,
	`output_scores` text NOT NULL,
	`predicted_class` text NOT NULL,
	`confidence` real NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`function_id`) REFERENCES `project_functions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`model_layer_id`) REFERENCES `deepweb_model_layers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `deepweb_inference_runs_run_idx` ON `deepweb_inference_runs` (`run_id`);--> statement-breakpoint
CREATE INDEX `deepweb_inference_runs_function_idx` ON `deepweb_inference_runs` (`function_id`);--> statement-breakpoint
CREATE INDEX `deepweb_inference_runs_class_idx` ON `deepweb_inference_runs` (`predicted_class`);--> statement-breakpoint
CREATE TABLE `deepweb_language_adapters` (
	`id` text PRIMARY KEY NOT NULL,
	`language` text NOT NULL,
	`parser_stack` text NOT NULL,
	`runtime_modes` text NOT NULL,
	`feature_dimensions` text NOT NULL,
	`source_patterns` text NOT NULL,
	`sink_patterns` text NOT NULL,
	`confidence` real NOT NULL,
	`fallback_strategy` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_language_adapters_language_idx` ON `deepweb_language_adapters` (`language`);--> statement-breakpoint
CREATE INDEX `deepweb_language_adapters_confidence_idx` ON `deepweb_language_adapters` (`confidence`);--> statement-breakpoint
CREATE TABLE `deepweb_model_layers` (
	`id` text PRIMARY KEY NOT NULL,
	`layer_order` integer NOT NULL,
	`name` text NOT NULL,
	`layer_kind` text NOT NULL,
	`activation` text NOT NULL,
	`input_dimensions` text NOT NULL,
	`output_dimensions` text NOT NULL,
	`weights` text NOT NULL,
	`bias` real NOT NULL,
	`runtime_modes` text NOT NULL,
	`purpose` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_model_layers_order_idx` ON `deepweb_model_layers` (`layer_order`);--> statement-breakpoint
CREATE INDEX `deepweb_model_layers_kind_idx` ON `deepweb_model_layers` (`layer_kind`);--> statement-breakpoint
CREATE TABLE `deepweb_projections` (
	`id` text PRIMARY KEY NOT NULL,
	`source_table` text NOT NULL,
	`target_table` text NOT NULL,
	`projection_kind` text NOT NULL,
	`source_columns` text NOT NULL,
	`feature_dimensions` text NOT NULL,
	`mapping_formula` text NOT NULL,
	`weight` real NOT NULL,
	`evidence_policy` text NOT NULL,
	`loss_function` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_projections_source_idx` ON `deepweb_projections` (`source_table`);--> statement-breakpoint
CREATE INDEX `deepweb_projections_target_idx` ON `deepweb_projections` (`target_table`);--> statement-breakpoint
CREATE INDEX `deepweb_projections_kind_idx` ON `deepweb_projections` (`projection_kind`);--> statement-breakpoint
CREATE TABLE `deepweb_training_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`sample_kind` text NOT NULL,
	`language` text NOT NULL,
	`input_signature` text NOT NULL,
	`expected_class` text NOT NULL,
	`feature_vector` text NOT NULL,
	`label_confidence` real NOT NULL,
	`source_table` text NOT NULL,
	`tags` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_training_samples_kind_idx` ON `deepweb_training_samples` (`sample_kind`);--> statement-breakpoint
CREATE INDEX `deepweb_training_samples_language_idx` ON `deepweb_training_samples` (`language`);--> statement-breakpoint
CREATE INDEX `deepweb_training_samples_class_idx` ON `deepweb_training_samples` (`expected_class`);