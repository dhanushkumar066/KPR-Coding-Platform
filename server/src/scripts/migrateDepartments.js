import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { User } from '../models/User.js';

/**
 * Puts existing staff into a department.
 *
 * Before departments existed, every teacher and admin was implicitly
 * college-wide. Now that access is scoped, staff with no department can still
 * see their own work but appear on no head's staff list and contribute to no
 * head's analytics — safe, because a missing value must never widen access, but
 * not what anyone wants left behind.
 *
 * The department is a parameter rather than a guess: nothing in the data says
 * which department an existing account belongs to, and inventing one would
 * quietly file a semester of results under the wrong head.
 *
 *   npm run migrate:departments -- CSE
 *   npm run migrate:departments            (defaults to "General")
 *
 * Run it again with a different name later, or move individuals from the head's
 * staff screen — this only ever fills in blanks, and never moves anyone who has
 * already been placed.
 */
async function main() {
  const department = (process.argv[2] || 'General').trim();
  await connectDb();

  const orphaned = await User.find({
    role: { $in: ['teacher', 'admin'] },
    $or: [{ department: '' }, { department: { $exists: false } }],
  }).select('email role');

  if (!orphaned.length) {
    console.log('every member of staff already has a department — nothing to do');
    await mongoose.disconnect();
    return;
  }

  console.log(`placing ${orphaned.length} member(s) of staff into "${department}":`);
  for (const u of orphaned) console.log(`  ${u.email} (${u.role})`);

  const result = await User.collection.updateMany(
    {
      role: { $in: ['teacher', 'admin'] },
      $or: [{ department: '' }, { department: { $exists: false } }],
    },
    { $set: { department } }
  );
  console.log(`\ndone — ${result.modifiedCount} updated`);

  const heads = await User.countDocuments({ department, role: 'admin' });
  if (!heads) {
    console.log(
      `\nNote: "${department}" has no head yet. Add one to ADMIN_EMAILS and have them sign in, ` +
        'or promote someone from an existing head\'s staff screen.'
    );
  }

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
