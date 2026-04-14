/*
 * Explicit index sync for the decision-layer collections.
 *
 * Mongoose auto-creates indexes on first write, but that race can drop
 * the first burst of queries in prod. This script is idempotent —
 * run it once after deploy to make sure cost_change_explanations has
 * its indexes ready before the daily cron fires.
 *
 * Usage:
 *   MONGODB_URI=mongodb://... ts-node scripts/migrations/sync-decision-layer-indexes.ts
 */

import 'dotenv/config';
import mongoose from 'mongoose';

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('ERROR: MONGODB_URI is required in env');
    process.exit(1);
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) {
    console.error('ERROR: could not acquire db handle');
    process.exit(1);
  }

  // Ensure the collection exists, then create indexes.
  const collection = db.collection('cost_change_explanations');

  // Matches the @Prop/index definitions in
  // src/modules/decision-layer/schemas/cost-change-explanation.schema.ts
  const indexResults = await Promise.all([
    collection.createIndex(
      { userId: 1, anomalyTimestamp: -1 },
      { name: 'userId_1_anomalyTimestamp_-1' },
    ),
    collection.createIndex(
      { userId: 1, consumed: 1 },
      { name: 'userId_1_consumed_1' },
    ),
  ]);

  console.log('✓ Indexes synced on cost_change_explanations:', indexResults);

  await mongoose.disconnect();
  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
