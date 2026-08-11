import mongoose from 'mongoose';
import { env } from '../config/env.js';
import { connectDb } from '../config/db.js';
import { User } from '../models/User.js';
import { Question } from '../models/Question.js';
import { Test } from '../models/Test.js';

/**
 * Creates a teacher, two students, two questions and one live test so the whole
 * flow can be exercised immediately. Safe to re-run: it upserts by a stable key
 * and never touches existing attempts or submissions.
 */

const TEACHER_EMAIL = 'teacher@college.edu';
const STUDENT_EMAILS = ['student@college.edu', 'student2@college.edu'];

/**
 * Both seeded questions use function-signature mode — the platform default —
 * so the out-of-the-box experience is the LeetCode one: the student opens onto
 * a stub with the arguments in scope and returns an answer.
 *
 * Test-case inputs are therefore one JSON value per argument, per line.
 */
const SUM_QUESTION = {
  kind: 'coding',
  ioMode: 'function',
  functionSpec: {
    name: 'sum',
    returnType: 'long',
    params: [
      { name: 'a', type: 'long' },
      { name: 'b', type: 'long' },
    ],
  },
  title: 'Sum of Two Numbers',
  statement:
    'Given two integers **a** and **b**, return their sum.\n\nThis is a warm-up problem — it exists so you can get used to the editor before the real questions. You do not read input or print anything; just return the answer.',
  constraints: '-10^9 ≤ a, b ≤ 10^9',
  difficulty: 'easy',
  tags: ['warmup', 'math'],
  marks: 10,
  timeLimitSec: 2,
  memoryLimitMb: 256,
  testCases: [
    { input: '2\n3', expectedOutput: '5', points: 1, isSample: true, explanation: '2 + 3 = 5' },
    { input: '-4\n9', expectedOutput: '5', points: 1, isSample: true, explanation: '-4 + 9 = 5' },
    { input: '0\n0', expectedOutput: '0', points: 1 },
    { input: '1000000000\n1000000000', expectedOutput: '2000000000', points: 2 },
    { input: '-1000000000\n-1000000000', expectedOutput: '-2000000000', points: 2 },
    { input: '7\n-7', expectedOutput: '0', points: 1 },
  ],
  referenceSolution: {
    language: 'python',
    code: 'class Solution:\n    def sum(self, a: int, b: int) -> int:\n        return a + b\n',
  },
};

const COUNT_VOWELS_QUESTION = {
  kind: 'coding',
  ioMode: 'function',
  functionSpec: {
    name: 'countVowels',
    returnType: 'int',
    params: [{ name: 's', type: 'string' }],
  },
  title: 'Count the Vowels',
  statement:
    'Given a string **s** of lowercase letters and spaces, return how many vowels (**a, e, i, o, u**) it contains.\n\nCount only the five vowels listed.',
  constraints: 's has at most 10^5 characters and contains only lowercase letters and spaces.',
  difficulty: 'easy',
  tags: ['strings'],
  marks: 15,
  timeLimitSec: 2,
  memoryLimitMb: 256,
  testCases: [
    { input: '"hello world"', expectedOutput: '3', points: 1, isSample: true, explanation: 'e, o, o' },
    { input: '"xyz"', expectedOutput: '0', points: 1, isSample: true, explanation: 'no vowels' },
    { input: '"aeiou"', expectedOutput: '5', points: 2 },
    { input: '"the quick brown fox jumps over the lazy dog"', expectedOutput: '11', points: 2 },
    { input: '"a"', expectedOutput: '1', points: 1 },
  ],
  referenceSolution: {
    language: 'python',
    code: "class Solution:\n    def countVowels(self, s: str) -> int:\n        return sum(1 for c in s if c in 'aeiou')\n",
  },
};

/**
 * Linked-list demo. The test cases are plain arrays — the harness turns them
 * into real `ListNode` chains before calling the student's function, exactly as
 * LeetCode does, so a DSA question needs no input parsing from the student.
 */
const REVERSE_LIST_QUESTION = {
  kind: 'coding',
  ioMode: 'function',
  functionSpec: {
    name: 'reverseList',
    returnType: 'list',
    params: [{ name: 'head', type: 'list' }],
  },
  title: 'Reverse a Linked List',
  statement:
    'Given the **head** of a singly linked list, reverse the list and return the head of the reversed list.\n\nYou are given the list as nodes, not as an array — the node definition is in the comment above your function. An empty list is valid input.',
  constraints: 'The list has 0 to 5000 nodes. -5000 ≤ Node.val ≤ 5000',
  difficulty: 'easy',
  tags: ['linked-list'],
  marks: 20,
  timeLimitSec: 2,
  memoryLimitMb: 256,
  testCases: [
    {
      input: '[1,2,3,4,5]',
      expectedOutput: '[5,4,3,2,1]',
      points: 2,
      isSample: true,
      explanation: '1→2→3→4→5 becomes 5→4→3→2→1',
    },
    { input: '[1,2]', expectedOutput: '[2,1]', points: 1, isSample: true },
    { input: '[]', expectedOutput: '[]', points: 2, explanation: 'the empty list reverses to itself' },
    { input: '[7]', expectedOutput: '[7]', points: 1 },
    { input: '[-3,0,3,9]', expectedOutput: '[9,3,0,-3]', points: 2 },
  ],
  referenceSolution: {
    language: 'python',
    code: `class Solution:
    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:
        prev = None
        while head:
            head.next, prev, head = prev, head, head.next
        return prev
`,
  },
};

/** Binary-tree demo. Test cases use LeetCode's level-order-with-nulls format. */
const MAX_DEPTH_QUESTION = {
  kind: 'coding',
  ioMode: 'function',
  functionSpec: {
    name: 'maxDepth',
    returnType: 'int',
    params: [{ name: 'root', type: 'tree' }],
  },
  title: 'Maximum Depth of a Binary Tree',
  statement:
    "Given the **root** of a binary tree, return its maximum depth — the number of nodes along the longest path from the root down to the furthest leaf.\n\nThe tree is given to you as nodes. In the test cases it is written in level order with `null` for a missing child, so `[3,9,20,null,null,15,7]` is a root of 3 whose children are 9 and 20, and 20's children are 15 and 7.",
  constraints: 'The tree has 0 to 10^4 nodes. -100 ≤ Node.val ≤ 100',
  difficulty: 'easy',
  tags: ['tree', 'recursion'],
  marks: 20,
  timeLimitSec: 2,
  memoryLimitMb: 256,
  testCases: [
    {
      input: '[3,9,20,null,null,15,7]',
      expectedOutput: '3',
      points: 2,
      isSample: true,
      explanation: 'the longest path is 3 → 20 → 15',
    },
    { input: '[1,null,2]', expectedOutput: '2', points: 1, isSample: true },
    { input: '[]', expectedOutput: '0', points: 2, explanation: 'an empty tree has depth 0' },
    { input: '[0]', expectedOutput: '1', points: 1 },
    { input: '[1,2,3,4,null,null,5,6]', expectedOutput: '4', points: 2 },
  ],
  referenceSolution: {
    language: 'python',
    code: `class Solution:
    def maxDepth(self, root: Optional[TreeNode]) -> int:
        if root is None:
            return 0
        return 1 + max(self.maxDepth(root.left), self.maxDepth(root.right))
`,
  },
};

async function upsertUser(email, role) {
  const existing = await User.findOne({ email });
  if (existing) return existing;
  return User.create({ email, name: email.split('@')[0], role });
}

async function upsertQuestion(spec, teacherId) {
  const existing = await Question.findOne({ title: spec.title, createdBy: teacherId });
  if (!existing) return Question.create({ ...spec, createdBy: teacherId });

  // The seed owns its demo questions, so re-running it brings them up to date —
  // including converting the older stdin versions to function mode.
  existing.set(spec);
  if (spec.ioMode === 'function') {
    existing.inputFormat = '';
    existing.outputFormat = '';
    existing.starterCode = new Map();
  }
  await existing.save();
  return existing;
}

async function main() {
  await connectDb();

  const teacher = await upsertUser(TEACHER_EMAIL, 'teacher');
  const students = await Promise.all(STUDENT_EMAILS.map((e) => upsertUser(e, 'student')));

  const q1 = await upsertQuestion(SUM_QUESTION, teacher._id);
  const q2 = await upsertQuestion(COUNT_VOWELS_QUESTION, teacher._id);
  const q3 = await upsertQuestion(REVERSE_LIST_QUESTION, teacher._id);
  const q4 = await upsertQuestion(MAX_DEPTH_QUESTION, teacher._id);

  const now = new Date();
  const testTitle = 'Practice Test — Programming Basics';
  let test = await Test.findOne({ title: testTitle, createdBy: teacher._id });

  const payload = {
    title: testTitle,
    description:
      'A short warm-up test so you can get used to the exam interface before the real thing.',
    // Open now, and stays open for a week.
    startAt: new Date(now.getTime() - 5 * 60_000),
    endAt: new Date(now.getTime() + 7 * 24 * 60 * 60_000),
    durationMinutes: 60,
    allowedLanguages: ['python', 'javascript', 'cpp', 'c', 'java'],
    questions: [q1._id, q2._id, q3._id, q4._id],
    warningLimit: 3,
    graceMs: 2500,
    allowlist: STUDENT_EMAILS,
    status: 'published',
    isPractice: true,
    createdBy: teacher._id,
  };

  if (test) {
    test.set(payload);
    await test.save();
  } else {
    test = await Test.create(payload);
  }

  console.log('\n  Seeded.\n');
  console.log(`  Teacher : ${teacher.email}`);
  console.log(`  Students: ${students.map((s) => s.email).join(', ')}`);
  console.log(`  Test    : "${test.title}" (${test.status}, ${test.questions.length} questions)`);
  console.log(`\n  Executor: ${env.executor}`);
  console.log('  Sign in with the dev login on the sign-in page using any email above.\n');

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error('[seed] failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
