import type { PackagingType } from "@leonel-platform/shared";
import { PACKAGING_TYPES } from "@leonel-platform/shared";

export type PackagingInput = {
  packagingType?: PackagingType | null;
  packageCount?: number | null;
  unitsPerPackage?: number | null;
  quantity?: number | null;
};

export function resolveGarmentQuantity(input: PackagingInput): {
  quantity: number;
  packagingType: PackagingType | null;
  packageCount: number | null;
  unitsPerPackage: number | null;
} {
  const type = input.packagingType ?? null;
  if (type && !PACKAGING_TYPES.includes(type)) {
    throw new Error("Tipo de empaque inválido");
  }

  if (!type || type === "UNIT") {
    const quantity = input.quantity;
    if (!Number.isInteger(quantity) || (quantity ?? 0) <= 0) {
      throw new Error("La cantidad debe ser un entero > 0");
    }
    return {
      quantity: quantity!,
      packagingType: type === "UNIT" ? "UNIT" : null,
      packageCount: null,
      unitsPerPackage: null,
    };
  }

  const packageCount = input.packageCount;
  if (!Number.isInteger(packageCount) || (packageCount ?? 0) <= 0) {
    throw new Error("El número de empaques debe ser un entero > 0");
  }

  const unitsPerPackage =
    type === "DOZEN" ? 12 : (input.unitsPerPackage ?? null);
  if (!Number.isInteger(unitsPerPackage) || (unitsPerPackage ?? 0) <= 0) {
    throw new Error("Las unidades por empaque deben ser un entero > 0");
  }

  const quantity = packageCount! * unitsPerPackage!;
  if (input.quantity != null && input.quantity !== quantity) {
    throw new Error(
      `La cantidad (${input.quantity}) no coincide con empaque (${packageCount} × ${unitsPerPackage} = ${quantity}).`,
    );
  }

  return {
    quantity,
    packagingType: type,
    packageCount: packageCount!,
    unitsPerPackage: unitsPerPackage!,
  };
}
