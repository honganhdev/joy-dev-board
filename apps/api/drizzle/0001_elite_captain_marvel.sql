CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`createdAt` text NOT NULL,
	`expiresAt` text NOT NULL,
	`lastSeenAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `sessions_expiresAt_idx` ON `sessions` (`expiresAt`);