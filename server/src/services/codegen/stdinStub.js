/**
 * Starter skeletons for standard input/output questions.
 *
 * Function-signature questions get a real generated stub from the signature.
 * Stdin questions have no signature to generate from, but a student should
 * still never face an empty editor — so they get the boilerplate that language
 * always needs: the includes, the entry point, and the line that reads stdin.
 *
 * Each one compiles and runs untouched. A student who presses Run before
 * writing anything gets a wrong answer, which is honest, rather than a compile
 * error, which just looks like the platform is broken.
 *
 * A teacher's own starter code always takes precedence over these.
 */
const STUBS = {
  python: `import sys


def main():
    data = sys.stdin.read().split()
    # TODO: read your input from \`data\` and print the answer.
    pass


if __name__ == "__main__":
    main()
`,

  javascript: `const lines = require('fs').readFileSync(0, 'utf8').split('\\n');

function main() {
    // TODO: read your input from \`lines\` and print the answer.
}

main();
`,

  java: `import java.util.*;
import java.io.*;

public class Main {
    public static void main(String[] args) throws IOException {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        // TODO: read your input with br.readLine() and print the answer.
    }
}
`,

  cpp: `#include <bits/stdc++.h>
using namespace std;

int main() {
    ios::sync_with_stdio(false);
    cin.tie(nullptr);
    // TODO: read your input from cin and print the answer to cout.
    return 0;
}
`,

  c: `#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    /* TODO: read your input with scanf or fgets and print the answer. */
    return 0;
}
`,
};

export const stdinStub = (languageKey) => STUBS[languageKey] || '';

export const hasStdinStub = (languageKey) => Object.hasOwn(STUBS, languageKey);
