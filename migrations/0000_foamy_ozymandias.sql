CREATE TABLE `backup_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`server_id` text NOT NULL,
	`name` text NOT NULL,
	`source_path` text NOT NULL,
	`destination_path` text NOT NULL,
	`schedule` text NOT NULL,
	`exclude_patterns` text,
	`pre_backup_commands` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`server_id`) REFERENCES `servers`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `backup_history` (
	`id` text PRIMARY KEY NOT NULL,
	`config_id` text NOT NULL,
	`start_time` integer NOT NULL,
	`end_time` integer,
	`status` text NOT NULL,
	`file_count` integer,
	`total_size` integer,
	`transferred_size` integer,
	`error_message` text,
	`log_output` text,
	FOREIGN KEY (`config_id`) REFERENCES `backup_configs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `servers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`host` text NOT NULL,
	`port` integer DEFAULT 22 NOT NULL,
	`username` text NOT NULL,
	`auth_type` text NOT NULL,
	`password` text,
	`private_key` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);
