import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Question } from '../models/Question.js';

/**
 * Backfill `style` on questions written before the GATE workspace existed.
 *
 * The list query already treats a missing `style` as 'standard', so nothing is
 * broken without this — but the absent field is a trap worth closing. Reading a
 * legacy question back reports `style: 'standard'`, because Mongoose applies the
 * schema default on hydration, while the document on disk has no such field.
 * Any future query written against it would look correct in testing and quietly
 * match nothing.
 *
 *   npm run migrate:style
 */
async function main() {
  await connectDb();

  const filled = await Question.collection.updateMany(
    { style: { $exists: false } },
    { $set: { style: 'standard' } }
  );
  console.log(`pinned ${filled.modifiedCount} legacy question(s) to style="standard"`);

  const sectioned = await Question.collection.updateMany(
    { section: { $exists: false } },
    { $set: { section: '' } }
  );
  console.log(`gave ${sectioned.modifiedCount} question(s) an empty section`);

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
