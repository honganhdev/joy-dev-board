CREATE TABLE `pulls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`startedAt` text NOT NULL,
	`finishedAt` text,
	`ticketCount` integer,
	`status` text NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `ticket_status_history` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticketId` text NOT NULL,
	`fromStatus` text,
	`toStatus` text,
	`observedAt` text NOT NULL,
	`ticketUpdatedAt` text,
	`pullId` integer NOT NULL,
	FOREIGN KEY (`ticketId`) REFERENCES `tickets`(`ticketId`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pullId`) REFERENCES `pulls`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `ticket_status_history_ticketId_idx` ON `ticket_status_history` (`ticketId`);--> statement-breakpoint
CREATE TABLE `tickets` (
	`ticketId` text PRIMARY KEY NOT NULL,
	`id` text NOT NULL,
	`ticketNumber` text,
	`subject` text,
	`tsStatus` text,
	`ticketStatus` text,
	`priority` text,
	`level` integer,
	`appName` text,
	`appPlan` text,
	`shopName` text,
	`domain` text,
	`createdAt` text,
	`updatedAt` text,
	`dueDate` text,
	`raw` text NOT NULL,
	`firstSeenAt` text NOT NULL,
	`lastSeenAt` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `tickets_tsStatus_idx` ON `tickets` (`tsStatus`);--> statement-breakpoint
CREATE INDEX `tickets_ticketStatus_idx` ON `tickets` (`ticketStatus`);