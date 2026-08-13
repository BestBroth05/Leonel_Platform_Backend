ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "week_opens_on" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "week_closes_on" text;--> statement-breakpoint
-- The previous client_weeks open/close history was not the intended feature.
-- Week schedule is now two weekday fields on clients. Drop unused table safely.
DROP TABLE IF EXISTS "client_weeks";
