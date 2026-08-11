import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { User } from '../models/User.js';
import { Test } from '../models/Test.js';

/**
 * Read-only answer to "why can't my student see this test?".
 *
 * A student's list comes from exactly three conditions (§5), and when a test is
 * missing it is almost always one of them. This prints each condition per test
 * per student so the failing one is obvious.
 *
 *   npm run diagnose
 */

const tick = (ok) => (ok ? 'yes' : 'NO ');

async function main() {
  await connectDb();

  const users = await User.find().sort({ role: 1, email: 1 });
  const tests = await Test.find().sort({ createdAt: 1 });
  const students = users.filter((u) => u.role === 'student');
  const now = new Date();

  console.log('\n=== Accounts ===');
  if (!users.length) console.log('  (none — nobody has signed in yet)');
  for (const u of users) console.log(`  ${u.role.padEnd(8)} ${u.email}`);

  console.log('\n=== Tests ===');
  if (!tests.length) console.log('  (none)');

  for (const t of tests) {
    const published = t.status === 'published';
    const open = now >= t.startAt && now <= t.endAt;

    console.log(`\n  "${t.title}"`);
    console.log(`    published : ${tick(published)}${published ? '' : `  <-- status is "${t.status}"; students only ever see published tests`}`);
    console.log(`    window    : ${t.startAt.toLocaleString()}  ->  ${t.endAt.toLocaleString()}`);
    console.log(`    open now  : ${tick(open)}${open ? '' : `  <-- now is ${now.toLocaleString()}`}`);
    console.log(`    questions : ${t.questions.length}${t.questions.length ? '' : '  <-- a test with no questions cannot be published'}`);
    console.log(`    allowlist : ${t.allowlist.length ? t.allowlist.join(', ') : '(empty)  <-- nobody can sit this test'}`);

    if (!students.length) {
      console.log('    (no student accounts exist yet — a student appears here once they sign in)');
      continue;
    }

    console.log('    visible to:');
    for (const s of students) {
      const onList = t.allowlist.includes(s.email);
      const visible = published && onList;
      const why = visible
        ? open
          ? 'listed'
          : 'listed, but shown as closed/upcoming until the window opens'
        : [!published && 'not published', !onList && 'not on the allowlist']
            .filter(Boolean)
            .join(' + ');
      console.log(`      ${tick(visible)} ${s.email.padEnd(28)} ${why}`);
    }
  }

  // The most common real-world mistake: the address on the allowlist has never
  // signed in, so it looks "added" but belongs to no account.
  const knownEmails = new Set(users.map((u) => u.email));
  const orphans = [
    ...new Set(tests.flatMap((t) => t.allowlist).filter((e) => !knownEmails.has(e))),
  ];
  if (orphans.length) {
    console.log('\n=== Allowlisted addresses with no account yet ===');
    console.log('  (fine — an account is created the first time they sign in)');
    for (const e of orphans) console.log(`  ${e}`);
  }

  console.log('');
  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[diagnose] failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
