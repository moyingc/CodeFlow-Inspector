ALTER TABLE `runtime_execution_runs` ADD `sanitizer_status` text DEFAULT 'not-requested' NOT NULL;
ALTER TABLE `runtime_execution_runs` ADD `sanitizer_findings` text DEFAULT '[]' NOT NULL;
