CREATE TABLE `analysis_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_name` text NOT NULL,
	`root_path` text NOT NULL,
	`main_file_id` text,
	`entry_function_id` text,
	`parser_mode` text NOT NULL,
	`file_count` integer NOT NULL,
	`function_count` integer NOT NULL,
	`integrity_score` real NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `analysis_runs_project_idx` ON `analysis_runs` (`project_name`);--> statement-breakpoint
CREATE INDEX `analysis_runs_created_idx` ON `analysis_runs` (`created_at`);--> statement-breakpoint
CREATE TABLE `benchmark_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`algorithm_family` text NOT NULL,
	`scenario` text NOT NULL,
	`input_scale` text NOT NULL,
	`time_complexity` text NOT NULL,
	`memory_complexity` text NOT NULL,
	`io_pattern` text NOT NULL,
	`baseline_ms` real NOT NULL,
	`optimized_ms` real NOT NULL,
	`stability_tradeoff` real NOT NULL,
	`recommendation` text NOT NULL,
	`source_version_id` text NOT NULL,
	`tags` text NOT NULL,
	FOREIGN KEY (`source_version_id`) REFERENCES `source_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `benchmark_profiles_family_idx` ON `benchmark_profiles` (`algorithm_family`);--> statement-breakpoint
CREATE INDEX `benchmark_profiles_scale_idx` ON `benchmark_profiles` (`input_scale`);--> statement-breakpoint
CREATE TABLE `call_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`from_function_id` text NOT NULL,
	`to_function_id` text NOT NULL,
	`kind` text NOT NULL,
	`confidence` real NOT NULL,
	`evidence` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_function_id`) REFERENCES `project_functions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_function_id`) REFERENCES `project_functions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `call_edges_run_idx` ON `call_edges` (`run_id`);--> statement-breakpoint
CREATE INDEX `call_edges_from_idx` ON `call_edges` (`from_function_id`);--> statement-breakpoint
CREATE INDEX `call_edges_to_idx` ON `call_edges` (`to_function_id`);--> statement-breakpoint
CREATE TABLE `data_flow_traces` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`source_function_id` text,
	`target_function_id` text,
	`path` text NOT NULL,
	`input_shape` text NOT NULL,
	`output_shape` text NOT NULL,
	`outcome` text NOT NULL,
	`confidence` real NOT NULL,
	`evidence` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_function_id`) REFERENCES `project_functions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`target_function_id`) REFERENCES `project_functions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `data_flow_traces_run_idx` ON `data_flow_traces` (`run_id`);--> statement-breakpoint
CREATE INDEX `data_flow_traces_source_idx` ON `data_flow_traces` (`source_function_id`);--> statement-breakpoint
CREATE INDEX `data_flow_traces_target_idx` ON `data_flow_traces` (`target_function_id`);--> statement-breakpoint
CREATE INDEX `data_flow_traces_outcome_idx` ON `data_flow_traces` (`outcome`);--> statement-breakpoint
CREATE TABLE `debug_breakpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`function_id` text,
	`file_name` text NOT NULL,
	`line` integer NOT NULL,
	`enabled` integer NOT NULL,
	`condition` text,
	`hit_count` integer NOT NULL,
	`evidence` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`function_id`) REFERENCES `project_functions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `debug_breakpoints_run_idx` ON `debug_breakpoints` (`run_id`);--> statement-breakpoint
CREATE INDEX `debug_breakpoints_function_idx` ON `debug_breakpoints` (`function_id`);--> statement-breakpoint
CREATE INDEX `debug_breakpoints_file_idx` ON `debug_breakpoints` (`file_name`);--> statement-breakpoint
CREATE TABLE `environment_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`ecosystem` text NOT NULL,
	`profile_kind` text NOT NULL,
	`name` text NOT NULL,
	`version_range` text NOT NULL,
	`required_files` text NOT NULL,
	`required_commands` text NOT NULL,
	`env_vars` text NOT NULL,
	`failure_modes` text NOT NULL,
	`source_version_id` text NOT NULL,
	`tags` text NOT NULL,
	FOREIGN KEY (`source_version_id`) REFERENCES `source_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `environment_profiles_ecosystem_idx` ON `environment_profiles` (`ecosystem`);--> statement-breakpoint
CREATE INDEX `environment_profiles_kind_idx` ON `environment_profiles` (`profile_kind`);--> statement-breakpoint
CREATE INDEX `environment_profiles_name_idx` ON `environment_profiles` (`name`);--> statement-breakpoint
CREATE TABLE `fault_samples` (
	`id` text PRIMARY KEY NOT NULL,
	`category` text NOT NULL,
	`failure_mode` text NOT NULL,
	`trigger` text NOT NULL,
	`minimal_pattern` text NOT NULL,
	`observed_impact` text NOT NULL,
	`reproduction_steps` text NOT NULL,
	`expected_detection_rules` text NOT NULL,
	`severity` text NOT NULL,
	`confidence` real NOT NULL,
	`source_version_id` text NOT NULL,
	`tags` text NOT NULL,
	FOREIGN KEY (`source_version_id`) REFERENCES `source_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `fault_samples_category_idx` ON `fault_samples` (`category`);--> statement-breakpoint
CREATE INDEX `fault_samples_failure_idx` ON `fault_samples` (`failure_mode`);--> statement-breakpoint
CREATE INDEX `fault_samples_severity_idx` ON `fault_samples` (`severity`);--> statement-breakpoint
CREATE TABLE `flow_edges` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`from_node_id` text NOT NULL,
	`to_node_id` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`volume` real NOT NULL,
	`confidence` real NOT NULL,
	`evidence` text NOT NULL,
	`primary` integer NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`from_node_id`) REFERENCES `flow_nodes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`to_node_id`) REFERENCES `flow_nodes`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `flow_edges_run_idx` ON `flow_edges` (`run_id`);--> statement-breakpoint
CREATE INDEX `flow_edges_from_idx` ON `flow_edges` (`from_node_id`);--> statement-breakpoint
CREATE INDEX `flow_edges_to_idx` ON `flow_edges` (`to_node_id`);--> statement-breakpoint
CREATE INDEX `flow_edges_status_idx` ON `flow_edges` (`status`);--> statement-breakpoint
CREATE TABLE `flow_nodes` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`function_id` text,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`status` text NOT NULL,
	`note` text NOT NULL,
	`capacity` text NOT NULL,
	`capacity_score` real NOT NULL,
	`confidence` real NOT NULL,
	`evidence` text NOT NULL,
	`details` text NOT NULL,
	`x` real NOT NULL,
	`y` real NOT NULL,
	`depth` integer NOT NULL,
	`upstream_ids` text NOT NULL,
	`downstream_ids` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`function_id`) REFERENCES `project_functions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `flow_nodes_run_idx` ON `flow_nodes` (`run_id`);--> statement-breakpoint
CREATE INDEX `flow_nodes_function_idx` ON `flow_nodes` (`function_id`);--> statement-breakpoint
CREATE INDEX `flow_nodes_status_idx` ON `flow_nodes` (`status`);--> statement-breakpoint
CREATE INDEX `flow_nodes_depth_idx` ON `flow_nodes` (`depth`);--> statement-breakpoint
CREATE TABLE `function_symbols` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`function_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`data_type` text NOT NULL,
	`source` text NOT NULL,
	`confidence` real NOT NULL,
	`evidence` text NOT NULL,
	`position` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`function_id`) REFERENCES `project_functions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `function_symbols_run_idx` ON `function_symbols` (`run_id`);--> statement-breakpoint
CREATE INDEX `function_symbols_function_idx` ON `function_symbols` (`function_id`);--> statement-breakpoint
CREATE INDEX `function_symbols_kind_idx` ON `function_symbols` (`kind`);--> statement-breakpoint
CREATE INDEX `function_symbols_name_idx` ON `function_symbols` (`name`);--> statement-breakpoint
CREATE TABLE `hardware_component_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`family` text NOT NULL,
	`component` text NOT NULL,
	`interface_name` text NOT NULL,
	`nominal_voltage` real NOT NULL,
	`max_current_ma` real NOT NULL,
	`sample_rate_hz` real NOT NULL,
	`tolerance_pct` real NOT NULL,
	`failure_modes` text NOT NULL,
	`safe_operating_rules` text NOT NULL,
	`source_version_id` text NOT NULL,
	`tags` text NOT NULL,
	FOREIGN KEY (`source_version_id`) REFERENCES `source_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `hardware_component_profiles_family_idx` ON `hardware_component_profiles` (`family`);--> statement-breakpoint
CREATE INDEX `hardware_component_profiles_component_idx` ON `hardware_component_profiles` (`component`);--> statement-breakpoint
CREATE INDEX `hardware_component_profiles_interface_idx` ON `hardware_component_profiles` (`interface_name`);--> statement-breakpoint
CREATE TABLE `knowledge_feature_vectors` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text,
	`name` text NOT NULL,
	`feature_kind` text NOT NULL,
	`vector_schema` text NOT NULL,
	`weights` text NOT NULL,
	`threshold` real NOT NULL,
	`target_tables` text NOT NULL,
	`source_version_id` text NOT NULL,
	`tags` text NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `knowledge_rules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_version_id`) REFERENCES `source_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `knowledge_feature_vectors_rule_idx` ON `knowledge_feature_vectors` (`rule_id`);--> statement-breakpoint
CREATE INDEX `knowledge_feature_vectors_kind_idx` ON `knowledge_feature_vectors` (`feature_kind`);--> statement-breakpoint
CREATE TABLE `project_files` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`path` text NOT NULL,
	`language` text NOT NULL,
	`hash` text NOT NULL,
	`size` integer NOT NULL,
	`last_modified` integer,
	`imports` text NOT NULL,
	`environment_refs` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_files_run_idx` ON `project_files` (`run_id`);--> statement-breakpoint
CREATE INDEX `project_files_path_idx` ON `project_files` (`path`);--> statement-breakpoint
CREATE INDEX `project_files_language_idx` ON `project_files` (`language`);--> statement-breakpoint
CREATE TABLE `project_functions` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`file_id` text NOT NULL,
	`name` text NOT NULL,
	`language` text NOT NULL,
	`start_line` integer NOT NULL,
	`end_line` integer NOT NULL,
	`params` text NOT NULL,
	`return_type` text NOT NULL,
	`outputs` text NOT NULL,
	`calls` text NOT NULL,
	`body_hash` text NOT NULL,
	`summary` text NOT NULL,
	`data_shape` text NOT NULL,
	`complexity` integer NOT NULL,
	`category` text NOT NULL,
	`side_effects` text NOT NULL,
	`external_inputs` text NOT NULL,
	`validations` text NOT NULL,
	`risks` text NOT NULL,
	`source` text NOT NULL,
	`confidence` real NOT NULL,
	`parser` text NOT NULL,
	`parse_evidence` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `project_files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `project_functions_run_idx` ON `project_functions` (`run_id`);--> statement-breakpoint
CREATE INDEX `project_functions_file_idx` ON `project_functions` (`file_id`);--> statement-breakpoint
CREATE INDEX `project_functions_name_idx` ON `project_functions` (`name`);--> statement-breakpoint
CREATE INDEX `project_functions_confidence_idx` ON `project_functions` (`confidence`);--> statement-breakpoint
CREATE TABLE `repair_recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`rule_id` text,
	`recipe_kind` text NOT NULL,
	`title` text NOT NULL,
	`target_language` text NOT NULL,
	`before_pattern` text NOT NULL,
	`after_pattern` text NOT NULL,
	`safety_checks` text NOT NULL,
	`expected_gain` real NOT NULL,
	`stability_impact` real NOT NULL,
	`source_version_id` text NOT NULL,
	`tags` text NOT NULL,
	FOREIGN KEY (`rule_id`) REFERENCES `knowledge_rules`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_version_id`) REFERENCES `source_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `repair_recipes_rule_idx` ON `repair_recipes` (`rule_id`);--> statement-breakpoint
CREATE INDEX `repair_recipes_kind_idx` ON `repair_recipes` (`recipe_kind`);--> statement-breakpoint
CREATE INDEX `repair_recipes_language_idx` ON `repair_recipes` (`target_language`);--> statement-breakpoint
CREATE TABLE `sdk_api_profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`ecosystem` text NOT NULL,
	`sdk_name` text NOT NULL,
	`module` text NOT NULL,
	`api_name` text NOT NULL,
	`version_range` text NOT NULL,
	`input_contract` text NOT NULL,
	`output_contract` text NOT NULL,
	`side_effects` text NOT NULL,
	`failure_modes` text NOT NULL,
	`safe_alternative` text NOT NULL,
	`source_version_id` text NOT NULL,
	`tags` text NOT NULL,
	FOREIGN KEY (`source_version_id`) REFERENCES `source_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sdk_api_profiles_sdk_idx` ON `sdk_api_profiles` (`sdk_name`);--> statement-breakpoint
CREATE INDEX `sdk_api_profiles_api_idx` ON `sdk_api_profiles` (`api_name`);--> statement-breakpoint
CREATE INDEX `sdk_api_profiles_ecosystem_idx` ON `sdk_api_profiles` (`ecosystem`);--> statement-breakpoint
CREATE TABLE `version_constraints` (
	`id` text PRIMARY KEY NOT NULL,
	`ecosystem` text NOT NULL,
	`package_name` text NOT NULL,
	`api_name` text NOT NULL,
	`version_range` text NOT NULL,
	`behavior` text NOT NULL,
	`risk_delta` text NOT NULL,
	`mitigation` text NOT NULL,
	`source_version_id` text NOT NULL,
	`tags` text NOT NULL,
	FOREIGN KEY (`source_version_id`) REFERENCES `source_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `version_constraints_ecosystem_idx` ON `version_constraints` (`ecosystem`);--> statement-breakpoint
CREATE INDEX `version_constraints_package_idx` ON `version_constraints` (`package_name`);--> statement-breakpoint
CREATE INDEX `version_constraints_api_idx` ON `version_constraints` (`api_name`);