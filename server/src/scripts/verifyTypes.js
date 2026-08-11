/**
 * The wider type matrix, through the real grader, in every language.
 *
 * Covers the types added for grid and floating-point problems — `char`,
 * `char[]`, `char[][]`, `double` and friends — because these are the ones where
 * the five languages are most likely to disagree about how a value is written.
 *
 *   npm run verify:types
 */
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { evaluate } from '../services/grader.js';
import { FUNCTION_LANGUAGES } from '../services/codegen/index.js';

const SUITES = [
  {
    // LeetCode 344, which is a char[] in-place problem.
    label: 'reverseString (void, char[] in place)',
    spec: {
      name: 'reverseString',
      returnType: 'void',
      outputParam: 's',
      params: [{ name: 's', type: 'char[]' }],
    },
    cases: [
      {
        input: '["h","e","l","l","o"]',
        expectedOutput: '["o","l","l","e","h"]',
        points: 1,
        isSample: true,
      },
      { input: '["a"]', expectedOutput: '["a"]', points: 1 },
    ],
    solutions: {
      python: `class Solution:
    def reverseString(self, s: List[str]) -> None:
        s.reverse()
`,
      javascript: `var reverseString = function(s) {
    s.reverse();
};
`,
      java: `class Solution {
    public void reverseString(char[] s) {
        for (int i = 0, j = s.length - 1; i < j; i++, j--) {
            char t = s[i]; s[i] = s[j]; s[j] = t;
        }
    }
}
`,
      cpp: `class Solution {
public:
    void reverseString(vector<char>& s) {
        reverse(s.begin(), s.end());
    }
};
`,
      c: `void reverseString(char* s, int sSize) {
    for (int i = 0, j = sSize - 1; i < j; i++, j--) {
        char t = s[i]; s[i] = s[j]; s[j] = t;
    }
}
`,
    },
  },
  {
    // The Sudoku/Word Search shape: a board of characters.
    label: 'countLetter (char[][] grid -> int)',
    spec: {
      name: 'countLetter',
      returnType: 'int',
      params: [
        { name: 'board', type: 'char[][]' },
        { name: 'target', type: 'char' },
      ],
    },
    cases: [
      {
        input: '[["5","3","."],[".","7","."],["6",".","5"]]\n"5"',
        expectedOutput: '2',
        points: 1,
        isSample: true,
      },
      { input: '[[".","."],[".","."]]\n"."', expectedOutput: '4', points: 1 },
      { input: '[]\n"x"', expectedOutput: '0', points: 1 },
    ],
    solutions: {
      python: `class Solution:
    def countLetter(self, board: List[List[str]], target: str) -> int:
        return sum(row.count(target) for row in board)
`,
      javascript: `var countLetter = function(board, target) {
    let n = 0;
    for (const row of board) for (const c of row) if (c === target) n++;
    return n;
};
`,
      java: `class Solution {
    public int countLetter(char[][] board, char target) {
        int n = 0;
        for (char[] row : board) for (char c : row) if (c == target) n++;
        return n;
    }
}
`,
      cpp: `class Solution {
public:
    int countLetter(vector<vector<char>> board, char target) {
        int n = 0;
        for (auto& row : board) for (char c : row) if (c == target) n++;
        return n;
    }
};
`,
      c: `int countLetter(char** board, int boardSize, int* boardColSize, char target) {
    int n = 0;
    for (int i = 0; i < boardSize; i++)
        for (int j = 0; j < boardColSize[i]; j++)
            if (board[i][j] == target) n++;
    return n;
}
`,
    },
  },
  {
    // LeetCode 4's return type. The languages all print floats differently, so
    // this is really a test that the tolerance path works end to end.
    label: 'findMedian (int[] -> double)',
    spec: {
      name: 'findMedian',
      returnType: 'double',
      params: [{ name: 'nums', type: 'int[]' }],
    },
    cases: [
      { input: '[1,3,4,2]', expectedOutput: '2.5', points: 1, isSample: true },
      { input: '[1,2,3]', expectedOutput: '2.0', points: 1 },
      { input: '[7]', expectedOutput: '7', points: 1, explanation: 'written without a decimal' },
    ],
    solutions: {
      python: `class Solution:
    def findMedian(self, nums: List[int]) -> float:
        nums.sort()
        n = len(nums)
        return nums[n // 2] if n % 2 else (nums[n // 2 - 1] + nums[n // 2]) / 2
`,
      javascript: `var findMedian = function(nums) {
    nums.sort((a, b) => a - b);
    const n = nums.length;
    return n % 2 ? nums[(n - 1) / 2] : (nums[n / 2 - 1] + nums[n / 2]) / 2;
};
`,
      java: `class Solution {
    public double findMedian(int[] nums) {
        java.util.Arrays.sort(nums);
        int n = nums.length;
        return n % 2 == 1 ? nums[n / 2] : (nums[n / 2 - 1] + nums[n / 2]) / 2.0;
    }
}
`,
      cpp: `class Solution {
public:
    double findMedian(vector<int> nums) {
        sort(nums.begin(), nums.end());
        int n = nums.size();
        return n % 2 ? (double)nums[n / 2] : (nums[n / 2 - 1] + nums[n / 2]) / 2.0;
    }
};
`,
      c: `static int __cmp(const void* a, const void* b) {
    int x = *(const int*)a, y = *(const int*)b;
    return (x > y) - (x < y);
}

double findMedian(int* nums, int numsSize) {
    qsort(nums, numsSize, sizeof(int), __cmp);
    if (numsSize % 2) return nums[numsSize / 2];
    return (nums[numsSize / 2 - 1] + nums[numsSize / 2]) / 2.0;
}
`,
    },
  },
  {
    label: 'scaleRows (double[][] -> double[][])',
    spec: {
      name: 'scaleRows',
      returnType: 'double[][]',
      params: [{ name: 'grid', type: 'double[][]' }],
    },
    cases: [
      {
        input: '[[1.5,2.5],[3.0,4.0]]',
        expectedOutput: '[[3,5],[6,8]]',
        points: 1,
        isSample: true,
      },
      { input: '[[0.1]]', expectedOutput: '[[0.2]]', points: 1 },
    ],
    solutions: {
      python: `class Solution:
    def scaleRows(self, grid: List[List[float]]) -> List[List[float]]:
        return [[v * 2 for v in row] for row in grid]
`,
      javascript: `var scaleRows = function(grid) {
    return grid.map(row => row.map(v => v * 2));
};
`,
      java: `class Solution {
    public double[][] scaleRows(double[][] grid) {
        double[][] out = new double[grid.length][];
        for (int i = 0; i < grid.length; i++) {
            out[i] = new double[grid[i].length];
            for (int j = 0; j < grid[i].length; j++) out[i][j] = grid[i][j] * 2;
        }
        return out;
    }
}
`,
      cpp: `class Solution {
public:
    vector<vector<double>> scaleRows(vector<vector<double>> grid) {
        for (auto& row : grid) for (auto& v : row) v *= 2;
        return grid;
    }
};
`,
      c: `double** scaleRows(double** grid, int gridSize, int* gridColSize, int* returnSize, int** returnColumnSizes) {
    *returnSize = gridSize;
    *returnColumnSizes = (int*)malloc(sizeof(int) * (gridSize > 0 ? gridSize : 1));
    double** out = (double**)malloc(sizeof(double*) * (gridSize > 0 ? gridSize : 1));
    for (int i = 0; i < gridSize; i++) {
        (*returnColumnSizes)[i] = gridColSize[i];
        out[i] = (double*)malloc(sizeof(double) * (gridColSize[i] > 0 ? gridColSize[i] : 1));
        for (int j = 0; j < gridColSize[i]; j++) out[i][j] = grid[i][j] * 2;
    }
    return out;
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
    if (good) pass += 1;
    else fail += 1;

    const bad = out.results.find((r) => !r.passed);
    const detail = good
      ? `${out.passedCount}/${out.totalCount}, ${out.maxTimeMs}ms`
      : `${out.verdict} ${out.passedCount}/${out.totalCount} — ${(
          out.error ||
          bad?.compileOutput ||
          bad?.stderr ||
          `got ${JSON.stringify(bad?.stdout)}`
        )
          .split('\n')
          .slice(0, 3)
          .join(' | ')}`;

    console.log(`    ${good ? 'PASS' : 'FAIL'}  ${lang.padEnd(11)} ${detail}`);
  }
}

const total = SUITES.length * FUNCTION_LANGUAGES.length;
console.log(`\n  ${pass} of ${total} type checks passing\n`);
await mongoose.disconnect();
process.exit(fail ? 1 : 0);
