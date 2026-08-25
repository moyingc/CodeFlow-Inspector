CREATE TABLE `network_policy_events` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer NOT NULL,
	`scope` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER `network_policy_events_no_update` BEFORE UPDATE ON `network_policy_events` BEGIN SELECT RAISE(ABORT, 'network policy events are immutable'); END;
CREATE TRIGGER `network_policy_events_no_delete` BEFORE DELETE ON `network_policy_events` BEGIN SELECT RAISE(ABORT, 'network policy events are immutable'); END;
