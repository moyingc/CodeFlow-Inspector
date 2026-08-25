CREATE TABLE IF NOT EXISTS `security_attack_cases` (
  `id` text PRIMARY KEY NOT NULL,
  `corpus_id` text NOT NULL,
  `sample_id` text NOT NULL,
  `kind` text NOT NULL,
  `title` text NOT NULL,
  `protocol` text NOT NULL,
  `framework_hints` text NOT NULL,
  `weakness_ids` text NOT NULL,
  `expected` text NOT NULL,
  `payload_hash` text NOT NULL,
  `provenance` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`corpus_id`) REFERENCES `security_attack_corpora`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `security_attack_cases_corpus_idx` ON `security_attack_cases` (`corpus_id`);
--> statement-breakpoint
ALTER TABLE `security_assertion_runs` ADD `framework_hints` text DEFAULT '[]' NOT NULL;
