/** JSON data only: no silent dropping of undefined, holes, cycles, or exotic objects. */
export function isJsonValue(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  ancestors.add(value);
  try {
    if (array) {
      for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index) || !isJsonValue(value[index], ancestors)) return false;
      return true;
    }
    return Object.values(value).every(item => isJsonValue(item, ancestors));
  } finally { ancestors.delete(value); }
}
