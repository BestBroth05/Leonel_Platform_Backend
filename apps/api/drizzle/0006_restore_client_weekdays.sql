-- Restore client preferred week open/close weekdays (schedule metadata).
-- Operational weeks remain in client_weeks (manual open/close).
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "week_opens_on" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "week_closes_on" text;
