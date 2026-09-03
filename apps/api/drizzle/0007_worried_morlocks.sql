CREATE TABLE `mcp_tokens` (
	`publicId` text PRIMARY KEY NOT NULL,
	`label` text NOT NULL,
	`username` text NOT NULL,
	`secretHash` text NOT NULL,
	`createdAt` text NOT NULL,
	`lastUsedAt` text,
	`expiresAt` text,
	`revokedAt` text
);
