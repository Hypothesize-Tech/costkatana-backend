/**
 * Parse common date-time strings and relative expressions (e.g. "24h", "7d") to Date.
 */
export function parseDateTime(input: string | Date): Date {
  if (input instanceof Date) return input;
  const s = String(input).trim();
  const now = new Date();
  const relative = s.match(/^(\d+)([hdwmy])$/i);
  if (relative) {
    const value = parseInt(relative[1], 10);
    const unit = relative[2].toLowerCase();
    const d = new Date(now);
    switch (unit) {
      case 'h':
        d.setHours(d.getHours() - value);
        return d;
      case 'd':
        d.setDate(d.getDate() - value);
        return d;
      case 'w':
        d.setDate(d.getDate() - value * 7);
        return d;
      case 'm':
        d.setMonth(d.getMonth() - value);
        return d;
      case 'y':
        d.setFullYear(d.getFullYear() - value);
        return d;
      default:
        return now;
    }
  }
  const parsed = new Date(s);
  return Number.isNaN(parsed.getTime()) ? now : parsed;
}
