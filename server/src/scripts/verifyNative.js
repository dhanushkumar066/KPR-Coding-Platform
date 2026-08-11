/**
 * Compiles and runs the generated C and C++ harnesses using the WSL toolchain,
 * exercising every shape in the type matrix.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildProgram } from '../services/codegen/index.js';

const run = promisify(execFile);
const OUT = path.resolve(process.cwd(), 'tmp/native-verify');

/** E:\a\b -> /mnt/e/a/b */
const toWsl = (p) =>
  '/mnt/' + p[0].toLowerCase() + p.slice(2).replace(/\\/g, '/');

const CASES = [
  {
    name: 'int[] + int -> int[]',
    spec: {
      name: 'twoSum',
      returnType: 'int[]',
      params: [
        { name: 'nums', type: 'int[]' },
        { name: 'target', type: 'int' },
      ],
    },
    stdin: '[2,7,11,15]\n9',
    expect: '[0,1]',
    c: `int* twoSum(int* nums, int numsSize, int target, int* returnSize) {
    for (int i = 0; i < numsSize; i++)
        for (int j = i + 1; j < numsSize; j++)
            if (nums[i] + nums[j] == target) {
                int* r = (int*)malloc(sizeof(int) * 2);
                r[0] = i; r[1] = j; *returnSize = 2; return r;
            }
    *returnSize = 0;
    return (int*)malloc(1);
}`,
    cpp: `class Solution {
public:
    vector<int> twoSum(vector<int> nums, int target) {
        for (int i = 0; i < (int)nums.size(); i++)
            for (int j = i + 1; j < (int)nums.size(); j++)
                if (nums[i] + nums[j] == target) return {i, j};
        return {};
    }
};`,
  },
  {
    name: 'int[][] -> int[][]',
    spec: {
      name: 'transpose',
      returnType: 'int[][]',
      params: [{ name: 'm', type: 'int[][]' }],
    },
    stdin: '[[1,2,3],[4,5,6]]',
    expect: '[[1,4],[2,5],[3,6]]',
    c: `int** transpose(int** m, int mSize, int* mColSize, int* returnSize, int** returnColumnSizes) {
    int rows = mSize, cols = mSize ? mColSize[0] : 0;
    *returnSize = cols;
    *returnColumnSizes = (int*)malloc(sizeof(int) * (cols ? cols : 1));
    int** out = (int**)malloc(sizeof(int*) * (cols ? cols : 1));
    for (int i = 0; i < cols; i++) {
        out[i] = (int*)malloc(sizeof(int) * (rows ? rows : 1));
        (*returnColumnSizes)[i] = rows;
        for (int j = 0; j < rows; j++) out[i][j] = m[j][i];
    }
    return out;
}`,
    cpp: `class Solution {
public:
    vector<vector<int>> transpose(vector<vector<int>> m) {
        if (m.empty()) return {};
        vector<vector<int>> out(m[0].size(), vector<int>(m.size()));
        for (size_t i = 0; i < m.size(); i++)
            for (size_t j = 0; j < m[i].size(); j++) out[j][i] = m[i][j];
        return out;
    }
};`,
  },
  {
    name: 'string[] -> string',
    spec: {
      name: 'joinWords',
      returnType: 'string',
      params: [{ name: 'words', type: 'string[]' }],
    },
    stdin: '["red","green","blue"]',
    expect: '"red-green-blue"',
    c: `char* joinWords(char** words, int wordsSize) {
    int total = 1;
    for (int i = 0; i < wordsSize; i++) total += strlen(words[i]) + 1;
    char* out = (char*)malloc(total);
    out[0] = '\\0';
    for (int i = 0; i < wordsSize; i++) { if (i) strcat(out, "-"); strcat(out, words[i]); }
    return out;
}`,
    cpp: `class Solution {
public:
    string joinWords(vector<string> words) {
        string out;
        for (size_t i = 0; i < words.size(); i++) { if (i) out += "-"; out += words[i]; }
        return out;
    }
};`,
  },
  {
    name: 'boolean[] -> int',
    spec: {
      name: 'countTrue',
      returnType: 'int',
      params: [{ name: 'flags', type: 'boolean[]' }],
    },
    stdin: '[true,false,true,true]',
    expect: '3',
    c: `int countTrue(bool* flags, int flagsSize) {
    int n = 0;
    for (int i = 0; i < flagsSize; i++) if (flags[i]) n++;
    return n;
}`,
    cpp: `class Solution {
public:
    int countTrue(vector<bool> flags) {
        int n = 0;
        for (size_t i = 0; i < flags.size(); i++) if (flags[i]) n++;
        return n;
    }
};`,
  },
  {
    name: 'long[] -> long',
    spec: {
      name: 'maxLong',
      returnType: 'long',
      params: [{ name: 'nums', type: 'long[]' }],
    },
    stdin: '[5000000000,7000000000,1]',
    expect: '7000000000',
    c: `long long maxLong(long long* nums, int numsSize) {
    long long m = nums[0];
    for (int i = 1; i < numsSize; i++) if (nums[i] > m) m = nums[i];
    return m;
}`,
    cpp: `class Solution {
public:
    long long maxLong(vector<long long> nums) {
        long long m = nums[0];
        for (size_t i = 1; i < nums.size(); i++) m = max(m, nums[i]);
        return m;
    }
};`,
  },
  {
    name: 'string -> boolean',
    spec: {
      name: 'isPalindrome',
      returnType: 'boolean',
      params: [{ name: 's', type: 'string' }],
    },
    stdin: '"racecar"',
    expect: 'true',
    c: `bool isPalindrome(char* s) {
    int n = strlen(s);
    for (int i = 0; i < n / 2; i++) if (s[i] != s[n - 1 - i]) return false;
    return true;
}`,
    cpp: `class Solution {
public:
    bool isPalindrome(string s) {
        int n = s.size();
        for (int i = 0; i < n / 2; i++) if (s[i] != s[n - 1 - i]) return false;
        return true;
    }
};`,
  },
];

async function compileAndRun(lang, source, stdin, id) {
  const ext = lang === 'c' ? 'c' : 'cpp';
  const src = path.join(OUT, `${id}.${ext}`);
  const bin = path.join(OUT, `${id}.out`);
  const inp = path.join(OUT, `${id}.in`);
  await fs.writeFile(src, source, 'utf8');
  await fs.writeFile(inp, stdin, 'utf8');

  const compiler = lang === 'c' ? 'gcc' : 'g++';
  const std = lang === 'c' ? '-std=c11' : '-std=c++17';

  // Compile and run as separate steps so compiler diagnostics never contaminate
  // the program's stdout — merging them is what made the last run misreport.
  // -Wall is on purpose: an implicit declaration that silently truncates a
  // 64-bit pointer is exactly the class of bug this script exists to catch.
  // -Wno-unused-function because every helper is emitted whether used or not.
  const compile = `${compiler} ${std} -O1 -Wall -Wno-unused-function '${toWsl(src)}' -o '${toWsl(bin)}'`;
  try {
    const { stderr } = await run('wsl', ['-e', 'bash', '-lc', compile], { timeout: 60000 });
    if (stderr.trim()) {
      return { ok: false, out: `warnings: ${stderr.trim().split('\n').slice(0, 4).join(' | ')}` };
    }
  } catch (err) {
    const msg = (err.stderr || err.stdout || err.message).trim();
    return { ok: false, out: `compile failed: ${msg.split('\n').slice(0, 4).join(' | ')}` };
  }

  try {
    const { stdout } = await run(
      'wsl',
      ['-e', 'bash', '-lc', `'${toWsl(bin)}' < '${toWsl(inp)}'`],
      { timeout: 30000 }
    );
    return { ok: true, out: stdout.trim() };
  } catch (err) {
    return { ok: false, out: `runtime: ${(err.stderr || err.message).trim().split('\n')[0]}` };
  }
}

await fs.mkdir(OUT, { recursive: true });
let pass = 0;
let fail = 0;

for (const c of CASES) {
  for (const lang of ['c', 'cpp']) {
    const program = buildProgram(c.spec, lang, c[lang]);
    const id = `${c.spec.name}_${lang}`;
    const res = await compileAndRun(lang, program, c.stdin, id);
    const good = res.ok && res.out === c.expect;
    if (good) pass++;
    else fail++;
    console.log(
      `${good ? 'PASS' : 'FAIL'}  ${lang.padEnd(3)} ${c.name.padEnd(22)} ${
        good ? res.out : `got: ${res.out}  (expected ${c.expect})`
      }`
    );
  }
}

console.log(`\n  ${pass} passed, ${fail} failed`);
await fs.rm(OUT, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
