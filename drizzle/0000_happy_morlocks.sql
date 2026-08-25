CREATE TABLE `knowledge_concepts` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`name` text NOT NULL,
	`summary` text NOT NULL,
	`tags` text NOT NULL,
	`source_version_id` text NOT NULL,
	FOREIGN KEY (`source_version_id`) REFERENCES `source_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `knowledge_concepts_category_idx` ON `knowledge_concepts` (`category`);--> statement-breakpoint
CREATE TABLE `knowledge_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`summary` text NOT NULL,
	`applies_to` text NOT NULL,
	`signal_patterns` text NOT NULL,
	`inputs` text NOT NULL,
	`outputs` text NOT NULL,
	`formula` text,
	`complexity` text,
	`language` text,
	`severity` text NOT NULL,
	`confidence_base` real NOT NULL,
	`recommendation` text NOT NULL,
	`safe_alternative` text,
	`evidence_source` text NOT NULL,
	`source_version_id` text NOT NULL,
	`tags` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`source_version_id`) REFERENCES `source_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `knowledge_rules_category_idx` ON `knowledge_rules` (`category`);--> statement-breakpoint
CREATE INDEX `knowledge_rules_kind_idx` ON `knowledge_rules` (`kind`);--> statement-breakpoint
CREATE INDEX `knowledge_rules_severity_idx` ON `knowledge_rules` (`severity`);--> statement-breakpoint
CREATE TABLE `language_apis` (
	`id` text PRIMARY KEY NOT NULL,
	`language` text NOT NULL,
	`module` text NOT NULL,
	`api_name` text NOT NULL,
	`signature` text NOT NULL,
	`behavior` text NOT NULL,
	`returns` text NOT NULL,
	`risk_tags` text NOT NULL,
	`safe_alternative` text NOT NULL,
	`source_version_id` text NOT NULL,
	FOREIGN KEY (`source_version_id`) REFERENCES `source_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `language_apis_language_idx` ON `language_apis` (`language`);--> statement-breakpoint
CREATE INDEX `language_apis_api_idx` ON `language_apis` (`api_name`);--> statement-breakpoint
CREATE TABLE `rule_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text NOT NULL,
	`evidence_type` text NOT NULL,
	`matcher` text NOT NULL,
	`weight` real NOT NULL,
	`positive_example` text NOT NULL,
	`negative_example` text NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `knowledge_rules`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `rule_evidence_rule_idx` ON `rule_evidence` (`rule_id`);--> statement-breakpoint
CREATE INDEX `rule_evidence_type_idx` ON `rule_evidence` (`evidence_type`);--> statement-breakpoint
CREATE TABLE `source_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`version` text NOT NULL,
	`scope` text NOT NULL,
	`updated_at` text NOT NULL,
	`evidence` text NOT NULL
);
