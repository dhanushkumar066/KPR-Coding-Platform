/**
 * The signature parser, in isolation.
 *
 * A teacher pastes one line and the whole question is shaped from it, so a
 * misread here produces a wrong stub for every student. Worth testing directly
 * rather than only through the editor.
 *
 *   npm run verify:signature
 */
import { parseSignature, inferType, inferMissingTypes } from '../services/codegen/parseSignature.js';

const CASES = [
  // --- Python -----------------------------------------------------------
  [
    'python, typed',
    'def twoSum(self, nums: List[int], target: int) -> List[int]:',
    { name: 'twoSum', returnType: 'int[]', params: [['nums', 'int[]'], ['target', 'int']] },
  ],
  [
    'python, drops self',
    'def solve(self, s: str) -> bool:',
    { name: 'solve', returnType: 'boolean', params: [['s', 'string']] },
  ],
  [
    'python, linked list',
    'def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:',
    { name: 'reverseList', returnType: 'list', params: [['head', 'list']] },
  ],
  [
    'python, void in place',
    'def moveZeroes(self, nums: List[int]) -> None:',
    { name: 'moveZeroes', returnType: 'void', params: [['nums', 'int[]']] },
  ],
  [
    'python, 2-D grid',
    'def countLetter(self, board: List[List[str]], target: str) -> int:',
    { name: 'countLetter', returnType: 'int', params: [['board', 'string[][]'], ['target', 'string']] },
  ],

  // --- Java -------------------------------------------------------------
  [
    'java, with modifier',
    'public int[] twoSum(int[] nums, int target) {',
    { name: 'twoSum', returnType: 'int[]', params: [['nums', 'int[]'], ['target', 'int']] },
  ],
  [
    'java, char board',
    'public void solveSudoku(char[][] board)',
    { name: 'solveSudoku', returnType: 'void', params: [['board', 'char[][]']] },
  ],
  [
    'java, tree',
    'public int maxDepth(TreeNode root)',
    { name: 'maxDepth', returnType: 'int', params: [['root', 'tree']] },
  ],
  [
    'java, String',
    'public String longestPalindrome(String s)',
    { name: 'longestPalindrome', returnType: 'string', params: [['s', 'string']] },
  ],

  // --- C++ --------------------------------------------------------------
  [
    'cpp, reference param',
    'vector<int> twoSum(vector<int>& nums, int target)',
    { name: 'twoSum', returnType: 'int[]', params: [['nums', 'int[]'], ['target', 'int']] },
  ],
  [
    'cpp, nested vector',
    'vector<vector<int>> threeSum(vector<int>& nums)',
    { name: 'threeSum', returnType: 'int[][]', params: [['nums', 'int[]']] },
  ],
  [
    'cpp, list pointer',
    'ListNode* reverseList(ListNode* head)',
    { name: 'reverseList', returnType: 'list', params: [['head', 'list']] },
  ],
  [
    'cpp, long long',
    'long long sum(long long a, long long b)',
    { name: 'sum', returnType: 'long', params: [['a', 'long'], ['b', 'long']] },
  ],

  // --- C: the size companions must not become parameters ----------------
  [
    'c, drops numsSize and returnSize',
    'int* twoSum(int* nums, int numsSize, int target, int* returnSize)',
    { name: 'twoSum', returnType: 'int[]', params: [['nums', 'int[]'], ['target', 'int']] },
  ],
  [
    'c, drops 2-D companions',
    'int** transpose(int** matrix, int matrixSize, int* matrixColSize, int* returnSize, int** returnColumnSizes)',
    { name: 'transpose', returnType: 'int[][]', params: [['matrix', 'int[][]']] },
  ],
  [
    'c, struct list',
    'struct ListNode* reverseList(struct ListNode* head)',
    { name: 'reverseList', returnType: 'list', params: [['head', 'list']] },
  ],

  // --- JavaScript: names only, types unknown ----------------------------
  [
    'javascript, untyped',
    'var twoSum = function(nums, target) {',
    { name: 'twoSum', params: [['nums', null], ['target', null]], unknown: ['nums', 'target'] },
  ],
];

let pass = 0;
let fail = 0;

for (const [label, source, want] of CASES) {
  const got = parseSignature(source);
  const problems = [];

  if (!got.ok) {
    problems.push(`rejected: ${got.error}`);
  } else {
    if (got.spec.name !== want.name) problems.push(`name ${got.spec.name} != ${want.name}`);
    if (want.returnType && got.spec.returnType !== want.returnType) {
      problems.push(`return ${got.spec.returnType} != ${want.returnType}`);
    }
    if (got.spec.params.length !== want.params.length) {
      problems.push(
        `${got.spec.params.length} params, wanted ${want.params.length} (${got.spec.params
          .map((p) => p.name)
          .join(', ')})`
      );
    } else {
      want.params.forEach(([n, t], i) => {
        const p = got.spec.params[i];
        if (p.name !== n) problems.push(`param ${i} name ${p.name} != ${n}`);
        if (t && p.type !== t) problems.push(`param ${n} type ${p.type} != ${t}`);
      });
    }
    if (want.unknown && got.unknown.join(',') !== want.unknown.join(',')) {
      problems.push(`unknown [${got.unknown}] != [${want.unknown}]`);
    }
  }

  if (problems.length) {
    fail += 1;
    console.log(`  FAIL  ${label.padEnd(34)} ${problems.join('; ')}`);
  } else {
    pass += 1;
    console.log(`  PASS  ${label}`);
  }
}

// --- Type inference from a test case ------------------------------------
console.log('\n  Inferring types from a test case');

const INFER = [
  ['[2,7,11,15]', 'int[]'],
  ['9', 'int'],
  ['"abc"', 'string'],
  ['true', 'boolean'],
  ['2.5', 'double'],
  ['[[1,2],[3,4]]', 'int[][]'],
  ['[["a"],["b"]]', 'string[][]'],
  ['9999999999', 'long'],
  ['not json', null],
];

for (const [text, want] of INFER) {
  const got = inferType(text);
  const ok = got === want;
  if (ok) pass += 1;
  else fail += 1;
  console.log(`    ${ok ? 'PASS' : 'FAIL'}  ${text.padEnd(16)} -> ${got}${ok ? '' : ` (wanted ${want})`}`);
}

// The JavaScript case above carries no types; the test case supplies them.
const js = parseSignature('var twoSum = function(nums, target) {');
const filled = inferMissingTypes(js.spec, '[2,7,11,15]\n9', '[0,1]');
const filledOk =
  filled.params[0].type === 'int[]' &&
  filled.params[1].type === 'int' &&
  filled.returnType === 'int[]';
if (filledOk) pass += 1;
else fail += 1;
console.log(
  `\n  ${filledOk ? 'PASS' : 'FAIL'}  untyped JS signature + test case -> ${filled.params
    .map((p) => `${p.name}:${p.type}`)
    .join(', ')} -> ${filled.returnType}`
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
