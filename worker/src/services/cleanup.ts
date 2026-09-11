import { cleanupExpiredData } from '../db/repo';
import { nowIso } from '../lib/datetime';

export async function runDailyCleanup(db: D1Database, now = new Date()) {
  return cleanupExpiredData(db, nowIso(now));
}
