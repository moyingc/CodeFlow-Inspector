CREATE TABLE `library_domains` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`target_count` integer NOT NULL,
	`core_domains` text NOT NULL,
	`maturity_goal` text NOT NULL,
	`next` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `library_domains_category_idx` ON `library_domains` (`category`);--> statement-breakpoint
CREATE TABLE `library_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`domain` text NOT NULL,
	`name` text NOT NULL,
	`maturity` text NOT NULL,
	`signals` text NOT NULL,
	`evidence_fields` text NOT NULL,
	`applies_to` text NOT NULL,
	`output_use` text NOT NULL,
	`gaps` text NOT NULL,
	`source_version_id` text,
	`tags` text NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`source_version_id`) REFERENCES `source_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `library_entries_category_idx` ON `library_entries` (`category`);--> statement-breakpoint
CREATE INDEX `library_entries_domain_idx` ON `library_entries` (`domain`);--> statement-breakpoint
CREATE INDEX `library_entries_maturity_idx` ON `library_entries` (`maturity`);