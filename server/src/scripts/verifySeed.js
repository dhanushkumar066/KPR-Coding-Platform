import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { Question } from '../models/Question.js';
import { evaluate } from '../services/grader.js';
import { buildStub, FUNCTION_LANGUAGES } from '../services/codegen/index.js';

/**
 * Runs every seeded function-mode question against a correct solution in each
 * supported language, so the out-of-the-box content is known to work everywhere.
 *
 *   npm run verify:seed
 */

/** Correct solutions per seeded question, keyed by function name. */
const SOLUTIONS = {
  sum: {
    python: 'class Solution:\n    def sum(self, a: int, b: int) -> int:\n        return a + b\n',
    javascript: 'var sum = function(a, b) {\n    return a + b;\n};\n',
    java: 'class Solution {\n    public long sum(long a, long b) {\n        return a + b;\n    }\n}\n',
    cpp: 'class Solution {\npublic:\n    long long sum(long long a, long long b) {\n        return a + b;\n    }\n};\n',
    c: 'long long sum(long long a, long long b) {\n    return a + b;\n}\n',
  },
  countVowels: {
    python:
      "class Solution:\n    def countVowels(self, s: str) -> int:\n        return sum(1 for c in s if c in 'aeiou')\n",
    javascript:
      "var countVowels = function(s) {\n    return [...s].filter(c => 'aeiou'.includes(c)).length;\n};\n",
    java:
      'class Solution {\n    public int countVowels(String s) {\n        int n = 0;\n        for (char c : s.toCharArray()) if ("aeiou".indexOf(c) >= 0) n++;\n        return n;\n    }\n}\n',
    cpp:
      'class Solution {\npublic:\n    int countVowels(string s) {\n        int n = 0;\n        for (char c : s) if (string("aeiou").find(c) != string::npos) n++;\n        return n;\n    }\n};\n',
    c:
      'int countVowels(char* s) {\n    int n = 0;\n    for (int i = 0; s[i]; i++) if (strchr("aeiou", s[i])) n++;\n    return n;\n}\n',
  },
  reverseList: {
    python: `class Solution:
    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:
        prev = None
        while head:
            head.next, prev, head = prev, head, head.next
        return prev
`,
    javascript: `var reverseList = function(head) {
    let prev = null;
    while (head) {
        const next = head.next;
        head.next = prev;
        prev = head;
        head = next;
    }
    return prev;
};
`,
    java: `class Solution {
    public ListNode reverseList(ListNode head) {
        ListNode prev = null;
        while (head != null) {
            ListNode next = head.next;
            head.next = prev;
            prev = head;
            head = next;
        }
        return prev;
    }
}
`,
    cpp: `class Solution {
public:
    ListNode* reverseList(ListNode* head) {
        ListNode* prev = nullptr;
        while (head) {
            ListNode* next = head->next;
            head->next = prev;
            prev = head;
            head = next;
        }
        return prev;
    }
};
`,
    c: `struct ListNode* reverseList(struct ListNode* head) {
    struct ListNode* prev = NULL;
    while (head) {
        struct ListNode* next = head->next;
        head->next = prev;
        prev = head;
        head = next;
    }
    return prev;
}
`,
  },
  maxDepth: {
    python: `class Solution:
    def maxDepth(self, root: Optional[TreeNode]) -> int:
        if root is None:
            return 0
        return 1 + max(self.maxDepth(root.left), self.maxDepth(root.right))
`,
    javascript: `var maxDepth = function(root) {
    if (!root) return 0;
    return 1 + Math.max(maxDepth(root.left), maxDepth(root.right));
};
`,
    java: `class Solution {
    public int maxDepth(TreeNode root) {
        if (root == null) return 0;
        return 1 + Math.max(maxDepth(root.left), maxDepth(root.right));
    }
}
`,
    cpp: `class Solution {
public:
    int maxDepth(TreeNode* root) {
        if (!root) return 0;
        return 1 + max(maxDepth(root->left), maxDepth(root->right));
    }
};
`,
    c: `static int __depth(struct TreeNode* n) {
    if (!n) return 0;
    int l = __depth(n->left), r = __depth(n->right);
    return 1 + (l > r ? l : r);
}

int maxDepth(struct TreeNode* root) {
    return __depth(root);
}
`,
  },
};

async function main() {
  await connectDb();

  const questions = await Question.find({ kind: 'coding', ioMode: 'function' }).sort({ title: 1 });
  if (!questions.length) {
    console.log('No function-mode questions found. Run `npm run seed` first.');
    await mongoose.disconnect();
    return;
  }

  let pass = 0;
  let fail = 0;

  for (const q of questions) {
    const solutions = SOLUTIONS[q.functionSpec.name];
    console.log(`\n"${q.title}"  ${q.functionSpec.name}(...) -> ${q.functionSpec.returnType}`);

    if (!solutions) {
      console.log('  (no reference solutions in this script — skipped)');
      continue;
    }

    for (const lang of FUNCTION_LANGUAGES) {
      // Prove the stub is generated as well as the harness.
      const stub = buildStub(q.functionSpec, lang);
      if (!stub.trim()) {
        console.log(`  FAIL  ${lang.padEnd(11)} no stub generated`);
        fail++;
        continue;
      }

      const out = await evaluate({
        languageKey: lang,
        code: solutions[lang],
        cases: q.testCases,
        timeLimitSec: Math.max(q.timeLimitSec, 5),
        memoryLimitMb: q.memoryLimitMb,
        marks: q.marks,
        functionSpec: q.functionSpec,
      });

      const good = out.verdict === 'Accepted';
      if (good) pass++;
      else fail++;

      const why = good
        ? `${out.passedCount}/${out.totalCount}, ${out.score}/${q.marks}`
        : `${out.verdict} ${out.passedCount}/${out.totalCount} — ${(
            out.error ||
            out.results.find((r) => !r.passed)?.compileOutput ||
            out.results.find((r) => !r.passed)?.stderr ||
            ''
          )
            .split('\n')
            .slice(0, 2)
            .join(' | ')}`;
      console.log(`  ${good ? 'PASS' : 'FAIL'}  ${lang.padEnd(11)} ${why}`);
    }
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
}

main().catch(async (err) => {
  console.error('[verify:seed] failed:', err);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
