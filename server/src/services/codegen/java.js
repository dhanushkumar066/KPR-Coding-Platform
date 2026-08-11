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
  long: 'long',
  double: 'double',
  boolean: 'boolean',
  char: 'char',
  string: 'String',
};

export function typeName(type, spec, param) {
  if (type === 'void') return 'void';
  if (type === 'list') return 'ListNode';
  if (type === 'tree') return 'TreeNode';
  if (isNodeRefType(type)) {
    return sourceParamFor(spec, param)?.type === 'tree' ? 'TreeNode' : 'ListNode';
  }
  return SCALARS[baseOf(type)] + '[]'.repeat(dimsOf(type));
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
 * class ListNode {
 *     int val;
 *     ListNode next;
 *     ListNode() {}
 *     ListNode(int val) { this.val = val; }
 *     ListNode(int val, ListNode next) { this.val = val; this.next = next; }
 * }
 */
`,
  tree: `/**
 * Definition for a binary tree node.
 * class TreeNode {
 *     int val;
 *     TreeNode left;
 *     TreeNode right;
 *     TreeNode() {}
 *     TreeNode(int val) { this.val = val; }
 *     TreeNode(int val, TreeNode left, TreeNode right) {
 *         this.val = val; this.left = left; this.right = right;
 *     }
 * }
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
${note}    public ${typeName(spec.returnType, spec)} ${spec.name}(${params}) {

    }
}
`;
}

/**
 * The real node classes, emitted *after* the student's code.
 *
 * Java allows classes in any order within a file, and putting these last keeps
 * the student's own `import` statements legal — imports may not follow a type
 * declaration.
 */
function nodeClasses(spec) {
  const used = nodeTypesUsed(spec);
  if (!used.length) return '';

  let out = '\n';
  if (used.includes('list')) {
    out += `class ListNode {
    int val;
    ListNode next;
    ListNode() {}
    ListNode(int val) { this.val = val; }
    ListNode(int val, ListNode next) { this.val = val; this.next = next; }
}
`;
  }
  if (used.includes('tree')) {
    out += `class TreeNode {
    int val;
    TreeNode left;
    TreeNode right;
    TreeNode() {}
    TreeNode(int val) { this.val = val; }
    TreeNode(int val, TreeNode left, TreeNode right) {
        this.val = val; this.left = left; this.right = right;
    }
}
`;
  }
  return out;
}

/** Parse and format helpers for whichever node types the signature uses. */
function nodeHelpers(spec) {
  const used = nodeTypesUsed(spec);
  if (!used.length) return '';

  let out = '';

  if (used.includes('list')) {
    out += `
    static ListNode __plist(String s) {
        String[] p = __items(s);
        ListNode head = null;
        for (int i = p.length - 1; i >= 0; i--) head = new ListNode(__pi(p[i]), head);
        return head;
    }

    static ListNode __find(ListNode head, int val) {
        for (ListNode n = head; n != null; n = n.next) if (n.val == val) return n;
        throw new RuntimeException("no node with value " + val + " in the list");
    }

    static String __f(ListNode n) {
        StringBuilder b = new StringBuilder("[");
        // ListNode has no equals override, so this set compares by identity —
        // a student's accidental cycle ends as a wrong answer, not a timeout.
        java.util.Set<ListNode> seen = new java.util.HashSet<ListNode>();
        boolean first = true;
        while (n != null && seen.add(n)) {
            if (!first) b.append(',');
            b.append(n.val);
            first = false;
            n = n.next;
        }
        return b.append(']').toString();
    }
`;
  }

  if (used.includes('tree')) {
    out += `
    static TreeNode __ptree(String s) {
        String[] p = __items(s);
        if (p.length == 0 || "null".equals(__t(p[0]))) return null;
        TreeNode root = new TreeNode(__pi(p[0]));
        java.util.LinkedList<TreeNode> q = new java.util.LinkedList<TreeNode>();
        q.add(root);
        int i = 1;
        while (!q.isEmpty() && i < p.length) {
            TreeNode node = q.poll();
            if (i < p.length) {
                String v = __t(p[i++]);
                if (!"null".equals(v)) { node.left = new TreeNode(Integer.parseInt(v)); q.add(node.left); }
            }
            if (i < p.length) {
                String v = __t(p[i++]);
                if (!"null".equals(v)) { node.right = new TreeNode(Integer.parseInt(v)); q.add(node.right); }
            }
        }
        return root;
    }

    static TreeNode __find(TreeNode root, int val) {
        java.util.LinkedList<TreeNode> q = new java.util.LinkedList<TreeNode>();
        q.add(root);
        while (!q.isEmpty()) {
            TreeNode node = q.poll();
            if (node == null) continue;
            if (node.val == val) return node;
            q.add(node.left);
            q.add(node.right);
        }
        throw new RuntimeException("no node with value " + val + " in the tree");
    }

    static String __f(TreeNode root) {
        if (root == null) return "[]";
        java.util.List<String> out = new java.util.ArrayList<String>();
        // LinkedList, not ArrayDeque: the level order has to carry nulls.
        java.util.LinkedList<TreeNode> q = new java.util.LinkedList<TreeNode>();
        java.util.Set<TreeNode> seen = new java.util.HashSet<TreeNode>();
        q.add(root);
        while (!q.isEmpty()) {
            TreeNode node = q.poll();
            if (node == null || !seen.add(node)) {
                out.add("null");
            } else {
                out.add(String.valueOf(node.val));
                q.add(node.left);
                q.add(node.right);
            }
        }
        while (!out.isEmpty() && "null".equals(out.get(out.size() - 1))) out.remove(out.size() - 1);
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < out.size(); i++) { if (i > 0) b.append(','); b.append(out.get(i)); }
        return b.append(']').toString();
    }
`;
  }

  return out;
}

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
      return `\n    public ${typeName(m.returnType, spec)} ${m.name}(${params}) {\n\n    }\n`;
    })
    .join('');

  const calls = spec.methods
    .map((m) => ` * obj.${m.name}(${m.params.map((p) => p.name).join(', ')});`)
    .join('\n');

  return `class ${spec.name} {

    public ${spec.name}(${ctorParams}) {

    }
${methods}}

/**
 * Your ${spec.name} object will be instantiated and called as such:
 * ${spec.name} obj = new ${spec.name}(${spec.constructorParams.map((p) => p.name).join(', ')});
${calls}
 */
`;
}

export function classProgram(spec, studentCode) {
  const ctorArgs = spec.constructorParams
    .map((p, i) => `${PARSERS[p.type]}(__arg(_args, 0, ${i}))`)
    .join(', ');

  // Java has no dynamic dispatch by name here, so the switch is generated from
  // the declared methods. An unknown name is a harness bug, not a student one.
  const cases = spec.methods
    .map((m) => {
      const args = m.params.map((p, j) => `${PARSERS[p.type]}(__arg(_args, i, ${j}))`).join(', ');
      const call = `obj.${m.name}(${args})`;
      return m.returnType === 'void'
        ? `                case "${m.name}": ${call}; _out.add("null"); break;`
        : `                case "${m.name}": _out.add(__f(${call})); break;`;
    })
    .join('\n');

  return `import java.util.*;
import java.io.*;

${studentCode}

public class Main {
    static String __t(String s) { return s == null ? "" : s.trim(); }

    static String __ps(String s) {
        s = __t(s);
        if (s.length() >= 2 && s.charAt(0) == '"' && s.charAt(s.length() - 1) == '"') {
            s = s.substring(1, s.length() - 1);
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                if (c == '\\\\' && i + 1 < s.length()) {
                    char n = s.charAt(++i);
                    if (n == 'n') b.append('\\n');
                    else if (n == 't') b.append('\\t');
                    else b.append(n);
                } else b.append(c);
            }
            return b.toString();
        }
        return s;
    }

    static int __pi(String s) { return Integer.parseInt(__t(s)); }
    static long __pl(String s) { return Long.parseLong(__t(s)); }
    static double __pd(String s) { return Double.parseDouble(__t(s)); }
    static boolean __pb(String s) { return "true".equalsIgnoreCase(__t(s)); }
    static char __pc(String s) { String v = __ps(s); return v.isEmpty() ? ' ' : v.charAt(0); }

    /** Splits the top level of a JSON array, respecting nesting and quotes. */
    static String[] __items(String s) {
        s = __t(s);
        if (s.startsWith("[") && s.endsWith("]")) s = s.substring(1, s.length() - 1);
        s = __t(s);
        if (s.isEmpty()) return new String[0];
        java.util.List<String> out = new java.util.ArrayList<String>();
        int depth = 0;
        boolean q = false;
        StringBuilder cur = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' && (i == 0 || s.charAt(i - 1) != '\\\\')) q = !q;
            if (!q && c == '[') depth++;
            if (!q && c == ']') depth--;
            if (!q && c == ',' && depth == 0) { out.add(cur.toString()); cur.setLength(0); }
            else cur.append(c);
        }
        out.add(cur.toString());
        return out.toArray(new String[0]);
    }

    static int[] __pia(String s) {
        String[] p = __items(s);
        int[] a = new int[p.length];
        for (int i = 0; i < p.length; i++) a[i] = __pi(p[i]);
        return a;
    }

    static long[] __pla(String s) {
        String[] p = __items(s);
        long[] a = new long[p.length];
        for (int i = 0; i < p.length; i++) a[i] = __pl(p[i]);
        return a;
    }

    static double[] __pda(String s) {
        String[] p = __items(s);
        double[] a = new double[p.length];
        for (int i = 0; i < p.length; i++) a[i] = __pd(p[i]);
        return a;
    }

    static boolean[] __pba(String s) {
        String[] p = __items(s);
        boolean[] a = new boolean[p.length];
        for (int i = 0; i < p.length; i++) a[i] = __pb(p[i]);
        return a;
    }

    static char[] __pca(String s) {
        String[] p = __items(s);
        char[] a = new char[p.length];
        for (int i = 0; i < p.length; i++) a[i] = __pc(p[i]);
        return a;
    }

    static String[] __psa(String s) {
        String[] p = __items(s);
        String[] a = new String[p.length];
        for (int i = 0; i < p.length; i++) a[i] = __ps(p[i]);
        return a;
    }

    static int[][] __pia2(String s) {
        String[] p = __items(s);
        int[][] a = new int[p.length][];
        for (int i = 0; i < p.length; i++) a[i] = __pia(p[i]);
        return a;
    }

    static long[][] __pla2(String s) {
        String[] p = __items(s);
        long[][] a = new long[p.length][];
        for (int i = 0; i < p.length; i++) a[i] = __pla(p[i]);
        return a;
    }

    static double[][] __pda2(String s) {
        String[] p = __items(s);
        double[][] a = new double[p.length][];
        for (int i = 0; i < p.length; i++) a[i] = __pda(p[i]);
        return a;
    }

    static boolean[][] __pba2(String s) {
        String[] p = __items(s);
        boolean[][] a = new boolean[p.length][];
        for (int i = 0; i < p.length; i++) a[i] = __pba(p[i]);
        return a;
    }

    static char[][] __pca2(String s) {
        String[] p = __items(s);
        char[][] a = new char[p.length][];
        for (int i = 0; i < p.length; i++) a[i] = __pca(p[i]);
        return a;
    }

    static String[][] __psa2(String s) {
        String[] p = __items(s);
        String[][] a = new String[p.length][];
        for (int i = 0; i < p.length; i++) a[i] = __psa(p[i]);
        return a;
    }

    static String __esc(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\\\') b.append('\\\\').append(c);
            else if (c == '\\n') b.append("\\\\n");
            else if (c == '\\t') b.append("\\\\t");
            else b.append(c);
        }
        return b.append('"').toString();
    }

    static String __f(int v) { return String.valueOf(v); }
    static String __f(long v) { return String.valueOf(v); }
    static String __f(boolean v) { return v ? "true" : "false"; }
    static String __f(String v) { return __esc(v); }
    static String __f(char v) { return __esc(String.valueOf(v)); }

    static String __f(double v) {
        if (Double.isNaN(v) || Double.isInfinite(v)) return "null";
        String s = String.format(java.util.Locale.ROOT, "%.10g", v);
        if (s.contains(".") && !s.contains("e") && !s.contains("E")) {
            s = s.replaceAll("0+$", "");
            if (s.endsWith(".")) s = s.substring(0, s.length() - 1);
        }
        return s;
    }

    static String __f(int[] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(v[i]); }
        return b.append(']').toString();
    }

    static String __f(long[] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(v[i]); }
        return b.append(']').toString();
    }

    static String __f(double[] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(__f(v[i])); }
        return b.append(']').toString();
    }

    static String __f(boolean[] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(v[i] ? "true" : "false"); }
        return b.append(']').toString();
    }

    static String __f(char[] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(__f(v[i])); }
        return b.append(']').toString();
    }

    static String __f(String[] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(__esc(v[i])); }
        return b.append(']').toString();
    }

    static String __f(int[][] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(__f(v[i])); }
        return b.append(']').toString();
    }

    static String __f(long[][] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(__f(v[i])); }
        return b.append(']').toString();
    }

    static String __f(double[][] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(__f(v[i])); }
        return b.append(']').toString();
    }

    static String __f(boolean[][] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(__f(v[i])); }
        return b.append(']').toString();
    }

    static String __f(char[][] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(__f(v[i])); }
        return b.append(']').toString();
    }

    static String __f(String[][] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(__f(v[i])); }
        return b.append(']').toString();
    }

    /** The j-th argument of the i-th operation. */
    static String __arg(String[] args, int i, int j) {
        if (i >= args.length) return "";
        String[] a = __items(args[i]);
        return j < a.length ? a[j] : "";
    }

    public static void main(String[] args) throws Exception {
        java.io.BufferedReader _br =
            new java.io.BufferedReader(new java.io.InputStreamReader(System.in));
        java.util.List<String> _in = new java.util.ArrayList<String>();
        String _l;
        while ((_l = _br.readLine()) != null) _in.add(_l);

        String[] _ops = __items(_in.size() > 0 ? _in.get(0) : "[]");
        String[] _args = __items(_in.size() > 1 ? _in.get(1) : "[]");

        java.util.List<String> _out = new java.util.ArrayList<String>();
        ${spec.name} obj = new ${spec.name}(${ctorArgs});
        _out.add("null");

        for (int i = 1; i < _ops.length; i++) {
            switch (__ps(_ops[i])) {
${cases}
                default: throw new RuntimeException("unknown operation " + _ops[i]);
            }
        }

        StringBuilder _b = new StringBuilder("[");
        for (int i = 0; i < _out.size(); i++) { if (i > 0) _b.append(','); _b.append(_out.get(i)); }
        System.out.print(_b.append(']').toString());
    }
}
`;
}

/**
 * The harness lives in `public class Main` (Judge0 requires that name) and the
 * student's code stays in a separate non-public `class Solution` in the same
 * file. Our imports come first so a student's own imports — which land between
 * ours and `class Solution` — are still legal.
 */
export function program(spec, studentCode) {
  const decls = spec.params
    .map((p, i) => {
      const type = typeName(p.type, spec, p);
      if (isNodeRefType(p.type)) {
        const source = sourceParamFor(spec, p);
        return `        ${type} ${p.name} = __find(${source.name}, __pi(__line(_in, ${i})));`;
      }
      return `        ${type} ${p.name} = ${PARSERS[p.type]}(__line(_in, ${i}));`;
    })
    .join('\n');

  const args = callParams(spec)
    .map((p) => p.name)
    .join(', ');

  const output = outputParamFor(spec);
  // A void call has nothing to assign, and the answer is read back from the
  // argument the signature nominated.
  const call = output
    ? `        new Solution().${spec.name}(${args});\n        System.out.print(__f(${output.name}));`
    : `        ${typeName(spec.returnType, spec)} _result = new Solution().${spec.name}(${args});\n        System.out.print(__f(_result));`;

  return `import java.util.*;
import java.io.*;

${studentCode}
${nodeClasses(spec)}
public class Main {
    static String __t(String s) { return s == null ? "" : s.trim(); }

    static String __line(java.util.List<String> in, int i) { return i < in.size() ? in.get(i) : ""; }

    static String __ps(String s) {
        s = __t(s);
        if (s.length() >= 2 && s.charAt(0) == '"' && s.charAt(s.length() - 1) == '"') {
            s = s.substring(1, s.length() - 1);
            StringBuilder b = new StringBuilder();
            for (int i = 0; i < s.length(); i++) {
                char c = s.charAt(i);
                if (c == '\\\\' && i + 1 < s.length()) {
                    char n = s.charAt(++i);
                    if (n == 'n') b.append('\\n');
                    else if (n == 't') b.append('\\t');
                    else b.append(n);
                } else b.append(c);
            }
            return b.toString();
        }
        return s;
    }

    static int __pi(String s) { return Integer.parseInt(__t(s)); }
    static long __pl(String s) { return Long.parseLong(__t(s)); }
    static double __pd(String s) { return Double.parseDouble(__t(s)); }
    static boolean __pb(String s) { return "true".equalsIgnoreCase(__t(s)); }

    /* A char arrives as a one-character JSON string: ["5","3","."]. */
    static char __pc(String s) {
        String v = __ps(s);
        return v.isEmpty() ? ' ' : v.charAt(0);
    }

    /** Splits the top level of a JSON array, respecting nesting and quotes. */
    static String[] __items(String s) {
        s = __t(s);
        if (s.startsWith("[") && s.endsWith("]")) s = s.substring(1, s.length() - 1);
        s = __t(s);
        if (s.isEmpty()) return new String[0];
        java.util.List<String> out = new java.util.ArrayList<String>();
        int depth = 0;
        boolean q = false;
        StringBuilder cur = new StringBuilder();
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' && (i == 0 || s.charAt(i - 1) != '\\\\')) q = !q;
            if (!q && c == '[') depth++;
            if (!q && c == ']') depth--;
            if (!q && c == ',' && depth == 0) { out.add(cur.toString()); cur.setLength(0); }
            else cur.append(c);
        }
        out.add(cur.toString());
        return out.toArray(new String[0]);
    }

    static int[] __pia(String s) {
        String[] p = __items(s);
        int[] a = new int[p.length];
        for (int i = 0; i < p.length; i++) a[i] = __pi(p[i]);
        return a;
    }

    static long[] __pla(String s) {
        String[] p = __items(s);
        long[] a = new long[p.length];
        for (int i = 0; i < p.length; i++) a[i] = __pl(p[i]);
        return a;
    }

    static boolean[] __pba(String s) {
        String[] p = __items(s);
        boolean[] a = new boolean[p.length];
        for (int i = 0; i < p.length; i++) a[i] = __pb(p[i]);
        return a;
    }

    static String[] __psa(String s) {
        String[] p = __items(s);
        String[] a = new String[p.length];
        for (int i = 0; i < p.length; i++) a[i] = __ps(p[i]);
        return a;
    }

    static double[] __pda(String s) {
        String[] p = __items(s);
        double[] a = new double[p.length];
        for (int i = 0; i < p.length; i++) a[i] = __pd(p[i]);
        return a;
    }

    static char[] __pca(String s) {
        String[] p = __items(s);
        char[] a = new char[p.length];
        for (int i = 0; i < p.length; i++) a[i] = __pc(p[i]);
        return a;
    }

    static int[][] __pia2(String s) {
        String[] p = __items(s);
        int[][] a = new int[p.length][];
        for (int i = 0; i < p.length; i++) a[i] = __pia(p[i]);
        return a;
    }

    static long[][] __pla2(String s) {
        String[] p = __items(s);
        long[][] a = new long[p.length][];
        for (int i = 0; i < p.length; i++) a[i] = __pla(p[i]);
        return a;
    }

    static double[][] __pda2(String s) {
        String[] p = __items(s);
        double[][] a = new double[p.length][];
        for (int i = 0; i < p.length; i++) a[i] = __pda(p[i]);
        return a;
    }

    static boolean[][] __pba2(String s) {
        String[] p = __items(s);
        boolean[][] a = new boolean[p.length][];
        for (int i = 0; i < p.length; i++) a[i] = __pba(p[i]);
        return a;
    }

    static char[][] __pca2(String s) {
        String[] p = __items(s);
        char[][] a = new char[p.length][];
        for (int i = 0; i < p.length; i++) a[i] = __pca(p[i]);
        return a;
    }

    static String[][] __psa2(String s) {
        String[] p = __items(s);
        String[][] a = new String[p.length][];
        for (int i = 0; i < p.length; i++) a[i] = __psa(p[i]);
        return a;
    }

    static String __esc(String s) {
        if (s == null) return "null";
        StringBuilder b = new StringBuilder("\\"");
        for (int i = 0; i < s.length(); i++) {
            char c = s.charAt(i);
            if (c == '"' || c == '\\\\') b.append('\\\\').append(c);
            else if (c == '\\n') b.append("\\\\n");
            else if (c == '\\t') b.append("\\\\t");
            else b.append(c);
        }
        return b.append('"').toString();
    }

    static String __f(int v) { return String.valueOf(v); }
    static String __f(long v) { return String.valueOf(v); }
    static String __f(boolean v) { return v ? "true" : "false"; }
    static String __f(String v) { return __esc(v); }

    /* A char prints as a one-character JSON string, matching how it is read. */
    static String __f(char v) { return __esc(String.valueOf(v)); }

    /* %.10g keeps this valid JSON and free of the language's own float style;
       the answer is compared numerically within a tolerance regardless. */
    static String __f(double v) {
        if (Double.isNaN(v) || Double.isInfinite(v)) return "null";
        String s = String.format(java.util.Locale.ROOT, "%.10g", v);
        if (s.contains(".") && !s.contains("e") && !s.contains("E")) {
            s = s.replaceAll("0+$", "");
            if (s.endsWith(".")) s = s.substring(0, s.length() - 1);
        }
        return s;
    }

    static String __f(int[] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(v[i]); }
        return b.append(']').toString();
    }

    static String __f(long[] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(v[i]); }
        return b.append(']').toString();
    }

    static String __f(boolean[] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(v[i] ? "true" : "false"); }
        return b.append(']').toString();
    }

    static String __f(String[] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(__esc(v[i])); }
        return b.append(']').toString();
    }

    static String __f(double[] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(__f(v[i])); }
        return b.append(']').toString();
    }

    static String __f(char[] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(__f(v[i])); }
        return b.append(']').toString();
    }

    static String __f(int[][] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(__f(v[i])); }
        return b.append(']').toString();
    }

    static String __f(long[][] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(__f(v[i])); }
        return b.append(']').toString();
    }

    static String __f(double[][] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(__f(v[i])); }
        return b.append(']').toString();
    }

    static String __f(boolean[][] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(__f(v[i])); }
        return b.append(']').toString();
    }

    static String __f(char[][] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(__f(v[i])); }
        return b.append(']').toString();
    }

    static String __f(String[][] v) {
        StringBuilder b = new StringBuilder("[");
        for (int i = 0; i < v.length; i++) { if (i > 0) b.append(','); b.append(__f(v[i])); }
        return b.append(']').toString();
    }
${nodeHelpers(spec)}
    public static void main(String[] args) throws Exception {
        java.io.BufferedReader _br =
            new java.io.BufferedReader(new java.io.InputStreamReader(System.in));
        java.util.List<String> _in = new java.util.ArrayList<String>();
        String _l;
        while ((_l = _br.readLine()) != null) _in.add(_l);

${decls}

${call}
    }
}
`;
}
