import {
  baseOf,
  callParams,
  dimsOf,
  isNodeRefType,
  isNodeType,
  nodeTypesUsed,
  outputParamFor,
  sourceParamFor,
  visibleOutputParam,
} from './types.js';

const SCALARS = {
  int: 'number',
  long: 'number',
  double: 'number',
  boolean: 'boolean',
  char: 'character',
  string: 'string',
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

const NODE_COMMENTS = {
  list: `/**
 * Definition for singly-linked list.
 * function ListNode(val, next) {
 *     this.val = (val === undefined ? 0 : val)
 *     this.next = (next === undefined ? null : next)
 * }
 */
`,
  tree: `/**
 * Definition for a binary tree node.
 * function TreeNode(val, left, right) {
 *     this.val = (val === undefined ? 0 : val)
 *     this.left = (left === undefined ? null : left)
 *     this.right = (right === undefined ? null : right)
 * }
 */
`,
};

export function stub(spec) {
  const passed = callParams(spec);
  const output = visibleOutputParam(spec);

  const doc = [
    '/**',
    ...passed.map((p) => ` * @param {${typeName(p.type, spec, p)}} ${p.name}`),
    // JSDoc for a void function names what the caller will look at instead.
    output
      ? ` * @return {void} Do not return anything, modify ${output.name} in-place instead.`
      : ` * @return {${typeName(spec.returnType, spec)}}`,
    ' */',
  ].join('\n');

  const header = nodeTypesUsed(spec)
    .map((t) => NODE_COMMENTS[t])
    .join('');

  const params = passed.map((p) => p.name).join(', ');
  return `${header}${doc}
var ${spec.name} = function(${params}) {

};
`;
}

function nodeSupport(spec) {
  const used = nodeTypesUsed(spec);
  if (!used.length) return '';

  let out = '';

  if (used.includes('list')) {
    out += `function ListNode(val, next) {
  this.val = val === undefined ? 0 : val;
  this.next = next === undefined ? null : next;
}

function _ccaBuildList(a) {
  let head = null;
  const src = a || [];
  for (let i = src.length - 1; i >= 0; i -= 1) head = new ListNode(src[i], head);
  return head;
}

function _ccaFindInList(head, val) {
  for (let node = head; node; node = node.next) if (node.val === val) return node;
  throw new Error('no node with value ' + val + ' in the list');
}

function _ccaDumpList(node) {
  const out = [];
  const seen = new Set();
  // A cycle should score as a wrong answer, not hang until the time limit.
  while (node !== null && node !== undefined && !seen.has(node)) {
    seen.add(node);
    out.push(node.val);
    node = node.next;
  }
  return out;
}

`;
  }

  if (used.includes('tree')) {
    out += `function TreeNode(val, left, right) {
  this.val = val === undefined ? 0 : val;
  this.left = left === undefined ? null : left;
  this.right = right === undefined ? null : right;
}

function _ccaBuildTree(a) {
  const src = a || [];
  if (!src.length || src[0] === null) return null;
  const root = new TreeNode(src[0]);
  const q = [root];
  let i = 1;
  while (q.length && i < src.length) {
    const node = q.shift();
    if (i < src.length) {
      const v = src[i];
      i += 1;
      if (v !== null) {
        node.left = new TreeNode(v);
        q.push(node.left);
      }
    }
    if (i < src.length) {
      const v = src[i];
      i += 1;
      if (v !== null) {
        node.right = new TreeNode(v);
        q.push(node.right);
      }
    }
  }
  return root;
}

function _ccaFindInTree(root, val) {
  const q = [root];
  while (q.length) {
    const node = q.shift();
    if (!node) continue;
    if (node.val === val) return node;
    q.push(node.left, node.right);
  }
  throw new Error('no node with value ' + val + ' in the tree');
}

function _ccaDumpTree(root) {
  if (root === null || root === undefined) return [];
  const out = [];
  const q = [root];
  while (q.length) {
    const node = q.shift();
    if (node === null || node === undefined) {
      out.push(null);
    } else {
      out.push(node.val);
      q.push(node.left === undefined ? null : node.left);
      q.push(node.right === undefined ? null : node.right);
    }
  }
  while (out.length && out[out.length - 1] === null) out.pop();
  return out;
}

`;
  }

  return out;
}

const READ = { list: '_ccaBuildList', tree: '_ccaBuildTree' };
const WRITE = { list: '_ccaDumpList', tree: '_ccaDumpTree' };

// ---------------------------------------------------------------------------
// Class ("design") questions.
// ---------------------------------------------------------------------------

export function classStub(spec) {
  const ctorArgs = spec.constructorParams.map((p) => p.name).join(', ');

  const ctorDoc = [
    '/**',
    ...spec.constructorParams.map((p) => ` * @param {${typeName(p.type, spec, p)}} ${p.name}`),
    ' */',
  ].join('\n');

  const methods = spec.methods
    .map((m) => {
      const doc = [
        '/**',
        ...m.params.map((p) => ` * @param {${typeName(p.type, spec, p)}} ${p.name}`),
        ` * @return {${typeName(m.returnType, spec)}}`,
        ' */',
      ].join('\n');
      const args = m.params.map((p) => p.name).join(', ');
      return `${doc}\n${spec.name}.prototype.${m.name} = function(${args}) {\n\n};\n`;
    })
    .join('\n');

  const calls = spec.methods
    .map((m) => ` * obj.${m.name}(${m.params.map((p) => p.name).join(', ')})`)
    .join('\n');

  return `${ctorDoc}
var ${spec.name} = function(${ctorArgs}) {

};

${methods}
/**
 * Your ${spec.name} object will be instantiated and called as such:
 * var obj = new ${spec.name}(${ctorArgs})
${calls}
 */
`;
}

export function classProgram(spec, studentCode) {
  return `${studentCode}

const _ccaLines = require('fs').readFileSync(0, 'utf8').split('\\n');
const _ccaOps = JSON.parse(_ccaLines[0]);
const _ccaArgs = _ccaLines[1] && _ccaLines[1].trim() ? JSON.parse(_ccaLines[1]) : [];

let _ccaObj = null;
const _ccaOut = [];
for (let i = 0; i < _ccaOps.length; i++) {
  const a = _ccaArgs[i] || [];
  if (i === 0) {
    _ccaObj = new ${spec.name}(...a);
    _ccaOut.push(null);
  } else {
    const r = _ccaObj[_ccaOps[i]](...a);
    // A method that returns nothing must appear as null, not as undefined,
    // which JSON.stringify would drop from the array entirely.
    _ccaOut.push(r === undefined ? null : r);
  }
}

process.stdout.write(JSON.stringify(_ccaOut));
`;
}

export function program(spec, studentCode) {
  // Every parameter is built as its own binding, because a `node` parameter has
  // to look inside an earlier one and a void function's answer is read back
  // after the call.
  const decls = spec.params
    .map((p, i) => {
      const raw = `JSON.parse(_ccaLines[${i}])`;
      if (isNodeRefType(p.type)) {
        const source = sourceParamFor(spec, p);
        const finder = source.type === 'tree' ? '_ccaFindInTree' : '_ccaFindInList';
        return `const ${p.name} = ${finder}(${source.name}, ${raw});`;
      }
      return `const ${p.name} = ${isNodeType(p.type) ? `${READ[p.type]}(${raw})` : raw};`;
    })
    .join('\n');

  const args = callParams(spec)
    .map((p) => p.name)
    .join(', ');

  const output = outputParamFor(spec);
  const answer = output ? output.name : '_ccaResult';
  const answerType = output ? output.type : spec.returnType;
  const result = isNodeType(answerType) ? `${WRITE[answerType]}(${answer})` : answer;

  return `${nodeSupport(spec)}${studentCode}

const _ccaLines = require('fs').readFileSync(0, 'utf8').split('\\n');
${decls}
const _ccaResult = ${spec.name}(${args});
process.stdout.write(JSON.stringify(${result}));
`;
}
