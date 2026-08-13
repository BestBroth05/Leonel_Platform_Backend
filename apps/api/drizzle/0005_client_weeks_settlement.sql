-- Manual client weeks, format→client, week FKs on ops, packaging/sizes/allocations, snapshots.
-- Drop incorrect weekday schedule on clients.
ALTER TABLE "clients" DROP COLUMN IF EXISTS "week_opens_on";--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN IF EXISTS "week_closes_on";--> statement-breakpoint

ALTER TABLE "production_formats" ADD COLUMN IF NOT EXISTS "client_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "production_formats"
    ADD CONSTRAINT "production_formats_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_formats_client_id_idx" ON "production_formats" USING btree ("client_id");--> statement-breakpoint

-- Backfill format client when all non-deleted orders agree on a single client.
UPDATE "production_formats" pf
SET "client_id" = src.client_id
FROM (
  SELECT o.production_format_id, MIN(o.client_id::text)::uuid AS client_id
  FROM "orders" o
  WHERE o.production_format_id IS NOT NULL
    AND o.deleted_at IS NULL
  GROUP BY o.production_format_id
  HAVING COUNT(DISTINCT o.client_id) = 1
) src
WHERE pf.id = src.production_format_id
  AND pf.client_id IS NULL;--> statement-breakpoint

-- Document ambiguous formats (multiple clients or no orders) — leave nullable.
-- SELECT pf.id, pf.number FROM production_formats pf
-- WHERE pf.deleted_at IS NULL AND pf.client_id IS NULL;

CREATE TABLE IF NOT EXISTS "client_weeks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_id" uuid NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date,
  "opened_at" timestamp with time zone DEFAULT now() NOT NULL,
  "closed_at" timestamp with time zone,
  "status" text DEFAULT 'OPEN' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_by" uuid,
  "updated_by" uuid
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_weeks"
    ADD CONSTRAINT "client_weeks_client_id_clients_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_weeks"
    ADD CONSTRAINT "client_weeks_created_by_users_id_fk"
    FOREIGN KEY ("created_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "client_weeks"
    ADD CONSTRAINT "client_weeks_updated_by_users_id_fk"
    FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_weeks_one_open_uidx"
  ON "client_weeks" USING btree ("client_id")
  WHERE "status" = 'OPEN';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_weeks_client_id_idx" ON "client_weeks" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_weeks_client_status_idx" ON "client_weeks" USING btree ("client_id","status");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "weekly_settlement_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "client_week_id" uuid NOT NULL,
  "version" integer NOT NULL,
  "status" text DEFAULT 'CURRENT' NOT NULL,
  "payload" jsonb NOT NULL,
  "closed_at" timestamp with time zone NOT NULL,
  "closed_by" uuid,
  "invalidated_at" timestamp with time zone,
  "invalidated_by" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "weekly_settlement_snapshots"
    ADD CONSTRAINT "weekly_settlement_snapshots_client_week_id_client_weeks_id_fk"
    FOREIGN KEY ("client_week_id") REFERENCES "public"."client_weeks"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "weekly_settlement_snapshots"
    ADD CONSTRAINT "weekly_settlement_snapshots_closed_by_users_id_fk"
    FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "weekly_settlement_snapshots"
    ADD CONSTRAINT "weekly_settlement_snapshots_invalidated_by_users_id_fk"
    FOREIGN KEY ("invalidated_by") REFERENCES "public"."users"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "weekly_settlement_snapshots_week_version_uidx"
  ON "weekly_settlement_snapshots" USING btree ("client_week_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "weekly_settlement_snapshots_one_current_uidx"
  ON "weekly_settlement_snapshots" USING btree ("client_week_id")
  WHERE "status" = 'CURRENT';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "weekly_settlement_snapshots_week_id_idx"
  ON "weekly_settlement_snapshots" USING btree ("client_week_id");--> statement-breakpoint

ALTER TABLE "cut_receipts" ADD COLUMN IF NOT EXISTS "client_week_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "cut_receipts"
    ADD CONSTRAINT "cut_receipts_client_week_id_client_weeks_id_fk"
    FOREIGN KEY ("client_week_id") REFERENCES "public"."client_weeks"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cut_receipts_client_week_id_idx" ON "cut_receipts" USING btree ("client_week_id");--> statement-breakpoint

ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "packaging_type" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "package_count" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "units_per_package" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "created_in_client_week_id" uuid;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "orders"
    ADD CONSTRAINT "orders_created_in_client_week_id_client_weeks_id_fk"
    FOREIGN KEY ("created_in_client_week_id") REFERENCES "public"."client_weeks"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_created_in_client_week_id_idx"
  ON "orders" USING btree ("created_in_client_week_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "order_size_breakdowns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "order_id" uuid NOT NULL,
  "size_label" text NOT NULL,
  "quantity" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "order_size_breakdowns"
    ADD CONSTRAINT "order_size_breakdowns_order_id_orders_id_fk"
    FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_size_breakdowns_order_size_uidx"
  ON "order_size_breakdowns" USING btree ("order_id","size_label");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_size_breakdowns_order_id_idx"
  ON "order_size_breakdowns" USING btree ("order_id");--> statement-breakpoint

ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "client_week_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "packaging_type" text;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "package_count" integer;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "units_per_package" integer;--> statement-breakpoint
ALTER TABLE "inventory_movements" ADD COLUMN IF NOT EXISTS "occurred_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "inventory_movements" SET "occurred_at" = "created_at" WHERE "occurred_at" IS NULL;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inventory_movements"
    ADD CONSTRAINT "inventory_movements_client_week_id_client_weeks_id_fk"
    FOREIGN KEY ("client_week_id") REFERENCES "public"."client_weeks"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inventory_movements_client_week_id_idx"
  ON "inventory_movements" USING btree ("client_week_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "movement_cut_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "movement_id" uuid NOT NULL,
  "order_cut_id" uuid NOT NULL,
  "quantity" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "movement_cut_allocations"
    ADD CONSTRAINT "movement_cut_allocations_movement_id_inventory_movements_id_fk"
    FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "movement_cut_allocations"
    ADD CONSTRAINT "movement_cut_allocations_order_cut_id_order_cuts_id_fk"
    FOREIGN KEY ("order_cut_id") REFERENCES "public"."order_cuts"("id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "movement_cut_allocations_movement_order_cut_uidx"
  ON "movement_cut_allocations" USING btree ("movement_id","order_cut_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "movement_cut_allocations_movement_id_idx"
  ON "movement_cut_allocations" USING btree ("movement_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "movement_cut_allocations_order_cut_id_idx"
  ON "movement_cut_allocations" USING btree ("order_cut_id");--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "movement_size_breakdowns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "movement_id" uuid NOT NULL,
  "size_label" text NOT NULL,
  "quantity" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "movement_size_breakdowns"
    ADD CONSTRAINT "movement_size_breakdowns_movement_id_inventory_movements_id_fk"
    FOREIGN KEY ("movement_id") REFERENCES "public"."inventory_movements"("id") ON DELETE cascade;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "movement_size_breakdowns_movement_size_uidx"
  ON "movement_size_breakdowns" USING btree ("movement_id","size_label");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "movement_size_breakdowns_movement_id_idx"
  ON "movement_size_breakdowns" USING btree ("movement_id");
