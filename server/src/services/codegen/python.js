import {
  baseOf,
  callParams,
  dimsOf,
  isNodeRefType,
  isNodeType,
  nodeTypesUsed,
  outputParamFor,
  sourceParamFor,
} from './types.js';

// `char` is a one-character `str` in Python, which is also how it travels on
// the wire — LeetCode writes a Sudoku board as [["5","3"],["6","."]].
const SCALARS = {
  int: 'int',
  long: 'int',
  double: 'float',
  boolean: 'bool',
  char: 'str',
  string: 'str',
};

export function typeName(type, spec, param) {
  if (type === 'void') return 'None';
  if (type === 'list') return 'Optional[ListNode]';
  if (type === 'tree') return 'Optional[TreeNode]';
  if (isNodeRefType(type)) {
    // A node parameter is typed as a node of whatever it was taken from.
    const source = sourceParamFor(spec, param);
    return source?.type === 'tree' ? 'TreeNode' : 'ListNode';
  }
  let name = SCALARS[baseOf(type)];
  for (let i = 0; i < dimsOf(type); i += 1) name = `List[${name}]`;
  return name;
}

/**
 * The node definitions, commented out above the signature — exactly how
 * LeetCode presents them. The real classes live in the hidden driver, so this
 * is documentation for the student rather than code they must keep.
 */
const NODE_COMMENTS = {
  list: `# Definition for singly-linked list.
# class ListNode:
#     def __init__(self, val=0, next=None):
#         self.val = val
#         self.next = next
`,
  tree: `# Definition for a binary tree node.
# class TreeNode:
#     def __init__(self, val=0, left=None, right=None):
#         self.val = val
#         self.left = left
#         self.right = right
`,
};

export function stub(spec) {
  const params = callParams(spec)
    .map((p) => `${p.name}: ${typeName(p.type, spec, p)}`)
    .join(', ');
  const header = nodeTypesUsed(spec)
    .map((t) => NODE_COMMENTS[t])
    .join('');

  return `${header}class Solution:
    def ${spec.name}(self, ${params}) -> ${typeName(spec.returnType, spec)}:

`;
}

/** Only the helpers a signature actually needs, so the driver stays readable. */
function nodeSupport(spec) {
  const used = nodeTypesUsed(spec);
  if (!used.length) return '';

  let out = '\n';

  if (used.includes('list')) {
    out += `class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next


def _cca_build_list(a):
    head = None
    for v in reversed(a or []):
        head = ListNode(v, head)
    return head


def _cca_find_in_list(head, val):
    node = head
    while node is not None:
        if node.val == val:
            return node
        node = node.next
    raise ValueError("no node with value %r in the list" % (val,))


def _cca_dump_list(node):
    out = []
    seen = set()
    while node is not None:
        # A student who accidentally builds a cycle should get a wrong answer,
        # not a judge that hangs until the time limit.
        if id(node) in seen:
            break
        seen.add(id(node))
        out.append(node.val)
        node = node.next
    return out


`;
  }

  if (used.includes('tree')) {
    out += `class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right


def _cca_build_tree(a):
    a = a or []
    if not a or a[0] is None:
        return None
    root = TreeNode(a[0])
    q = [root]
    i = 1
    while q and i < len(a):
        node = q.pop(0)
        if i < len(a):
            v = a[i]
            i += 1
            if v is not None:
                node.left = TreeNode(v)
                q.append(node.left)
        if i < len(a):
            v = a[i]
            i += 1
            if v is not None:
                node.right = TreeNode(v)
                q.append(node.right)
    return root


def _cca_find_in_tree(root, val):
    q = [root]
    while q:
        node = q.pop(0)
        if node is None:
            continue
        if node.val == val:
            return node
        q.append(node.left)
        q.append(node.right)
    raise ValueError("no node with value %r in the tree" % (val,))


def _cca_dump_tree(root):
    if root is None:
        return []
    out = []
    q = [root]
    while q:
        node = q.pop(0)
        if node is None:
            out.append(None)
        else:
            out.append(node.val)
            q.append(node.left)
            q.append(node.right)
    while out and out[-1] is None:
        out.pop()
    return out


`;
  }

  return out;
}

const READ = {
  list: (expr) => `_cca_build_list(${expr})`,
  tree: (expr) => `_cca_build_tree(${expr})`,
};

const WRITE = {
  list: (expr) => `_cca_dump_list(${expr})`,
  tree: (expr) => `_cca_dump_tree(${expr})`,
};

// ---------------------------------------------------------------------------
// Class ("design") questions — LRU Cache, Min Stack, Implement Trie.
// ---------------------------------------------------------------------------

export function classStub(spec) {
  const ctorParams = spec.constructorParams
    .map((p) => `, ${p.name}: ${typeName(p.type, spec, p)}`)
    .join('');

  const methods = spec.methods
    .map((m) => {
      const params = m.params.map((p) => `, ${p.name}: ${typeName(p.type, spec, p)}`).join('');
      return `    def ${m.name}(self${params}) -> ${typeName(m.returnType, spec)}:\n\n`;
    })
    .join('');

  const calls = spec.methods
    .map((m) => `# obj.${m.name}(${m.params.map((p) => p.name).join(', ')})`)
    .join('\n# ');

  return `class ${spec.name}:

    def __init__(self${ctorParams}):


${methods}
# Your ${spec.name} object will be instantiated and called as such:
# obj = ${spec.name}(${spec.constructorParams.map((p) => p.name).join(', ')})
# ${calls}
`;
}

export function classProgram(spec, studentCode) {
  // Python can dispatch by name, so the harness needs no per-method switch.
  return `import json as _cca_json, sys as _cca_sys
import json, sys
from typing import List, Optional, Dict, Set, Tuple

${studentCode}


def _cca_main():
    _lines = _cca_sys.stdin.read().split('\\n')
    _ops = _cca_json.loads(_lines[0])
    _args = _cca_json.loads(_lines[1]) if len(_lines) > 1 and _lines[1].strip() else []

    _obj = None
    _out = []
    for _i, _op in enumerate(_ops):
        _a = _args[_i] if _i < len(_args) else []
        if _i == 0:
            _obj = ${spec.name}(*_a)
            _out.append(None)
        else:
            _out.append(getattr(_obj, _op)(*_a))

    _cca_sys.stdout.write(_cca_json.dumps(_out, separators=(',', ':')))


_cca_main()
`;
}

export function program(spec, studentCode) {
  const reads = spec.params
    .map((p, i) => {
      const raw = `_cca_json.loads(_lines[${i}])`;
      if (isNodeRefType(p.type)) {
        // The test case gives the value identifying the node; the harness walks
        // the structure it belongs to and hands the student that node.
        const source = sourceParamFor(spec, p);
        const finder = source.type === 'tree' ? '_cca_find_in_tree' : '_cca_find_in_list';
        return `    ${p.name} = ${finder}(${source.name}, ${raw})`;
      }
      const value = isNodeType(p.type) ? READ[p.type](raw) : raw;
      return `    ${p.name} = ${value}`;
    })
    .join('\n');

  const args = callParams(spec)
    .map((p) => p.name)
    .join(', ');

  // A void function's answer is the final state of one of its arguments.
  const output = outputParamFor(spec);
  const answer = output ? output.name : '_raw';
  const answerType = output ? output.type : spec.returnType;
  const result = isNodeType(answerType) ? WRITE[answerType](answer) : answer;

  // The harness aliases its imports (`_cca_json`, `_cca_sys`) so that a student
  // who shadows `json` or `sys` in their own code cannot break the driver.
  return `import json as _cca_json, sys as _cca_sys
import json, sys
from typing import List, Optional, Dict, Set, Tuple
${nodeSupport(spec)}
${studentCode}


def _cca_main():
    _lines = _cca_sys.stdin.read().split('\\n')
${reads}
    _raw = Solution().${spec.name}(${args})
    _result = ${result}
    _cca_sys.stdout.write(_cca_json.dumps(_result, separators=(',', ':')))


_cca_main()
`;
}
