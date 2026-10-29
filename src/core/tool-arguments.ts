/** Validation for a model's tool arguments; each helper throws on an unusable answer. */

export function toolArguments(raw: string): Record<string, unknown> {
  const args: unknown = JSON.parse(raw);
  if (typeof args !== "object" || args === null || Array.isArray(args)) {
    throw new Error("Model's tool arguments are not an object");
  }
  return args as Record<string, unknown>;
}

export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw new Error(`Model gave a non-string "${key}"`);
  return value.trim() || undefined;
}

export function requiredString(args: Record<string, unknown>, key: string): string {
  const value = optionalString(args, key);
  if (value === undefined) throw new Error(`Model left out "${key}"`);
  return value;
}
