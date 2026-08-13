CREATE TABLE IF NOT EXISTS "order_cuts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"cut_id" uuid NOT NULL,
	"assigned_quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_cuts" ADD CONSTRAINT "order_cuts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_cuts" ADD CONSTRAINT "order_cuts_cut_id_cuts_id_fk" FOREIGN KEY ("cut_id") REFERENCES "public"."cuts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "order_cuts_order_cut_uidx" ON "order_cuts" USING btree ("order_id","cut_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_cuts_order_id_idx" ON "order_cuts" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "order_cuts_cut_id_idx" ON "order_cuts" USING btree ("cut_id");--> statement-breakpoint
-- Backfill from legacy orders.cut_id / assigned_quantity when order_cuts is empty for that order.
INSERT INTO order_cuts (order_id, cut_id, assigned_quantity)
SELECT
  o.id,
  o.cut_id,
  COALESCE(o.assigned_quantity, o.expected_quantity)
FROM orders o
WHERE o.deleted_at IS NULL
  AND o.cut_id IS NOT NULL
  AND COALESCE(o.assigned_quantity, o.expected_quantity) > 0
  AND NOT EXISTS (
    SELECT 1 FROM order_cuts oc WHERE oc.order_id = o.id
  );
--> statement-breakpoint
-- Document unmigratable: orders without cut_id (should be none after 0002 backfill).
-- SELECT id, number FROM orders WHERE deleted_at IS NULL AND cut_id IS NULL;
