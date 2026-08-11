/**
 * Linked-list and binary-tree questions, in every language, through the real
 * grader.
 *
 * These are the types that make a LeetCode-style DSA paper possible: the
 * teacher writes `[1,2,3]` in a test case and the student's function receives
 * actual nodes. This script is the proof that the round trip — array to nodes,
 * nodes back to array — agrees across all five languages.
 */
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { evaluate } from '../services/grader.js';
import { FUNCTION_LANGUAGES } from '../services/codegen/index.js';

const SUITES = [
  {
    label: 'reverseList (list -> list)',
    spec: {
      name: 'reverseList',
      returnType: 'list',
      params: [{ name: 'head', type: 'list' }],
    },
    cases: [
      { input: '[1,2,3,4,5]', expectedOutput: '[5,4,3,2,1]', points: 1, isSample: true },
      { input: '[1,2]', expectedOutput: '[2,1]', points: 1 },
      // The empty list is where a naive implementation dereferences null.
      { input: '[]', expectedOutput: '[]', points: 1 },
    ],
    solutions: {
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
  },
  {
    label: 'maxDepth (tree -> int)',
    spec: {
      name: 'maxDepth',
      returnType: 'int',
      params: [{ name: 'root', type: 'tree' }],
    },
    cases: [
      { input: '[3,9,20,null,null,15,7]', expectedOutput: '3', points: 1, isSample: true },
      { input: '[1,null,2]', expectedOutput: '2', points: 1 },
      { input: '[]', expectedOutput: '0', points: 1 },
    ],
    solutions: {
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
  },
  {
    label: 'invertTree (tree -> tree)',
    spec: {
      name: 'invertTree',
      returnType: 'tree',
      params: [{ name: 'root', type: 'tree' }],
    },
    cases: [
      {
        input: '[4,2,7,1,3,6,9]',
        expectedOutput: '[4,7,2,9,6,3,1]',
        points: 1,
        isSample: true,
      },
      { input: '[2,1,3]', expectedOutput: '[2,3,1]', points: 1 },
      { input: '[]', expectedOutput: '[]', points: 1 },
    ],
    solutions: {
      python: `class Solution:
    def invertTree(self, root: Optional[TreeNode]) -> Optional[TreeNode]:
        if root is None:
            return None
        root.left, root.right = self.invertTree(root.right), self.invertTree(root.left)
        return root
`,
      javascript: `var invertTree = function(root) {
    if (!root) return null;
    const l = invertTree(root.left);
    root.left = invertTree(root.right);
    root.right = l;
    return root;
};
`,
      java: `class Solution {
    public TreeNode invertTree(TreeNode root) {
        if (root == null) return null;
        TreeNode l = invertTree(root.left);
        root.left = invertTree(root.right);
        root.right = l;
        return root;
    }
}
`,
      cpp: `class Solution {
public:
    TreeNode* invertTree(TreeNode* root) {
        if (!root) return nullptr;
        TreeNode* l = invertTree(root->left);
        root->left = invertTree(root->right);
        root->right = l;
        return root;
    }
};
`,
      c: `struct TreeNode* invertTree(struct TreeNode* root) {
    if (!root) return NULL;
    struct TreeNode* l = invertTree(root->left);
    root->left = invertTree(root->right);
    root->right = l;
    return root;
}
`,
    },
  },
  {
    // LeetCode 237, posed exactly as LeetCode poses it: the custom test supplies
    // the whole list plus the value identifying the node, the student's function
    // receives only that node, and the answer is the list afterwards.
    label: 'deleteNode (void, in-place on a harness-only list)',
    spec: {
      name: 'deleteNode',
      returnType: 'void',
      outputParam: 'head',
      params: [
        { name: 'head', type: 'list', harnessOnly: true },
        { name: 'node', type: 'node', of: 'head' },
      ],
    },
    cases: [
      { input: '[4,5,1,9]\n5', expectedOutput: '[4,1,9]', points: 1, isSample: true },
      { input: '[4,5,1,9]\n1', expectedOutput: '[4,5,9]', points: 1 },
      { input: '[1,2,6,3,4,5,6]\n6', expectedOutput: '[1,2,3,4,5,6]', points: 1 },
    ],
    solutions: {
      python: `class Solution:
    def deleteNode(self, node: ListNode) -> None:
        node.val = node.next.val
        node.next = node.next.next
`,
      javascript: `var deleteNode = function(node) {
    node.val = node.next.val;
    node.next = node.next.next;
};
`,
      java: `class Solution {
    public void deleteNode(ListNode node) {
        node.val = node.next.val;
        node.next = node.next.next;
    }
}
`,
      cpp: `class Solution {
public:
    void deleteNode(ListNode* node) {
        node->val = node->next->val;
        node->next = node->next->next;
    }
};
`,
      c: `void deleteNode(struct ListNode* node) {
    node->val = node->next->val;
    node->next = node->next->next;
}
`,
    },
  },
  {
    // The other half of the void family: an array mutated in place.
    label: 'moveZeroes (void, in-place on an array)',
    spec: {
      name: 'moveZeroes',
      returnType: 'void',
      outputParam: 'nums',
      params: [{ name: 'nums', type: 'int[]' }],
    },
    cases: [
      { input: '[0,1,0,3,12]', expectedOutput: '[1,3,12,0,0]', points: 1, isSample: true },
      { input: '[0]', expectedOutput: '[0]', points: 1 },
      { input: '[1,2,3]', expectedOutput: '[1,2,3]', points: 1 },
    ],
    solutions: {
      python: `class Solution:
    def moveZeroes(self, nums: List[int]) -> None:
        j = 0
        for i in range(len(nums)):
            if nums[i] != 0:
                nums[j], nums[i] = nums[i], nums[j]
                j += 1
`,
      javascript: `var moveZeroes = function(nums) {
    let j = 0;
    for (let i = 0; i < nums.length; i++) {
        if (nums[i] !== 0) {
            [nums[j], nums[i]] = [nums[i], nums[j]];
            j++;
        }
    }
};
`,
      java: `class Solution {
    public void moveZeroes(int[] nums) {
        int j = 0;
        for (int i = 0; i < nums.length; i++) {
            if (nums[i] != 0) {
                int t = nums[j]; nums[j] = nums[i]; nums[i] = t;
                j++;
            }
        }
    }
}
`,
      cpp: `class Solution {
public:
    void moveZeroes(vector<int>& nums) {
        int j = 0;
        for (int i = 0; i < (int)nums.size(); i++) {
            if (nums[i] != 0) swap(nums[j++], nums[i]);
        }
    }
};
`,
      c: `void moveZeroes(int* nums, int numsSize) {
    int j = 0;
    for (int i = 0; i < numsSize; i++) {
        if (nums[i] != 0) {
            int t = nums[j]; nums[j] = nums[i]; nums[i] = t;
            j++;
        }
    }
}
`,
    },
  },
];

await connectDb();

let pass = 0;
let fail = 0;

for (const suite of SUITES) {
  console.log(`\n  ${suite.label}`);

  for (const lang of FUNCTION_LANGUAGES) {
    const out = await evaluate({
      languageKey: lang,
      code: suite.solutions[lang],
      cases: suite.cases,
      timeLimitSec: 5,
      memoryLimitMb: 256,
      marks: 10,
      functionSpec: suite.spec,
    });

    const good = out.verdict === 'Accepted' && out.passedCount === suite.cases.length;
    if (good) pass++;
    else fail++;

    const firstBad = out.results.find((r) => !r.passed);
    const detail = good
      ? `${out.passedCount}/${out.totalCount}, ${out.maxTimeMs}ms`
      : `${out.verdict} ${out.passedCount}/${out.totalCount} — ${(
          out.error ||
          firstBad?.compileOutput ||
          firstBad?.stderr ||
          `got ${JSON.stringify(firstBad?.stdout)}`
        )
          .split('\n')
          .slice(0, 3)
          .join(' | ')}`;

    console.log(`    ${good ? 'PASS' : 'FAIL'}  ${lang.padEnd(11)} ${detail}`);
  }
}

const total = SUITES.length * FUNCTION_LANGUAGES.length;
console.log(`\n  ${pass} of ${total} node-type checks passing\n`);
await mongoose.disconnect();
process.exit(fail ? 1 : 0);
