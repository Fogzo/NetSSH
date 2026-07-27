export function createId(prefix = "id"): string {
  if (typeof crypto.randomUUID === "function") return `${prefix}-${crypto.randomUUID()}`;
  const random = new Uint32Array(4);
  crypto.getRandomValues(random);
  return `${prefix}-${Date.now().toString(36)}-${Array.from(random, (value) => value.toString(36)).join("")}`;
}
