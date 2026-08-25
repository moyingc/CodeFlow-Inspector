CREATE TABLE `database_optimization_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`target_table` text NOT NULL,
	`optimization_kind` text NOT NULL,
	`before_cost` real NOT NULL,
	`after_cost` real NOT NULL,
	`score` real NOT NULL,
	`evidence` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `database_optimization_profiles_table_idx` ON `database_optimization_profiles` (`target_table`);--> statement-breakpoint
CREATE INDEX `database_optimization_profiles_kind_idx` ON `database_optimization_profiles` (`optimization_kind`);--> statement-breakpoint
CREATE INDEX `database_optimization_profiles_score_idx` ON `database_optimization_profiles` (`score`);--> statement-breakpoint
CREATE TABLE `deepweb_extreme_test_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`target` text NOT NULL,
	`load_factor` real NOT NULL,
	`pass_threshold` real NOT NULL,
	`score` real NOT NULL,
	`status` text NOT NULL,
	`evidence` text NOT NULL,
	`recommendation` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `deepweb_extreme_test_runs_category_idx` ON `deepweb_extreme_test_runs` (`category`);--> statement-breakpoint
CREATE INDEX `deepweb_extreme_test_runs_target_idx` ON `deepweb_extreme_test_runs` (`target`);--> statement-breakpoint
CREATE INDEX `deepweb_extreme_test_runs_status_idx` ON `deepweb_extreme_test_runs` (`status`);