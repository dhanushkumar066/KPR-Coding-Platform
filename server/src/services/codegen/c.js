import {
  baseOf,
  callParams,
  cClassPrefix,
  cMethodName,
  dimsOf,
  isNodeRefType,
  nodeTypesUsed,
  outputParamFor,
  sourceParamFor,
  visibleOutputParam,
} from './types.js';

/**
 * C generator for function-signature questions.
 *
 * C has no vectors and no length-carrying arrays, so it follows LeetCode's own
 * C convention, which students who have seen the site will recognise:
 *
 *   - an array parameter is followed by an `int` size parameter
 *   - a 2D array also carries an `int*` of column sizes
 *   - an array return value uses a trailing `int* returnSize` out-parameter
 *     (plus `int** returnColumnSizes` for 2D)
 */

const SCALARS = {
  int: 'int',
  long: 'long long',
  double: 'double',
  boolean: 'bool',
  char: 'char',
  string: 'char*',
};

/** The bare C type, e.g. `int`, `int*`, `char**`. */
export function typeName(type, spec, param) {
  if (type === 'void') return 'void';
  if (type === 'list') return 'struct ListNode*';
  if (type === 'tree') return 'struct TreeNode*';
  if (isNodeRefType(type)) {
    return sourceParamFor(spec, param)?.type === 'tree'
      ? 'struct TreeNode*'
      : 'struct ListNode*';
  }
  const base = SCALARS[baseOf(type)];
  const stars = '*'.repeat(dimsOf(type));
  // `char*` already ends in a star, so a 1-D array of strings is `char**`.
  return `${base}${stars}`;
}

const PARSERS = {
  int: '__p_int',
  long: '__p_long',
  double: '__p_double',
  boolean: '__p_bool',
  char: '__p_char',
  string: '__p_str',
  'int[]': '__p_int_arr',
  'long[]': '__p_long_arr',
  'double[]': '__p_double_arr',
  'boolean[]': '__p_bool_arr',
  'char[]': '__p_char_arr',
  'string[]': '__p_str_arr',
  'int[][]': '__p_int_arr2',
  'long[][]': '__p_long_arr2',
  'double[][]': '__p_double_arr2',
  'boolean[][]': '__p_bool_arr2',
  'char[][]': '__p_char_arr2',
  'string[][]': '__p_str_arr2',
  list: '__p_list',
  tree: '__p_tree',
};

const PRINTERS = {
  int: '__pr_int',
  long: '__pr_long',
  double: '__pr_double',
  boolean: '__pr_bool',
  char: '__pr_char',
  string: '__pr_str',
  'int[]': '__pr_int_arr',
  'long[]': '__pr_long_arr',
  'double[]': '__pr_double_arr',
  'boolean[]': '__pr_bool_arr',
  'char[]': '__pr_char_arr',
  'string[]': '__pr_str_arr',
  'int[][]': '__pr_int_arr2',
  'long[][]': '__pr_long_arr2',
  'double[][]': '__pr_double_arr2',
  'boolean[][]': '__pr_bool_arr2',
  'char[][]': '__pr_char_arr2',
  'string[][]': '__pr_str_arr2',
  list: '__pr_list',
  tree: '__pr_tree',
};

const NODE_COMMENTS = {
  list: `/**
 * Definition for singly-linked list.
 * struct ListNode {
 *     int val;
 *     struct ListNode *next;
 * };
 */
`,
  tree: `/**
 * Definition for a binary tree node.
 * struct TreeNode {
 *     int val;
 *     struct TreeNode *left;
 *     struct TreeNode *right;
 * };
 */
`,
};

/**
 * Node structs and their parse/print helpers.
 *
 * Node types carry their own length, so unlike arrays they need no companion
 * size parameter — which is why `dimsOf` returning 0 for them is correct.
 */
function nodeSupport(spec) {
  const used = nodeTypesUsed(spec);
  if (!used.length) return '';

  let out = '';

  if (used.includes('list')) {
    out += `
struct ListNode {
    int val;
    struct ListNode *next;
};

static struct ListNode* __p_list(const char* s) {
    int n = 0;
    char** it = __items(s, &n);
    struct ListNode* head = NULL;
    for (int i = n - 1; i >= 0; i--) {
        struct ListNode* node = (struct ListNode*)malloc(sizeof(struct ListNode));
        node->val = __p_int(it[i]);
        node->next = head;
        head = node;
    }
    return head;
}

static struct ListNode* __find_list(struct ListNode* head, int val) {
    for (struct ListNode* n = head; n; n = n->next) if (n->val == val) return n;
    fprintf(stderr, "no node with value %d in the list\\n", val);
    exit(1);
}

static void __pr_list(struct ListNode* n) {
    putchar('[');
    /* A hard cap rather than a visited set: C has no cheap set, and the point
       is only that a student's accidental cycle ends as a wrong answer instead
       of spinning until the time limit. */
    long guard = 0;
    bool first = true;
    while (n != NULL && guard++ < 1000000L) {
        if (!first) putchar(',');
        printf("%d", n->val);
        first = false;
        n = n->next;
    }
    putchar(']');
}
`;
  }

  if (used.includes('tree')) {
    out += `
struct TreeNode {
    int val;
    struct TreeNode *left;
    struct TreeNode *right;
};

static struct TreeNode* __new_tree_node(int val) {
    struct TreeNode* n = (struct TreeNode*)malloc(sizeof(struct TreeNode));
    n->val = val;
    n->left = NULL;
    n->right = NULL;
    return n;
}

static struct TreeNode* __p_tree(const char* s) {
    int n = 0;
    char** it = __items(s, &n);
    if (n == 0 || strcmp(__trim(__dup(it[0])), "null") == 0) return NULL;

    struct TreeNode** q = (struct TreeNode**)malloc(sizeof(struct TreeNode*) * (n + 1));
    int qh = 0, qt = 0;
    struct TreeNode* root = __new_tree_node(__p_int(it[0]));
    q[qt++] = root;

    int i = 1;
    while (qh < qt && i < n) {
        struct TreeNode* node = q[qh++];
        if (i < n) {
            char* v = __trim(__dup(it[i++]));
            if (strcmp(v, "null") != 0) { node->left = __new_tree_node(atoi(v)); q[qt++] = node->left; }
        }
        if (i < n) {
            char* v = __trim(__dup(it[i++]));
            if (strcmp(v, "null") != 0) { node->right = __new_tree_node(atoi(v)); q[qt++] = node->right; }
        }
    }
    free(q);
    return root;
}

static struct TreeNode* __find_tree(struct TreeNode* root, int val) {
    struct TreeNode** q = (struct TreeNode**)malloc(sizeof(struct TreeNode*) * 100000);
    int qh = 0, qt = 0;
    q[qt++] = root;
    while (qh < qt) {
        struct TreeNode* node = q[qh++];
        if (!node) continue;
        if (node->val == val) { free(q); return node; }
        if (qt + 2 < 100000) { q[qt++] = node->left; q[qt++] = node->right; }
    }
    free(q);
    fprintf(stderr, "no node with value %d in the tree\\n", val);
    exit(1);
}

static void __pr_tree(struct TreeNode* root) {
    if (root == NULL) { printf("[]"); return; }

    int vcap = 1024, n = 0;
    int* vals = (int*)malloc(sizeof(int) * vcap);
    bool* nulls = (bool*)malloc(sizeof(bool) * vcap);

    int qcap = 1024, qh = 0, qt = 0;
    struct TreeNode** q = (struct TreeNode**)malloc(sizeof(struct TreeNode*) * qcap);
    q[qt++] = root;

    while (qh < qt && n < 1000000) {
        struct TreeNode* node = q[qh++];
        if (n == vcap) {
            vcap *= 2;
            vals = (int*)realloc(vals, sizeof(int) * vcap);
            nulls = (bool*)realloc(nulls, sizeof(bool) * vcap);
        }
        if (node == NULL) {
            nulls[n] = true;
            vals[n] = 0;
            n++;
        } else {
            nulls[n] = false;
            vals[n] = node->val;
            n++;
            if (qt + 2 > qcap) {
                qcap *= 2;
                q = (struct TreeNode**)realloc(q, sizeof(struct TreeNode*) * qcap);
            }
            q[qt++] = node->left;
            q[qt++] = node->right;
        }
    }

    while (n > 0 && nulls[n - 1]) n--;
    putchar('[');
    for (int i = 0; i < n; i++) {
        if (i) putchar(',');
        if (nulls[i]) printf("null"); else printf("%d", vals[i]);
    }
    putchar(']');
    free(vals); free(nulls); free(q);
}
`;
  }

  return out;
}

/** Parameter list for one argument, expanded with its size companions. */
function paramsFor(param, spec) {
  const dims = dimsOf(param.type);
  const out = [`${typeName(param.type, spec, param)} ${param.name}`];
  if (dims >= 1) out.push(`int ${param.name}Size`);
  if (dims >= 2) out.push(`int* ${param.name}ColSize`);
  return out;
}

/**
 * Extra trailing parameters the return type needs. A `void` function has none —
 * its answer is a mutated argument, so there is nothing to size.
 */
function returnParams(returnType) {
  const dims = dimsOf(returnType);
  if (dims === 0) return [];
  if (dims === 1) return ['int* returnSize'];
  return ['int* returnSize', 'int** returnColumnSizes'];
}

function signature(spec) {
  const params = [
    ...callParams(spec).flatMap((p) => paramsFor(p, spec)),
    ...returnParams(spec.returnType),
  ];
  return `${typeName(spec.returnType, spec)} ${spec.name}(${params.join(', ')})`;
}

export function stub(spec) {
  const dims = dimsOf(spec.returnType);
  const header = nodeTypesUsed(spec)
    .map((t) => NODE_COMMENTS[t])
    .join('');

  const output = visibleOutputParam(spec);
  const note = output
    ? `/**\n * Note: Do not return anything, modify ${output.name} in-place instead.\n */\n`
    : dims > 0
      ? `/**\n * Note: The returned array must be malloc'd — the caller frees it.\n */\n`
      : '';

  return `${header}${note}${signature(spec)} {

}
`;
}

/**
 * Parsing and printing helpers shared by both harnesses.
 *
 * Kept in one place rather than duplicated: the function harness and the class
 * harness must agree exactly on how a value is read and written.
 */
const HELPERS = `#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>

/* ---- harness helpers (the student never sees these) ---- */

static char* __readline(void) {
    size_t cap = 128, len = 0;
    char* buf = (char*)malloc(cap);
    int ch;
    while ((ch = getchar()) != EOF && ch != '\\n') {
        if (len + 2 >= cap) { cap *= 2; buf = (char*)realloc(buf, cap); }
        buf[len++] = (char)ch;
    }
    buf[len] = '\\0';
    return buf;
}

/* Written out rather than using strdup: strdup is POSIX, not ISO C, so under a
   strict -std=c11 it is undeclared and GCC assumes it returns int — which
   truncates the pointer on 64-bit and crashes. */
static char* __dup(const char* s) {
    size_t n = strlen(s);
    char* d = (char*)malloc(n + 1);
    memcpy(d, s, n + 1);
    return d;
}

static char* __trim(char* s) {
    while (*s == ' ' || *s == '\\t' || *s == '\\r') s++;
    char* e = s + strlen(s);
    while (e > s && (e[-1] == ' ' || e[-1] == '\\t' || e[-1] == '\\r')) e--;
    *e = '\\0';
    return s;
}

/* Splits the top level of a JSON array, respecting nesting and quotes. */
static char** __items(const char* raw, int* count) {
    char* s = __trim(__dup(raw));
    size_t n = strlen(s);
    if (n >= 2 && s[0] == '[' && s[n - 1] == ']') { s[n - 1] = '\\0'; s += 1; }
    s = __trim(s);
    *count = 0;
    char** out = (char**)malloc(sizeof(char*) * 8);
    if (*s == '\\0') return out;

    int cap = 8, depth = 0;
    bool q = false;
    char* start = s;
    for (char* p = s; ; p++) {
        if (*p == '"' && (p == s || p[-1] != '\\\\')) q = !q;
        if (!q && *p == '[') depth++;
        if (!q && *p == ']') depth--;
        if (*p == '\\0' || (!q && *p == ',' && depth == 0)) {
            size_t len = (size_t)(p - start);
            char* item = (char*)malloc(len + 1);
            memcpy(item, start, len);
            item[len] = '\\0';
            if (*count == cap) { cap *= 2; out = (char**)realloc(out, sizeof(char*) * cap); }
            out[(*count)++] = item;
            if (*p == '\\0') break;
            start = p + 1;
        }
    }
    return out;
}

static int __p_int(const char* s) { return atoi(__trim(__dup(s))); }
static long long __p_long(const char* s) { return atoll(__trim(__dup(s))); }
static double __p_double(const char* s) { return atof(__trim(__dup(s))); }
static bool __p_bool(const char* s) { return strcmp(__trim(__dup(s)), "true") == 0; }

static char* __p_str(const char* s) {
    char* t = __trim(__dup(s));
    size_t n = strlen(t);
    if (n >= 2 && t[0] == '"' && t[n - 1] == '"') { t[n - 1] = '\\0'; t += 1; }
    char* out = (char*)malloc(strlen(t) + 1);
    size_t j = 0;
    for (size_t i = 0; t[i]; i++) {
        if (t[i] == '\\\\' && t[i + 1]) {
            i++;
            if (t[i] == 'n') out[j++] = '\\n';
            else if (t[i] == 't') out[j++] = '\\t';
            else out[j++] = t[i];
        } else {
            out[j++] = t[i];
        }
    }
    out[j] = '\\0';
    return out;
}

/* A char arrives as a one-character JSON string: ["5","3","."]. */
static char __p_char(const char* s) {
    char* v = __p_str(s);
    return v[0] ? v[0] : ' ';
}

#define __ARR_PARSER(NAME, TYPE, ITEM)                                        \\
    static TYPE* NAME(const char* s, int* size) {                             \\
        char** it = __items(s, size);                                         \\
        TYPE* a = (TYPE*)malloc(sizeof(TYPE) * (*size > 0 ? *size : 1));      \\
        for (int i = 0; i < *size; i++) a[i] = ITEM(it[i]);                   \\
        return a;                                                             \\
    }

__ARR_PARSER(__p_int_arr, int, __p_int)
__ARR_PARSER(__p_long_arr, long long, __p_long)
__ARR_PARSER(__p_double_arr, double, __p_double)
__ARR_PARSER(__p_bool_arr, bool, __p_bool)
__ARR_PARSER(__p_char_arr, char, __p_char)
__ARR_PARSER(__p_str_arr, char*, __p_str)

#define __ARR2_PARSER(NAME, TYPE, INNER)                                          \\
    static TYPE** NAME(const char* s, int* size, int** colSizes) {                \\
        char** it = __items(s, size);                                             \\
        TYPE** a = (TYPE**)malloc(sizeof(TYPE*) * (*size > 0 ? *size : 1));       \\
        *colSizes = (int*)malloc(sizeof(int) * (*size > 0 ? *size : 1));          \\
        for (int i = 0; i < *size; i++) a[i] = INNER(it[i], &(*colSizes)[i]);     \\
        return a;                                                                 \\
    }

__ARR2_PARSER(__p_int_arr2, int, __p_int_arr)
__ARR2_PARSER(__p_long_arr2, long long, __p_long_arr)
__ARR2_PARSER(__p_double_arr2, double, __p_double_arr)
__ARR2_PARSER(__p_bool_arr2, bool, __p_bool_arr)
__ARR2_PARSER(__p_char_arr2, char, __p_char_arr)
__ARR2_PARSER(__p_str_arr2, char*, __p_str_arr)

static void __pr_int(int v) { printf("%d", v); }
static void __pr_long(long long v) { printf("%lld", v); }
static void __pr_bool(bool v) { printf("%s", v ? "true" : "false"); }

/* %.10g keeps this valid JSON rather than C's default six decimals; the answer
   is compared numerically within a tolerance regardless. */
static void __pr_double(double v) {
    if (v != v || v > 1.7e308 || v < -1.7e308) { printf("null"); return; }
    printf("%.10g", v);
}


static void __pr_str(const char* v) {
    if (!v) { printf("null"); return; }
    putchar('"');
    for (const char* p = v; *p; p++) {
        if (*p == '"' || *p == '\\\\') { putchar('\\\\'); putchar(*p); }
        else if (*p == '\\n') printf("\\\\n");
        else if (*p == '\\t') printf("\\\\t");
        else putchar(*p);
    }
    putchar('"');
}

/* A char prints as a one-character JSON string, matching how it is read.
   Defined after __pr_str because it delegates to it — C needs the declaration
   first, and -Wall is what caught this. */
static void __pr_char(char v) {
    char buf[2] = { v, '\\0' };
    __pr_str(buf);
}

#define __ARR_PRINTER(NAME, TYPE, ITEM)                                       \\
    static void NAME(TYPE* a, int n) {                                        \\
        putchar('[');                                                         \\
        for (int i = 0; i < n; i++) { if (i) putchar(','); ITEM(a[i]); }       \\
        putchar(']');                                                         \\
    }

__ARR_PRINTER(__pr_int_arr, int, __pr_int)
__ARR_PRINTER(__pr_long_arr, long long, __pr_long)
__ARR_PRINTER(__pr_double_arr, double, __pr_double)
__ARR_PRINTER(__pr_bool_arr, bool, __pr_bool)
__ARR_PRINTER(__pr_char_arr, char, __pr_char)
__ARR_PRINTER(__pr_str_arr, char*, __pr_str)

#define __ARR2_PRINTER(NAME, TYPE, INNER)                                     \\
    static void NAME(TYPE** a, int n, int* cols) {                            \\
        putchar('[');                                                         \\
        for (int i = 0; i < n; i++) { if (i) putchar(','); INNER(a[i], cols[i]); } \\
        putchar(']');                                                         \\
    }

__ARR2_PRINTER(__pr_int_arr2, int, __pr_int_arr)
__ARR2_PRINTER(__pr_long_arr2, long long, __pr_long_arr)
__ARR2_PRINTER(__pr_double_arr2, double, __pr_double_arr)
__ARR2_PRINTER(__pr_bool_arr2, bool, __pr_bool_arr)
__ARR2_PRINTER(__pr_char_arr2, char, __pr_char_arr)
__ARR2_PRINTER(__pr_str_arr2, char*, __pr_str_arr)
`;

// ---------------------------------------------------------------------------
// Class ("design") questions.
//
// C has no classes, so this follows LeetCode's own C convention: an opaque
// struct plus `<class>Create`, `<class><Method>` and `<class>Free` functions,
// with the object passed as the first argument.
// ---------------------------------------------------------------------------

/** Parameters for one method, expanded with array size companions. */
function methodParams(spec, method) {
  return method.params.flatMap((p) => {
    const out = [`${typeName(p.type, spec, p)} ${p.name}`];
    const dims = dimsOf(p.type);
    if (dims >= 1) out.push(`int ${p.name}Size`);
    if (dims >= 2) out.push(`int* ${p.name}ColSize`);
    return out;
  });
}

export function classStub(spec) {
  const prefix = cClassPrefix(spec.name);
  const ctorParams = spec.constructorParams
    .map((p) => `${typeName(p.type, spec, p)} ${p.name}`)
    .join(', ');

  const methods = spec.methods
    .map((m) => {
      const params = [`${spec.name}* obj`, ...methodParams(spec, m)].join(', ');
      const ret = typeName(m.returnType, spec);
      const retNote =
        dimsOf(m.returnType) === 1
          ? ', int* returnSize'
          : dimsOf(m.returnType) >= 2
            ? ', int* returnSize, int** returnColumnSizes'
            : '';
      return `\n${ret} ${cMethodName(spec.name, m.name)}(${params}${retNote}) {\n\n}\n`;
    })
    .join('');

  const calls = spec.methods
    .map(
      (m) =>
        ` * ${cMethodName(spec.name, m.name)}(obj${m.params.length ? ', ' : ''}${m.params
          .map((p) => p.name)
          .join(', ')});`
    )
    .join('\n');

  return `typedef struct {

} ${spec.name};

${spec.name}* ${prefix}Create(${ctorParams || 'void'}) {

}
${methods}
void ${prefix}Free(${spec.name}* obj) {

}

/**
 * Your ${spec.name} struct will be instantiated and called as such:
 * ${spec.name}* obj = ${prefix}Create(${spec.constructorParams.map((p) => p.name).join(', ')});
${calls}
 * ${prefix}Free(obj);
 */
`;
}

export function classProgram(spec, studentCode) {
  const prefix = cClassPrefix(spec.name);

  const ctorArgs = spec.constructorParams
    .map((p, i) => `${PARSERS[p.type]}(__arg(_args, _argCount, 0, ${i}))`)
    .join(', ');

  const cases = spec.methods
    .map((m) => {
      const decls = [];
      const callArgs = ['obj'];
      m.params.forEach((p, j) => {
        const dims = dimsOf(p.type);
        const raw = `__arg(_args, _argCount, i, ${j})`;
        if (dims === 0) {
          decls.push(`            ${typeName(p.type, spec, p)} ${p.name} = ${PARSERS[p.type]}(${raw});`);
          callArgs.push(p.name);
        } else if (dims === 1) {
          decls.push(`            int ${p.name}Size;`);
          decls.push(
            `            ${typeName(p.type, spec, p)} ${p.name} = ${PARSERS[p.type]}(${raw}, &${p.name}Size);`
          );
          callArgs.push(p.name, `${p.name}Size`);
        } else {
          decls.push(`            int ${p.name}Size;`);
          decls.push(`            int* ${p.name}ColSize;`);
          decls.push(
            `            ${typeName(p.type, spec, p)} ${p.name} = ${PARSERS[p.type]}(${raw}, &${p.name}Size, &${p.name}ColSize);`
          );
          callArgs.push(p.name, `${p.name}Size`, `${p.name}ColSize`);
        }
      });

      const fn = cMethodName(spec.name, m.name);
      const retDims = dimsOf(m.returnType);

      let body;
      if (m.returnType === 'void') {
        body = `            ${fn}(${callArgs.join(', ')});\n            __emit_null();`;
      } else if (retDims === 0) {
        body =
          `            ${typeName(m.returnType, spec)} _r = ${fn}(${callArgs.join(', ')});\n` +
          `            __sep(); ${PRINTERS[m.returnType]}(_r);`;
      } else if (retDims === 1) {
        callArgs.push('&_rs');
        body =
          `            int _rs = 0;\n` +
          `            ${typeName(m.returnType, spec)} _r = ${fn}(${callArgs.join(', ')});\n` +
          `            __sep(); ${PRINTERS[m.returnType]}(_r, _rs);`;
      } else {
        callArgs.push('&_rs', '&_rcs');
        body =
          `            int _rs = 0; int* _rcs = NULL;\n` +
          `            ${typeName(m.returnType, spec)} _r = ${fn}(${callArgs.join(', ')});\n` +
          `            __sep(); ${PRINTERS[m.returnType]}(_r, _rs, _rcs);`;
      }

      return `        } else if (strcmp(_op, "${m.name}") == 0) {\n${decls.join('\n')}${
        decls.length ? '\n' : ''
      }${body}`;
    })
    .join('\n');

  return `${HELPERS}

/* The output array is printed as it goes, so this tracks the commas. */
static bool __first = true;
static void __sep(void) { if (!__first) putchar(','); __first = false; }
static void __emit_null(void) { __sep(); printf("null"); }

/* The j-th argument of the i-th operation. */
static char* __arg(char** args, int argCount, int i, int j) {
    if (i >= argCount) return (char*)"";
    int n = 0;
    char** a = __items(args[i], &n);
    return j < n ? a[j] : (char*)"";
}

${studentCode}

int main(void) {
    char* _l0 = __readline();
    char* _l1 = __readline();

    int _opCount = 0, _argCount = 0;
    char** _ops = __items(_l0, &_opCount);
    char** _args = __items(_l1, &_argCount);

    ${spec.name}* obj = ${prefix}Create(${ctorArgs});

    putchar('[');
    __emit_null();

    for (int i = 1; i < _opCount; i++) {
        char* _op = __p_str(_ops[i]);
        if (0) {
${cases}
        } else {
            fprintf(stderr, "unknown operation %s\\n", _op);
            return 1;
        }
    }

    putchar(']');
    ${prefix}Free(obj);
    return 0;
}
`;
}

export function program(spec, studentCode) {
  const reads = [];
  spec.params.forEach((p, i) => {
    const type = typeName(p.type, spec, p);
    reads.push(`    char* _l${i} = __readline();`);

    if (isNodeRefType(p.type)) {
      const source = sourceParamFor(spec, p);
      const finder = source.type === 'tree' ? '__find_tree' : '__find_list';
      reads.push(`    ${type} ${p.name} = ${finder}(${source.name}, __p_int(_l${i}));`);
      return;
    }

    const dims = dimsOf(p.type);
    if (dims === 0) {
      reads.push(`    ${type} ${p.name} = ${PARSERS[p.type]}(_l${i});`);
    } else if (dims === 1) {
      reads.push(`    int ${p.name}Size;`);
      reads.push(`    ${type} ${p.name} = ${PARSERS[p.type]}(_l${i}, &${p.name}Size);`);
    } else {
      reads.push(`    int ${p.name}Size;`);
      reads.push(`    int* ${p.name}ColSize;`);
      reads.push(
        `    ${type} ${p.name} = ${PARSERS[p.type]}(_l${i}, &${p.name}Size, &${p.name}ColSize);`
      );
    }
  });

  const callArgs = callParams(spec).flatMap((p) => {
    const dims = dimsOf(p.type);
    const out = [p.name];
    if (dims >= 1) out.push(`${p.name}Size`);
    if (dims >= 2) out.push(`${p.name}ColSize`);
    return out;
  });

  const retDims = dimsOf(spec.returnType);
  const retDecls = [];
  if (retDims >= 1) {
    retDecls.push('    int _returnSize = 0;');
    callArgs.push('&_returnSize');
  }
  if (retDims >= 2) {
    retDecls.push('    int* _returnColumnSizes = NULL;');
    callArgs.push('&_returnColumnSizes');
  }

  const output = outputParamFor(spec);

  /** Prints a value of `type` held in `name`, supplying whatever sizes it needs. */
  const printerFor = (type, name, sizes) => {
    const dims = dimsOf(type);
    if (dims === 0) return `${PRINTERS[type]}(${name});`;
    if (dims === 1) return `${PRINTERS[type]}(${name}, ${sizes[0]});`;
    return `${PRINTERS[type]}(${name}, ${sizes[0]}, ${sizes[1]});`;
  };

  // A void function is called for its side effect and the nominated argument is
  // printed afterwards, using the sizes the harness already parsed for it.
  const invoke = output
    ? `    ${spec.name}(${callArgs.join(', ')});\n    ` +
      printerFor(output.type, output.name, [`${output.name}Size`, `${output.name}ColSize`])
    : `    ${typeName(spec.returnType, spec)} _res = ${spec.name}(${callArgs.join(', ')});\n    ` +
      printerFor(spec.returnType, '_res', ['_returnSize', '_returnColumnSizes']);

  return `${HELPERS}
${nodeSupport(spec)}
/* ---- the student's solution ---- */

${studentCode}

/* ---- driver ---- */

int main(void) {
${reads.join('\n')}
${retDecls.join('\n')}
${invoke}
    return 0;
}
`;
}
