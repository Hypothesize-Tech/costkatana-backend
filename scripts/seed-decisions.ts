/*
 * Seeds demo decision-layer data for a given user so the UI has something
 * to surface immediately. Idempotent — re-running overwrites by id.
 *
 * Usage:
 *   MONGODB_URI=mongodb://... ts-node scripts/seed-decisions.ts --userId <id>
 *
 * What it creates:
 *   - 3 ProactiveSuggestions (cost_spike, model_overspend, caching_opportunity)
 *   - 1 CostAnomalyHistory entry (yesterday)
 *   - 1 CostChangeExplanation linked to that anomaly
 */

import 'dotenv/config';
import mongoose from 'mongoose';
import { randomUUID } from 'crypto';

async function main() {
  const userIdArg = process.argv.indexOf('--userId');
  if (userIdArg < 0 || !process.argv[userIdArg + 1]) {
    console.error('ERROR: Pass --userId <mongo-object-id>');
    process.exit(1);
  }
  const userId = process.argv[userIdArg + 1];

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

  const uid = new mongoose.Types.ObjectId(userId);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const inAWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  // 1. Proactive suggestions (pending, high-urgency)
  const suggestions = [
    {
      id: `demo-model-downgrade-${userId}`,
      userId: uid,
      type: 'model_downgrade',
      title: 'Switch heavy prompts from Claude Opus to Sonnet',
      description:
        'Your last 7 days show 412 tasks routed through claude-3-opus that benchmark within 2% on sonnet. Switching recovers ~$142/mo.',
      estimatedSavings: 142,
      savingsPercentage: 68,
      confidence: 0.82,
      context: {
        currentModel: 'claude-3-opus',
        suggestedModel: 'claude-3-sonnet',
        currentCost: 208,
        projectedCost: 66,
        pattern: 'high-volume-summarization',
        requests: 412,
      },
      actions: [
        { type: 'accept', label: 'Switch default to Sonnet' },
        { type: 'learn_more', label: 'See the benchmark' },
      ],
      priority: 'high',
      status: 'pending',
      createdAt: new Date(now.getTime() - 3 * 60 * 60 * 1000),
      expiresAt: inAWeek,
    },
    {
      id: `demo-caching-${userId}`,
      userId: uid,
      type: 'semantic_cache',
      title: 'Enable semantic cache on repeated prompts',
      description:
        'We detected 1,108 near-duplicate prompts in the last 7 days paying full inference cost. Caching recovers ~$38/week.',
      estimatedSavings: 38 * 4.33,
      savingsPercentage: 31,
      confidence: 0.76,
      context: {
        pattern: 'repeat-prompts',
        requests: 1108,
        currentCost: 120,
        projectedCost: 82,
      },
      actions: [{ type: 'accept', label: 'Turn on semantic cache' }],
      priority: 'medium',
      status: 'pending',
      createdAt: new Date(now.getTime() - 20 * 60 * 60 * 1000),
      expiresAt: inAWeek,
    },
    {
      id: `demo-compression-${userId}`,
      userId: uid,
      type: 'context_compression',
      title: 'Compress long prompts via Cortex',
      description:
        'Prompts above 4k tokens are 23% of traffic and 54% of spend. Enabling compression recovers ~$54/mo.',
      estimatedSavings: 54,
      savingsPercentage: 22,
      confidence: 0.68,
      context: {
        pattern: 'long-prompts',
        requests: 230,
      },
      actions: [{ type: 'accept', label: 'Enable Cortex compression' }],
      priority: 'medium',
      status: 'pending',
      createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000),
      expiresAt: inAWeek,
    },
  ];

  for (const s of suggestions) {
    await db.collection('proactive_suggestions').updateOne(
      { id: s.id },
      { $set: s },
      { upsert: true },
    );
  }
  console.log(`✓ Seeded ${suggestions.length} proactive suggestions`);

  // 2. Cost anomaly (yesterday) so the explainer has something to correlate
  const anomalyId = new mongoose.Types.ObjectId();
  await db.collection('costanomalyhistories').updateOne(
    { _id: anomalyId },
    {
      $set: {
        _id: anomalyId,
        connectionId: 'demo-connection',
        action: 'cost_spike',
        amount: 42.5,
        timestamp: yesterday,
        userId,
        metadata: { source: 'seed' },
        createdAt: yesterday,
        updatedAt: yesterday,
      },
    },
    { upsert: true },
  );
  console.log(`✓ Seeded 1 cost anomaly ($42.50 yesterday)`);

  // 3. CostChangeExplanation — manually join it to the anomaly so the
  // decision layer can surface "new_team_activity → cost_spike" without
  // waiting for the cron.
  await db.collection('cost_change_explanations').updateOne(
    { userId: uid, anomalyTimestamp: yesterday },
    {
      $set: {
        userId: uid,
        anomalyTimestamp: yesterday,
        pctChange: 235,
        absChangeUsd: 42.5,
        correlatedActivityType: 'team_member_added',
        correlationConfidence: 0.78,
        attribution: {
          model: 'claude-3-opus',
          team: 'growth',
        },
        evidence: {
          anomalyAction: 'cost_spike',
          topActivity: 'New member added to growth team',
          seeded: true,
        },
        consumed: false,
        createdAt: yesterday,
        updatedAt: now,
      },
    },
    { upsert: true },
  );
  console.log(`✓ Seeded 1 cost-change explanation (235% spike, growth team)`);

  // 4. Record an "optimization_applied" activity so the savings-proof strip
  // has something to render on day 1.
  const appliedAt = new Date(now.getTime() - 6 * 24 * 60 * 60 * 1000);
  await db.collection('activities').insertOne({
    userId: uid,
    type: 'optimization_applied',
    title: 'Applied demo optimization',
    metadata: {
      suggestionId: `demo-earlier-${randomUUID()}`,
      saved: 34,
      seeded: true,
    },
    createdAt: appliedAt,
    updatedAt: appliedAt,
  });
  console.log(`✓ Seeded 1 applied-optimization activity ($34 saved, 6d ago)`);

  await mongoose.disconnect();
  console.log('\nDone. Log in as user', userId, 'to see the decision layer.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
