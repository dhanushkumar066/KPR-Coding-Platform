import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Question } from '../models/Question.js';

/**
 * Run once, before the schema default for `ioMode` flips to `function`.
 *
 * Any question saved before the field existed has no `ioMode` stored, so a
 * changed default would silently reinterpret it as a function question with no
 * signature. Writing the value explicitly pins those to what they actually are.
 *
 *   npm run migrate:iomode
 */
async function main() {
  await connectDb();

  const missing = await Question.collection.updateMany(
    { ioMode: { $exists: false }, kind: { $ne: 'mcq' } },
    { $set: { ioMode: 'stdin' } }
  );
  console.log(`pinned ${missing.modifiedCount} legacy question(s) to ioMode="stdin"`);

  // A question marked `function` but carrying no signature is not usable as
  // one; it is a stdin question that was never converted.
  const halfConverted = await Question.collection.updateMany(
    {
      ioMode: 'function',
      kind: { $ne: 'mcq' },
      $or: [{ 'functionSpec.name': { $exists: false } }, { 'functionSpec.name': '' }],
    },
    { $set: { ioMode: 'stdin' } }
  );
  console.log(`repaired ${halfConverted.modifiedCount} question(s) with no signature`);

  const counts = await Question.aggregate([
    { $group: { _id: { kind: '$kind', ioMode: '$ioMode' }, n: { $sum: 1 } } },
    { $sort: { n: -1 } },
  ]);
  console.log('\ncurrent question mix:');
  for (const c of counts) {
    console.log(`  ${(c._id.kind || 'coding').padEnd(7)} ${(c._id.ioMode || '-').padEnd(9)} ${c.n}`);
  }

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[migrate] failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
