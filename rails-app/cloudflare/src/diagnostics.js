export const TRACE_HEADER = "x-isp-trace";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLASS_NAME = /^[A-Z][A-Za-z0-9_]*(?:::[A-Z][A-Za-z0-9_]*)*$/;
export const validUuid = value => typeof value === "string" && value.length === 36 && UUID.test(value);
export function className(value) {
  return typeof value === "string" && value.length <= 120 && value === value.trim() && CLASS_NAME.test(value) ? value : null;
}
