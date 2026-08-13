import { and, eq, sql } from "drizzle-orm";
import type { AppDb } from "../../infrastructure/db/client.js";
import { clientWeeks } from "../../infrastructure/db/schema.js";
import { AppError, ConflictError, NotFoundError } from "../../shared/errors.js";
import {
  assertEffectiveDateInOpenWeek,
  toBusinessDateString,
} from "../../domain/weeks/business-dates.js";

export type Tx = Pick<
  AppDb,
  "execute" | "select" | "insert" | "update" | "delete" | "query"
>;

export type LockedClientWeek = typeof clientWeeks.$inferSelect;

/** Lock client week row and ensure it is OPEN for operational writes. */
export async function lockOpenClientWeek(
  tx: Tx,
  weekId: string,
  options?: { expectedClientId?: string },
): Promise<LockedClientWeek> {
  await tx.execute(sql`select id from client_weeks where id = ${weekId} for update`);
  const week = await tx.query.clientWeeks.findFirst({
    where: eq(clientWeeks.id, weekId),
  });
  if (!week) throw new NotFoundError("Semana no encontrada");
  if (options?.expectedClientId && week.clientId !== options.expectedClientId) {
    throw new AppError(
      "VALIDATION_ERROR",
      "La semana no pertenece al cliente de la operación",
    );
  }
  if (week.status !== "OPEN") {
    throw new ConflictError(
      "La semana está cerrada. Reábrala para registrar operaciones.",
    );
  }
  return week;
}

/** Resolve and lock the single OPEN week for a client. */
export async function lockOpenWeekForClient(
  tx: Tx,
  clientId: string,
): Promise<LockedClientWeek> {
  const open = await tx.query.clientWeeks.findFirst({
    where: and(eq(clientWeeks.clientId, clientId), eq(clientWeeks.status, "OPEN")),
  });
  if (!open) {
    throw new ConflictError(
      "El cliente no tiene una semana OPEN. Ábrela antes de registrar operaciones.",
    );
  }
  return lockOpenClientWeek(tx, open.id, { expectedClientId: clientId });
}

export function validateEffectiveAgainstOpenWeek(
  week: LockedClientWeek,
  effectiveAt: Date | string,
): Date {
  try {
    assertEffectiveDateInOpenWeek({
      effectiveAt,
      startDate: week.startDate,
      endDate: week.endDate,
      today: toBusinessDateString(new Date()),
    });
  } catch (error) {
    throw new AppError(
      "VALIDATION_ERROR",
      error instanceof Error ? error.message : "Fecha efectiva inválida",
    );
  }
  return typeof effectiveAt === "string" ? new Date(effectiveAt) : effectiveAt;
}
