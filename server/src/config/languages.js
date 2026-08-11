/**
 * The single source of truth for supported languages.
 *
 * `judge0Id` maps to Judge0 CE language ids. `local` describes how the DEV-ONLY
 * fallback executor compiles/runs the same language on the host machine — it is
 * never used in production (see assertProductionSafety).
 */
export const LANGUAGES = {
  python: {
    key: 'python',
    label: 'Python 3',
    judge0Id: 71,
    monaco: 'python',
    ext: 'py',
    local: { run: ['python', '{file}'] },
    defaultStub: '# Read from standard input, print to standard output.\n\n',
  },
  cpp: {
    key: 'cpp',
    label: 'C++ (GCC)',
    judge0Id: 54,
    monaco: 'cpp',
    ext: 'cpp',
    local: { compile: ['g++', '-O2', '-std=c++17', '{file}', '-o', '{out}'], run: ['{out}'] },
    defaultStub: '#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    \n    return 0;\n}\n',
  },
  c: {
    key: 'c',
    label: 'C (GCC)',
    judge0Id: 50,
    monaco: 'c',
    ext: 'c',
    local: { compile: ['gcc', '-O2', '{file}', '-o', '{out}', '-lm'], run: ['{out}'] },
    defaultStub: '#include <stdio.h>\n\nint main(void) {\n    \n    return 0;\n}\n',
  },
  java: {
    key: 'java',
    label: 'Java',
    judge0Id: 62,
    monaco: 'java',
    ext: 'java',
    // Judge0 expects the public class to be named Main.
    fileName: 'Main.java',
    local: { compile: ['javac', '{file}'], run: ['java', '-cp', '{dir}', 'Main'] },
    defaultStub:
      'import java.util.*;\nimport java.io.*;\n\npublic class Main {\n    public static void main(String[] args) throws IOException {\n        \n    }\n}\n',
  },
  javascript: {
    key: 'javascript',
    label: 'JavaScript (Node)',
    judge0Id: 63,
    monaco: 'javascript',
    ext: 'js',
    // Written as .cjs for the dev executor: the temp dir sits under server/,
    // whose package.json declares "type": "module", which would otherwise make
    // Node parse a .js file as ESM and leave `require` undefined. Judge0 is
    // unaffected — it never sees a filename.
    fileName: 'main.cjs',
    local: { run: ['node', '{file}'] },
    defaultStub:
      "const data = require('fs').readFileSync(0, 'utf8').trim().split('\\n');\n\n",
  },
};

export const LANGUAGE_KEYS = Object.keys(LANGUAGES);

export const getLanguage = (key) => LANGUAGES[String(key || '').toLowerCase()] || null;

/** Client-safe view: never leaks how the host executes anything. */
export const publicLanguages = () =>
  LANGUAGE_KEYS.map((k) => ({
    key: k,
    label: LANGUAGES[k].label,
    monaco: LANGUAGES[k].monaco,
    defaultStub: LANGUAGES[k].defaultStub,
  }));
