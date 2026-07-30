import { auditLogs } from "./schema.js";

export async function writeAudit(
  // Transaction or root db — both expose insert()
  db: {
    insert: (
      table: typeof auditLogs,
    ) => {
      values: (values: {
        actorUserId?: string | null;
        action: string;
        entityType: string;
        entityId?: string | null;
        metadata?: Record<string, unknown> | null;
      }) => Promise<unknown> | unknown;
    };
  },
  input: {
    actorUserId: string | null;
    action: string;
    entityType: string;
    entityId?: string;
    metadata?: Record<string, unknown>;
  },
) {
  await db.insert(auditLogs).values({
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata,
  });
}
