/**
 * Every language, one function-signature question, through the real grader.
 * Proves the promise: a question works in every language the platform offers.
 */
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { evaluate } from '../services/grader.js';
import { FUNCTION_LANGUAGES } from '../services/codegen/index.js';

const SPEC = {
  name: 'twoSum',
  returnType: 'int[]',
  params: [
    { name: 'nums', type: 'int[]' },
    { name: 'target', type: 'int' },
  ],
};

const CASES = [
  { input: '[2,7,11,15]\n9', expectedOutput: '[0,1]', points: 1, isSample: true },
  { input: '[3,2,4]\n6', expectedOutput: '[1,2]', points: 1 },
  { input: '[3,3]\n6', expectedOutput: '[0,1]', points: 1 },
];

const SOLUTIONS = {
  python: `class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        seen = {}
        for i, v in enumerate(nums):
            if target - v in seen:
                return [seen[target - v], i]
            seen[v] = i
        return [-1, -1]
`,
  javascript: `var twoSum = function(nums, target) {
    const seen = new Map();
    for (let i = 0; i < nums.length; i++) {
        if (seen.has(target - nums[i])) return [seen.get(target - nums[i]), i];
        seen.set(nums[i], i);
    }
    return [-1, -1];
};
`,
  java: `class Solution {
    public int[] twoSum(int[] nums, int target) {
        HashMap<Integer,Integer> m = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            if (m.containsKey(target - nums[i])) return new int[]{m.get(target - nums[i]), i};
            m.put(nums[i], i);
        }
        return new int[]{-1,-1};
    }
}
`,
  cpp: `class Solution {
public:
    vector<int> twoSum(vector<int> nums, int target) {
        unordered_map<int,int> seen;
        for (int i = 0; i < (int)nums.size(); i++) {
            if (seen.count(target - nums[i])) return {seen[target - nums[i]], i};
            seen[nums[i]] = i;
        }
        return {-1,-1};
    }
};
`,
  c: `int* twoSum(int* nums, int numsSize, int target, int* returnSize) {
    for (int i = 0; i < numsSize; i++)
        for (int j = i + 1; j < numsSize; j++)
            if (nums[i] + nums[j] == target) {
                int* r = (int*)malloc(sizeof(int) * 2);
                r[0] = i; r[1] = j; *returnSize = 2; return r;
            }
    *returnSize = 0;
    return (int*)malloc(1);
}
`,
};

await connectDb();

let pass = 0;
let fail = 0;

for (const lang of FUNCTION_LANGUAGES) {
  const out = await evaluate({
    languageKey: lang,
    code: SOLUTIONS[lang],
    cases: CASES,
    timeLimitSec: 5,
    memoryLimitMb: 256,
    marks: 10,
    functionSpec: SPEC,
  });

  const good = out.verdict === 'Accepted' && out.passedCount === CASES.length;
  if (good) pass++;
  else fail++;

  const detail = good
    ? `${out.passedCount}/${out.totalCount}, ${out.score}/10, ${out.maxTimeMs}ms`
    : `${out.verdict} ${out.passedCount}/${out.totalCount} — ${(
        out.error ||
        out.results.find((r) => !r.passed)?.compileOutput ||
        out.results.find((r) => !r.passed)?.stderr ||
        ''
      )
        .split('\n')
        .slice(0, 2)
        .join(' | ')}`;

  console.log(`${good ? 'PASS' : 'FAIL'}  ${lang.padEnd(11)} ${detail}`);
}

console.log(`\n  ${pass} of ${FUNCTION_LANGUAGES.length} languages working`);
await mongoose.disconnect();
process.exit(fail ? 1 : 0);
