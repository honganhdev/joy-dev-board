ALTER TABLE `pulls` ADD `source` text;--> statement-breakpoint
ALTER TABLE `pulls` ADD `deliveryId` text;--> statement-breakpoint
CREATE UNIQUE INDEX `pulls_deliveryId_idx` ON `pulls` (`deliveryId`);