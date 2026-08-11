import {
  baseOf,
  callParams,
  dimsOf,
  isNodeRefType,
  nodeTypesUsed,
  outputParamFor,
  sourceParamFor,
  visibleOutputParam,
} from './types.js';

const SCALARS = {
  int: 'int',
  long: 'long long',
  double: 'double',
  boolean: 'bool',
  char: 'char',
  string: 'string',
};

export function typeName(type, spec, param) {
  if (type === 'void') return 'void';
  if (type === 'list') return 'ListNode*';
  if (type === 'tree') return 'TreeNode*';
  if (isNodeRefType(type)) {
    return sourceParamFor(spec, param)?.type === 'tree' ? 'TreeNode*' : 'ListNode*';
  }
  let name = SCALARS[baseOf(type)];
  for (let i = 0; i < dimsOf(type); i += 1) name = `vector<${name}>`;
  return name;
}

const PARSERS = {
  int: '__pi',
  long: '__pl',
  double: '__pd',
  boolean: '__pb',
  char: '__pc',
  string: '__ps',
  'int[]': '__pia',
  'long[]': '__pla',
  'double[]': '__pda',
  'boolean[]': '__pba',
  'char[]': '__pca',
  'string[]': '__psa',
  'int[][]': '__pia2',
  'long[][]': '__pla2',
  'double[][]': '__pda2',
  'boolean[][]': '__pba2',
  'char[][]': '__pca2',
  'string[][]': '__psa2',
  list: '__plist',
  tree: '__ptree',
};

const NODE_COMMENTS = {
  list: `/**
 * Definition for singly-linked list.
 * struct ListNode {
 *     int val;
 *     ListNode *next;
 *     ListNode() : val(0), next(nullptr) {}
 *     ListNode(int x) : val(x), next(nullptr) {}
 *     ListNode(int x, ListNode *next) : val(x), next(next) {}
 * };
 */
`,
  tree: `/**
 * Definition for a binary tree node.
 * struct TreeNode {
 *     int val;
 *     TreeNode *left;
 *     TreeNode *right;
 *     TreeNode() : val(0), left(nullptr), right(nullptr) {}
 *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
 *     TreeNode(int x, TreeNode *left, TreeNode *right)
 *         : val(x), left(left), right(right) {}
 * };
 */
`,
};

export function stub(spec) {
  const params = callParams(spec)
    .map((p) => `${typeName(p.type, spec, p)} ${p.name}`)
    .join(', ');
  const header = nodeTypesUsed(spec)
    .map((t) => NODE_COMMENTS[t])
    .join('');

  const output = visibleOutputParam(spec);
  const note = output
    ? `    /** Do not return anything, modify ${output.name} in-place instead. */\n`
    : '';

  return `${header}class Solution {
public:
${note}    ${typeName(spec.returnType, spec)} ${spec.name}(${params}) {

    }
};
`;
}

/**
 * Node structs plus their parse/format helpers. Emitted before the student's
 * class, which is what makes `ListNode*` a usable parameter type for them.
 */
function nodeSupport(spec) {
  const used = nodeTypesUsed(spec);
  if (!used.length) return '';

  let out = '';

  if (used.includes('list')) {
    out += `
struct ListNode {
    int val;
    ListNode *next;
    ListNode() : val(0), next(nullptr) {}
    ListNode(int x) : val(x), next(nullptr) {}
    ListNode(int x, ListNode *next) : val(x), next(next) {}
};

static ListNode* __plist(string s) {
    vector<string> p = __items(s);
    ListNode* head = nullptr;
    for (size_t i = p.size(); i-- > 0;) head = new ListNode(__pi(p[i]), head);
    return head;
}

static ListNode* __find(ListNode* head, int val) {
    for (ListNode* n = head; n; n = n->next) if (n->val == val) return n;
    throw runtime_error("no node with value " + to_string(val) + " in the list");
}

static string __f(ListNode* n) {
    string b = "[";
    // Bounded by a visited set so a student's accidental cycle scores as a
    // wrong answer instead of spinning until the time limit.
    set<ListNode*> seen;
    bool first = true;
    while (n != nullptr && seen.insert(n).second) {
        if (!first) b += ",";
        b += to_string(n->val);
        first = false;
        n = n->next;
    }
    return b + "]";
}
`;
  }

  if (used.includes('tree')) {
    out += `
struct TreeNode {
    int val;
    TreeNode *left;
    TreeNode *right;
    TreeNode() : val(0), left(nullptr), right(nullptr) {}
    TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
    TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}
};

static TreeNode* __ptree(string s) {
    vector<string> p = __items(s);
    if (p.empty() || __t(p[0]) == "null") return nullptr;
    TreeNode* root = new TreeNode(__pi(p[0]));
    deque<TreeNode*> q;
    q.push_back(root);
    size_t i = 1;
    while (!q.empty() && i < p.size()) {
        TreeNode* node = q.front(); q.pop_front();
        if (i < p.size()) {
            string v = __t(p[i++]);
            if (v != "null") { node->left = new TreeNode(stoi(v)); q.push_back(node->left); }
        }
        if (i < p.size()) {
            string v = __t(p[i++]);
            if (v != "null") { node->right = new TreeNode(stoi(v)); q.push_back(node->right); }
        }
    }
    return root;
}

static TreeNode* __find(TreeNode* root, int val) {
    deque<TreeNode*> q;
    q.push_back(root);
    while (!q.empty()) {
        TreeNode* node = q.front(); q.pop_front();
        if (!node) continue;
        if (node->val == val) return node;
        q.push_back(node->left);
        q.push_back(node->right);
    }
    throw runtime_error("no node with value " + to_string(val) + " in the tree");
}

static string __f(TreeNode* root) {
    if (root == nullptr) return "[]";
    vector<string> out;
    deque<TreeNode*> q;
    set<TreeNode*> seen;
    q.push_back(root);
    while (!q.empty()) {
        TreeNode* node = q.front(); q.pop_front();
        if (node == nullptr || !seen.insert(node).second) {
            out.push_back("null");
        } else {
            out.push_back(to_string(node->val));
            q.push_back(node->left);
            q.push_back(node->right);
        }
    }
    while (!out.empty() && out.back() == "null") out.pop_back();
    string b = "[";
    for (size_t i = 0; i < out.size(); i++) { if (i) b += ","; b += out[i]; }
    return b + "]";
}
`;
  }

  return out;
}

/**
 * Parsing and formatting helpers shared by both harnesses.
 *
 * Kept in one place rather than duplicated: the function harness and the class
 * harness must agree exactly on how a value is read and written, or the same
 * answer would grade differently depending on the question shape.
 */
const HELPERS = `#include <bits/stdc++.h>
using namespace std;

static string __t(string s) {
    size_t a = s.find_first_not_of(" \\t\\r\\n");
    if (a == string::npos) return "";
    size_t b = s.find_last_not_of(" \\t\\r\\n");
    return s.substr(a, b - a + 1);
}

static string __line(const vector<string>& in, size_t i) { return i < in.size() ? in[i] : string(""); }

static string __ps(string s) {
    s = __t(s);
    if (s.size() >= 2 && s.front() == '"' && s.back() == '"') {
        s = s.substr(1, s.size() - 2);
        string out;
        for (size_t i = 0; i < s.size(); i++) {
            if (s[i] == '\\\\' && i + 1 < s.size()) {
                char n = s[++i];
                if (n == 'n') out += '\\n';
                else if (n == 't') out += '\\t';
                else out += n;
            } else out += s[i];
        }
        return out;
    }
    return s;
}

static int __pi(string s) { return stoi(__t(s)); }
static long long __pl(string s) { return stoll(__t(s)); }
static double __pd(string s) { return stod(__t(s)); }
static bool __pb(string s) { return __t(s) == "true"; }

/* A char arrives as a one-character JSON string: ["5","3","."]. */
static char __pc(string s) {
    string v = __ps(s);
    return v.empty() ? ' ' : v[0];
}

/** Splits the top level of a JSON array, respecting nesting and quotes. */
static vector<string> __items(string s) {
    s = __t(s);
    if (s.size() >= 2 && s.front() == '[' && s.back() == ']') s = s.substr(1, s.size() - 2);
    s = __t(s);
    vector<string> out;
    if (s.empty()) return out;
    int depth = 0;
    bool q = false;
    string cur;
    for (size_t i = 0; i < s.size(); i++) {
        char c = s[i];
        if (c == '"' && (i == 0 || s[i - 1] != '\\\\')) q = !q;
        if (!q && c == '[') depth++;
        if (!q && c == ']') depth--;
        if (!q && c == ',' && depth == 0) { out.push_back(cur); cur.clear(); }
        else cur += c;
    }
    out.push_back(cur);
    return out;
}

static vector<int> __pia(string s) {
    vector<int> a; for (auto& p : __items(s)) a.push_back(__pi(p)); return a;
}
static vector<long long> __pla(string s) {
    vector<long long> a; for (auto& p : __items(s)) a.push_back(__pl(p)); return a;
}
static vector<bool> __pba(string s) {
    vector<bool> a; for (auto& p : __items(s)) a.push_back(__pb(p)); return a;
}
static vector<string> __psa(string s) {
    vector<string> a; for (auto& p : __items(s)) a.push_back(__ps(p)); return a;
}
static vector<double> __pda(string s) {
    vector<double> a; for (auto& p : __items(s)) a.push_back(__pd(p)); return a;
}
static vector<char> __pca(string s) {
    vector<char> a; for (auto& p : __items(s)) a.push_back(__pc(p)); return a;
}
static vector<vector<int>> __pia2(string s) {
    vector<vector<int>> a; for (auto& p : __items(s)) a.push_back(__pia(p)); return a;
}
static vector<vector<long long>> __pla2(string s) {
    vector<vector<long long>> a; for (auto& p : __items(s)) a.push_back(__pla(p)); return a;
}
static vector<vector<double>> __pda2(string s) {
    vector<vector<double>> a; for (auto& p : __items(s)) a.push_back(__pda(p)); return a;
}
static vector<vector<bool>> __pba2(string s) {
    vector<vector<bool>> a; for (auto& p : __items(s)) a.push_back(__pba(p)); return a;
}
static vector<vector<char>> __pca2(string s) {
    vector<vector<char>> a; for (auto& p : __items(s)) a.push_back(__pca(p)); return a;
}
static vector<vector<string>> __psa2(string s) {
    vector<vector<string>> a; for (auto& p : __items(s)) a.push_back(__psa(p)); return a;
}

static string __esc(const string& s) {
    string b = "\\"";
    for (char c : s) {
        if (c == '"' || c == '\\\\') { b += '\\\\'; b += c; }
        else if (c == '\\n') b += "\\\\n";
        else if (c == '\\t') b += "\\\\t";
        else b += c;
    }
    return b + "\\"";
}

static string __f(int v) { return to_string(v); }
static string __f(long long v) { return to_string(v); }
static string __f(bool v) { return v ? "true" : "false"; }
static string __f(const string& v) { return __esc(v); }

/* A char prints as a one-character JSON string, matching how it is read. */
static string __f(char v) { return __esc(string(1, v)); }

/* %.10g keeps this valid JSON rather than C++'s own float style; the answer is
   compared numerically within a tolerance regardless. */
static string __f(double v) {
    if (!std::isfinite(v)) return "null";
    char buf[64];
    snprintf(buf, sizeof(buf), "%.10g", v);
    return string(buf);
}

template <typename T>
static string __f(const vector<T>& v) {
    string b = "[";
    for (size_t i = 0; i < v.size(); i++) { if (i) b += ","; b += __f(v[i]); }
    return b + "]";
}

/** vector<bool> is a bit-proxy, so it needs its own overload. */
static string __f(const vector<bool>& v) {
    string b = "[";
    for (size_t i = 0; i < v.size(); i++) { if (i) b += ","; b += (v[i] ? "true" : "false"); }
    return b + "]";
}
`;

// ---------------------------------------------------------------------------
// Class ("design") questions.
// ---------------------------------------------------------------------------

export function classStub(spec) {
  const ctorParams = spec.constructorParams
    .map((p) => `${typeName(p.type, spec, p)} ${p.name}`)
    .join(', ');

  const methods = spec.methods
    .map((m) => {
      const params = m.params.map((p) => `${typeName(p.type, spec, p)} ${p.name}`).join(', ');
      return `\n    ${typeName(m.returnType, spec)} ${m.name}(${params}) {\n\n    }\n`;
    })
    .join('');

  const calls = spec.methods
    .map((m) => ` * obj->${m.name}(${m.params.map((p) => p.name).join(', ')});`)
    .join('\n');

  const ctorArgs = spec.constructorParams.map((p) => p.name).join(', ');

  return `class ${spec.name} {
public:
    ${spec.name}(${ctorParams}) {

    }
${methods}};

/**
 * Your ${spec.name} object will be instantiated and called as such:
 * ${spec.name}* obj = new ${spec.name}(${ctorArgs});
${calls}
 */
`;
}

export function classProgram(spec, studentCode) {
  const ctorArgs = spec.constructorParams
    .map((p, i) => `${PARSERS[p.type]}(__arg(_args, 0, ${i}))`)
    .join(', ');

  const cases = spec.methods
    .map((m) => {
      const args = m.params.map((p, j) => `${PARSERS[p.type]}(__arg(_args, i, ${j}))`).join(', ');
      const call = `obj.${m.name}(${args})`;
      return m.returnType === 'void'
        ? `        else if (_op == "${m.name}") { ${call}; _out.push_back("null"); }`
        : `        else if (_op == "${m.name}") { _out.push_back(__f(${call})); }`;
    })
    .join('\n');

  return `${HELPERS}

/** The j-th argument of the i-th operation. */
static string __arg(const vector<string>& args, size_t i, size_t j) {
    if (i >= args.size()) return "";
    vector<string> a = __items(args[i]);
    return j < a.size() ? a[j] : string("");
}

${studentCode}

int main() {
    vector<string> _in;
    string _l;
    while (getline(cin, _l)) _in.push_back(_l);

    vector<string> _ops = __items(_in.size() > 0 ? _in[0] : "[]");
    vector<string> _args = __items(_in.size() > 1 ? _in[1] : "[]");

    vector<string> _out;
    /* No parentheses when there are no constructor arguments: "T obj();" is
       C++'s most vexing parse and declares a function, not an object. */
    ${ctorArgs ? `${spec.name} obj(${ctorArgs});` : `${spec.name} obj;`}
    _out.push_back("null");

    for (size_t i = 1; i < _ops.size(); i++) {
        string _op = __ps(_ops[i]);
        if (false) {}
${cases}
        else { cerr << "unknown operation " << _op << endl; return 1; }
    }

    string _b = "[";
    for (size_t i = 0; i < _out.size(); i++) { if (i) _b += ","; _b += _out[i]; }
    cout << _b + "]";
    return 0;
}
`;
}

/**
 * Helpers are emitted before the student's class so their signatures are
 * visible to it, and `main` comes last so it can see `Solution`.
 */
export function program(spec, studentCode) {
  const decls = spec.params
    .map((p, i) => {
      const type = typeName(p.type, spec, p);
      if (isNodeRefType(p.type)) {
        const source = sourceParamFor(spec, p);
        return `    ${type} ${p.name} = __find(${source.name}, __pi(__line(_in, ${i})));`;
      }
      return `    ${type} ${p.name} = ${PARSERS[p.type]}(__line(_in, ${i}));`;
    })
    .join('\n');

  const args = callParams(spec)
    .map((p) => p.name)
    .join(', ');

  const output = outputParamFor(spec);
  const call = output
    ? `    Solution().${spec.name}(${args});\n    cout << __f(${output.name});`
    : `    ${typeName(spec.returnType, spec)} _result = Solution().${spec.name}(${args});\n    cout << __f(_result);`;

  return `${HELPERS}
${nodeSupport(spec)}
${studentCode}

int main() {
    vector<string> _in;
    string _l;
    while (getline(cin, _l)) _in.push_back(_l);

${decls}

${call}
    return 0;
}
`;
}
