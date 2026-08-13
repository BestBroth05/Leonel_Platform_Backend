CREATE TABLE IF NOT EXISTS "production_formats" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cuts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"production_format_id" uuid NOT NULL,
	"number" text NOT NULL,
	"work_plan" text NOT NULL,
	"style" text NOT NULL,
	"expected_quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "cut_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cut_id" uuid NOT NULL,
	"folio_number" text NOT NULL,
	"partial_number" integer NOT NULL,
	"quantity" integer NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "client_weeks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"status" text DEFAULT 'OPEN' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "production_format_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cut_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "assigned_quantity" integer;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "purchase_order" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "cost_per_garment" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "production_formats" ADD CONSTRAINT "production_formats_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "production_formats" ADD CONSTRAINT "production_formats_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cuts" ADD CONSTRAINT "cuts_production_format_id_production_formats_id_fk" FOREIGN KEY ("production_format_id") REFERENCES "public"."production_formats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cuts" ADD CONSTRAINT "cuts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cuts" ADD CONSTRAINT "cuts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cut_receipts" ADD CONSTRAINT "cut_receipts_cut_id_cuts_id_fk" FOREIGN KEY ("cut_id") REFERENCES "public"."cuts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cut_receipts" ADD CONSTRAINT "cut_receipts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cut_receipts" ADD CONSTRAINT "cut_receipts_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "client_weeks" ADD CONSTRAINT "client_weeks_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_production_format_id_production_formats_id_fk" FOREIGN KEY ("production_format_id") REFERENCES "public"."production_formats"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_cut_id_cuts_id_fk" FOREIGN KEY ("cut_id") REFERENCES "public"."cuts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "production_formats_number_uidx" ON "production_formats" ("number") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "production_formats_number_idx" ON "production_formats" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cuts_format_number_uidx" ON "cuts" ("production_format_id","number") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cuts_production_format_id_idx" ON "cuts" USING btree ("production_format_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "cut_receipts_cut_partial_uidx" ON "cut_receipts" USING btree ("cut_id","partial_number");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "cut_receipts_cut_id_idx" ON "cut_receipts" USING btree ("cut_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_weeks_client_id_idx" ON "client_weeks" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "client_weeks_client_status_idx" ON "client_weeks" USING btree ("client_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "client_weeks_one_open_uidx" ON "client_weeks" ("client_id") WHERE "status" = 'OPEN';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_production_format_id_idx" ON "orders" USING btree ("production_format_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "orders_cut_id_idx" ON "orders" USING btree ("cut_id");--> statement-breakpoint
-- Backfill existing orders into synthetic production formats / cuts / receipts.
-- Unmigratable rows would be orders without a client (none under current FKs).
DO $$
DECLARE
  r RECORD;
  fmt_id uuid;
  new_cut_id uuid;
  received_qty integer;
BEGIN
  FOR r IN
    SELECT o.*
    FROM orders o
    WHERE o.deleted_at IS NULL
      AND o.production_format_id IS NULL
  LOOP
    INSERT INTO production_formats ("number", created_by, updated_by)
    VALUES ('MIG-' || r.number, r.created_by, r.updated_by)
    RETURNING id INTO fmt_id;

    received_qty := (
      SELECT COALESCE(SUM(m.quantity), 0)::int
      FROM inventory_movements m
      WHERE m.order_id = r.id
        AND m.type = 'RECEPTION'
        AND m.cancelled_at IS NULL
    );
    IF received_qty <= 0 THEN
      received_qty := r.expected_quantity;
    END IF;

    INSERT INTO cuts (
      production_format_id, "number", work_plan, style, expected_quantity, created_by, updated_by
    )
    VALUES (
      fmt_id,
      r.number,
      COALESCE(NULLIF(TRIM(r.notes), ''), '—'),
      '—',
      r.expected_quantity,
      r.created_by,
      r.updated_by
    )
    RETURNING id INTO new_cut_id;

    INSERT INTO cut_receipts (
      cut_id, folio_number, partial_number, quantity, notes, created_by, updated_by
    )
    VALUES (
      new_cut_id,
      'MIG-1',
      1,
      received_qty,
      'Migración desde pedido ' || r.number,
      r.created_by,
      r.updated_by
    );

    UPDATE orders
    SET
      production_format_id = fmt_id,
      cut_id = new_cut_id,
      assigned_quantity = r.expected_quantity,
      updated_at = now()
    WHERE id = r.id;
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE "clients" DROP COLUMN IF EXISTS "phone";
