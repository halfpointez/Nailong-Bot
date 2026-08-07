export function stripCQCodes(raw: string): string {
  return raw.replace(/\[CQ:[^\]]+\]/g, "").replace(/@\S+\s*/g, "").trim();
}
