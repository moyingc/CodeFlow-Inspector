CREATE TABLE `knowledge_sources` (`id` text PRIMARY KEY NOT NULL, `name` text NOT NULL, `source_kind` text NOT NULL, `base_url` text NOT NULL, `license_id` text NOT NULL, `attribution` text NOT NULL, `commercial_allowed` integer NOT NULL, `redistribution_allowed` integer NOT NULL, `notice_text` text NOT NULL, `status` text NOT NULL, `last_checked_at` integer NOT NULL, `last_status` text NOT NULL, `record_count` integer NOT NULL, `etag` text NOT NULL, `evidence` text NOT NULL);
--> statement-breakpoint
CREATE TABLE `knowledge_pack_versions` (`id` text PRIMARY KEY NOT NULL, `version` text NOT NULL, `parent_pack_id` text, `status` text NOT NULL, `manifest_json` text NOT NULL, `content_hash` text NOT NULL, `signature` text NOT NULL, `signature_algorithm` text NOT NULL, `key_id` text NOT NULL, `source_count` integer NOT NULL, `record_count` integer NOT NULL, `quarantined_count` integer NOT NULL, `validation_score` real NOT NULL, `created_at` integer NOT NULL, `activated_at` integer, `evidence` text NOT NULL);
--> statement-breakpoint
CREATE TABLE `knowledge_raw_artifacts` (`id` text PRIMARY KEY NOT NULL, `pack_id` text NOT NULL, `source_id` text NOT NULL, `source_url` text NOT NULL, `fetched_at` integer NOT NULL, `content_type` text NOT NULL, `etag` text NOT NULL, `sha256` text NOT NULL, `byte_count` integer NOT NULL, `payload` blob NOT NULL, `license_id` text NOT NULL, `validation_status` text NOT NULL, `error` text NOT NULL);
--> statement-breakpoint
CREATE TABLE `knowledge_records` (`id` text PRIMARY KEY NOT NULL, `pack_id` text NOT NULL, `source_id` text NOT NULL, `external_id` text NOT NULL, `record_kind` text NOT NULL, `ecosystem` text NOT NULL, `package_name` text NOT NULL, `affected_range` text NOT NULL, `severity` text NOT NULL, `cwe_ids` text NOT NULL, `title` text NOT NULL, `summary` text NOT NULL, `references_json` text NOT NULL, `modified_at` text NOT NULL, `normalized_json` text NOT NULL, `license_id` text NOT NULL, `attribution` text NOT NULL, `commercial_allowed` integer NOT NULL, `redistribution_allowed` integer NOT NULL, `record_hash` text NOT NULL, `status` text NOT NULL, `quarantine_reason` text NOT NULL, `created_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE `knowledge_validation_runs` (`id` text PRIMARY KEY NOT NULL, `pack_id` text NOT NULL, `schema_pass` integer NOT NULL, `license_pass` integer NOT NULL, `replay_pass` integer NOT NULL, `signature_pass` integer NOT NULL, `source_count` integer NOT NULL, `record_count` integer NOT NULL, `rejected_count` integer NOT NULL, `score` real NOT NULL, `evidence` text NOT NULL, `created_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE `knowledge_pack_state` (`id` text PRIMARY KEY NOT NULL, `active_pack_id` text, `previous_pack_id` text, `updated_at` integer NOT NULL);
--> statement-breakpoint
CREATE TABLE `knowledge_pack_events` (`id` text PRIMARY KEY NOT NULL, `pack_id` text NOT NULL, `event_kind` text NOT NULL, `from_status` text NOT NULL, `to_status` text NOT NULL, `actor` text NOT NULL, `evidence` text NOT NULL, `created_at` integer NOT NULL);
--> statement-breakpoint
CREATE INDEX `knowledge_pack_versions_status_idx` ON `knowledge_pack_versions` (`status`,`created_at`);
CREATE INDEX `knowledge_raw_artifacts_pack_idx` ON `knowledge_raw_artifacts` (`pack_id`,`source_id`);
CREATE INDEX `knowledge_records_pack_idx` ON `knowledge_records` (`pack_id`,`status`,`source_id`);
CREATE INDEX `knowledge_records_external_idx` ON `knowledge_records` (`external_id`,`ecosystem`,`package_name`);
CREATE INDEX `knowledge_validation_runs_pack_idx` ON `knowledge_validation_runs` (`pack_id`,`created_at`);
CREATE INDEX `knowledge_pack_events_pack_idx` ON `knowledge_pack_events` (`pack_id`,`created_at`);
--> statement-breakpoint
CREATE TRIGGER `knowledge_pack_events_no_update` BEFORE UPDATE ON `knowledge_pack_events` BEGIN SELECT RAISE(ABORT, 'knowledge pack events are immutable'); END;
CREATE TRIGGER `knowledge_pack_events_no_delete` BEFORE DELETE ON `knowledge_pack_events` BEGIN SELECT RAISE(ABORT, 'knowledge pack events are immutable'); END;
CREATE TRIGGER `knowledge_raw_artifacts_no_update` BEFORE UPDATE ON `knowledge_raw_artifacts` BEGIN SELECT RAISE(ABORT, 'knowledge raw artifacts are immutable'); END;
CREATE TRIGGER `knowledge_raw_artifacts_no_delete` BEFORE DELETE ON `knowledge_raw_artifacts` BEGIN SELECT RAISE(ABORT, 'knowledge raw artifacts are immutable'); END;
