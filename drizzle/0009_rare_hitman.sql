CREATE TABLE `deepweb_error_signals` (
	`id` text PRIMARY KEY NOT NULL,
	`signal_kind` text NOT NULL,
	`severity` text NOT NULL,
	`source_id` text NOT NULL,
	`source_name` text NOT NULL,
	`affected_label` text,
	`confidence` real NOT NULL,
	`evidence` text NOT NULL,
	`containment_action` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_error_signals_kind_idx` ON `deepweb_error_signals` (`signal_kind`);--> statement-breakpoint
CREATE INDEX `deepweb_error_signals_source_idx` ON `deepweb_error_signals` (`source_id`);--> statement-breakpoint
CREATE INDEX `deepweb_error_signals_confidence_idx` ON `deepweb_error_signals` (`confidence`);--> statement-breakpoint
CREATE TABLE `deepweb_fitness_scores` (
	`id` text PRIMARY KEY NOT NULL,
	`genome_id` text NOT NULL,
	`accuracy_proxy` real NOT NULL,
	`stability_proxy` real NOT NULL,
	`safety_proxy` real NOT NULL,
	`generalization_proxy` real NOT NULL,
	`regression_penalty` real NOT NULL,
	`fitness_score` real NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_fitness_scores_genome_idx` ON `deepweb_fitness_scores` (`genome_id`);--> statement-breakpoint
CREATE INDEX `deepweb_fitness_scores_score_idx` ON `deepweb_fitness_scores` (`fitness_score`);--> statement-breakpoint
CREATE TABLE `deepweb_gene_expression` (
	`id` text PRIMARY KEY NOT NULL,
	`genome_id` text NOT NULL,
	`gene_id` text NOT NULL,
	`project_signal` text NOT NULL,
	`expression_level` real NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_gene_expression_genome_idx` ON `deepweb_gene_expression` (`genome_id`);--> statement-breakpoint
CREATE INDEX `deepweb_gene_expression_gene_idx` ON `deepweb_gene_expression` (`gene_id`);--> statement-breakpoint
CREATE INDEX `deepweb_gene_expression_level_idx` ON `deepweb_gene_expression` (`expression_level`);--> statement-breakpoint
CREATE TABLE `deepweb_gene_pool` (
	`id` text PRIMARY KEY NOT NULL,
	`gene_kind` text NOT NULL,
	`name` text NOT NULL,
	`expression` real NOT NULL,
	`inherited_from` text NOT NULL,
	`mutation_delta` real NOT NULL,
	`evidence` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_gene_pool_kind_idx` ON `deepweb_gene_pool` (`gene_kind`);--> statement-breakpoint
CREATE INDEX `deepweb_gene_pool_expression_idx` ON `deepweb_gene_pool` (`expression`);--> statement-breakpoint
CREATE TABLE `deepweb_genome_generations` (
	`id` text PRIMARY KEY NOT NULL,
	`generation` integer NOT NULL,
	`parent_id` text,
	`strategy` text NOT NULL,
	`fitness_score` real NOT NULL,
	`accepted` integer NOT NULL,
	`genes` text NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_genome_generations_generation_idx` ON `deepweb_genome_generations` (`generation`);--> statement-breakpoint
CREATE INDEX `deepweb_genome_generations_strategy_idx` ON `deepweb_genome_generations` (`strategy`);--> statement-breakpoint
CREATE INDEX `deepweb_genome_generations_fitness_idx` ON `deepweb_genome_generations` (`fitness_score`);