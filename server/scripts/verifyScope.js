/**
 * Department isolation.
 *
 * A head of department sees their own department's work and nothing else. This
 * is the one rule in the whole application where a mistake is a privacy breach
 * rather than a bug: get it wrong and one department reads another's papers,
 * their students' marks, and their staff list — silently, with every screen
 * looking perfectly normal.
 *
 * The dangerous direction is widening. A filter that accidentally returns
 * everything looks like a working application to whoever is testing it; only
 * the department being read has any reason to complain, and they cannot see
 * that it is happening. So these check what is EXCLUDED, not just what is
 * included.
 *
 * Run: npm run verify:scope
 */
import mongoose from 'mongoose';
import { connectDb } from '../src/config/db.js';
import { User } from '../src/models/User.js';
import { visibleCreatorIds, ownershipFilter, canReach } from '../src/services/scope.js';

let pass = 0;
let fail = 0;

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) {
    pass += 1;
    console.log(`  ok   ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}\n         got  ${JSON.stringify(got)}\n         want ${JSON.stringify(want)}`);
  }
}

const PREFIX = 'scopecheck-';

async function main() {
  await connectDb();
  await User.deleteMany({ email: { $regex: `^${PREFIX}` } });

  const mk = (name, role, department) =>
    User.create({ email: `${PREFIX}${name}@x.test`, role, department, name });

  const cseHead = await mk('csehead', 'admin', 'CSE');
  const cseHead2 = await mk('csehead2', 'admin', 'CSE');
  const cseTeacher = await mk('cseteacher', 'teacher', 'CSE');
  const eceHead = await mk('ecehead', 'admin', 'ECE');
  const eceTeacher = await mk('eceteacher', 'teacher', 'ECE');
  const looseHead = await mk('loosehead', 'admin', ''); // never named a department
  const student = await mk('student', 'student', '');

  const ids = async (u) => (await visibleCreatorIds(u)).map(String).sort();
  const has = async (u, target) => (await ids(u)).includes(target._id.toString());

  console.log('\nA head sees their own department');
  // Asserted as "reaches each of these", not "is exactly these": this runs
  // against a database holding real staff too, and a fixture-only expectation
  // would fail for the wrong reason every time somebody adds a colleague.
  const cseVisible = await ids(cseHead);
  check(
    'CSE head reaches every CSE fixture',
    [cseHead, cseHead2, cseTeacher].every((u) => cseVisible.includes(u._id.toString())),
    true
  );
  check('and reaches their own work', await has(cseHead, cseHead), true);
  check('and their co-head’s', await has(cseHead, cseHead2), true);
  check('and their teachers’', await has(cseHead, cseTeacher), true);

  console.log('\nAnd nothing outside it');
  check('CSE head cannot reach the ECE head', await has(cseHead, eceHead), false);
  check('CSE head cannot reach an ECE teacher', await has(cseHead, eceTeacher), false);
  check('ECE head cannot reach a CSE teacher', await has(eceHead, cseTeacher), false);
  check('canReach() agrees across departments', await canReach(cseHead, eceTeacher._id), false);
  check('canReach() agrees within one', await canReach(cseHead, cseTeacher._id), true);

  console.log('\nA teacher sees only themselves');
  check('not their colleagues', await ids(cseTeacher), [cseTeacher._id.toString()]);
  check('not even their own head', await has(cseTeacher, cseHead), false);

  console.log('\nA missing department narrows, never widens');
  check(
    'a head who never named a department sees only their own work',
    await ids(looseHead),
    [looseHead._id.toString()]
  );
  check('and reaches no one else', await has(looseHead, cseTeacher), false);
  check('a student is scoped to themselves', await ids(student), [student._id.toString()]);

  console.log('\nThe filter is a filter, not a hole');
  const filter = await ownershipFilter(cseHead);
  check('always constrains createdBy', Object.keys(filter), ['createdBy']);
  check(
    'never returns an empty (match-everything) filter',
    JSON.stringify(filter) === '{}',
    false
  );
  check(
    'the id list is never empty, which would match nothing',
    (await visibleCreatorIds(cseHead)).length > 0,
    true
  );

  await User.deleteMany({ email: { $regex: `^${PREFIX}` } });
  await mongoose.disconnect();

  console.log(`\n${pass}/${pass + fail} passed`);
  process.exit(fail ? 1 : 0);
}

main().catch(async (err) => {
  console.error(err);
  await User.deleteMany({ email: { $regex: `^${PREFIX}` } }).catch(() => {});
  process.exit(1);
});
