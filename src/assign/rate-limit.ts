export function createRateLimiter(now: () => Date) {
  const attempts = new Map<string, number[]>();
  return { allow(key: string, limit: number, windowMs: number): boolean {
    const cutoff = now().getTime() - windowMs;
    const recent = (attempts.get(key) || []).filter(t => t > cutoff);
    if (recent.length >= limit) { attempts.set(key, recent); return false; }
    recent.push(now().getTime()); attempts.set(key, recent); return true;
  } };
}
