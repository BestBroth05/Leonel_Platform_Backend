/** Business calendar helpers (America/Mexico_City day boundaries via YYYY-MM-DD). */

export function toBusinessDateString(value: Date | string = new Date()): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) {
    throw new Error("Fecha inválida");
  }
  // Use local calendar components of the Date as provided by the API layer.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function compareBusinessDates(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function isBusinessDateOnOrAfter(date: string, min: string): boolean {
  return compareBusinessDates(date, min) >= 0;
}

export function isBusinessDateOnOrBefore(date: string, max: string): boolean {
  return compareBusinessDates(date, max) <= 0;
}

/**
 * Effective date for an OPEN week must be:
 * - >= startDate
 * - <= today (no future)
 * - if endDate set (shouldn't for OPEN), <= endDate
 */
export function assertEffectiveDateInOpenWeek(input: {
  effectiveAt: Date | string;
  startDate: string;
  endDate: string | null;
  today?: string;
}): string {
  const effective = toBusinessDateString(input.effectiveAt);
  const today = input.today ?? toBusinessDateString(new Date());

  if (!isBusinessDateOnOrAfter(effective, input.startDate)) {
    throw new Error(
      `La fecha efectiva (${effective}) es anterior al inicio de la semana (${input.startDate}).`,
    );
  }
  if (!isBusinessDateOnOrBefore(effective, today)) {
    throw new Error("No se permiten operaciones con fechas futuras.");
  }
  if (input.endDate && !isBusinessDateOnOrBefore(effective, input.endDate)) {
    throw new Error(
      `La fecha efectiva (${effective}) está fuera del periodo de la semana (hasta ${input.endDate}).`,
    );
  }
  return effective;
}

/** Inclusive range overlap: [aStart, aEnd] vs [bStart, bEnd] (null end = open-ended). */
export function rangesOverlap(
  aStart: string,
  aEnd: string | null,
  bStart: string,
  bEnd: string | null,
): boolean {
  const aRight = aEnd ?? "9999-12-31";
  const bRight = bEnd ?? "9999-12-31";
  return aStart <= bRight && bStart <= aRight;
}
