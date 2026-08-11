/**
 * Class ("design") questions, in every language, through the real grader.
 *
 * These are posed exactly as LeetCode poses them: the test case is a list of
 * operations plus their arguments, and the answer is one entry per operation.
 *
 *   ["MinStack","push","push","getMin","pop","top"]
 *   [[],[-2],[0],[],[],[]]
 *   -> [null,null,null,-2,null,0]
 *
 *   npm run verify:classes
 */
import mongoose from 'mongoose';
import { connectDb } from '../config/db.js';
import { evaluate } from '../services/grader.js';
import { FUNCTION_LANGUAGES } from '../services/codegen/index.js';

const SUITES = [
  {
    label: 'MinStack (LeetCode 155)',
    spec: {
      name: 'MinStack',
      constructorParams: [],
      methods: [
        { name: 'push', returnType: 'void', params: [{ name: 'val', type: 'int' }] },
        { name: 'pop', returnType: 'void', params: [] },
        { name: 'top', returnType: 'int', params: [] },
        { name: 'getMin', returnType: 'int', params: [] },
      ],
    },
    cases: [
      {
        input:
          '["MinStack","push","push","push","getMin","pop","top","getMin"]\n[[],[-2],[0],[-3],[],[],[],[]]',
        expectedOutput: '[null,null,null,null,-3,null,0,-2]',
        points: 2,
        isSample: true,
      },
      {
        input: '["MinStack","push","getMin","push","getMin"]\n[[],[5],[],[3],[]]',
        expectedOutput: '[null,null,5,null,3]',
        points: 1,
      },
    ],
    solutions: {
      python: `class MinStack:

    def __init__(self):
        self.st = []
        self.mins = []

    def push(self, val: int) -> None:
        self.st.append(val)
        self.mins.append(val if not self.mins else min(val, self.mins[-1]))

    def pop(self) -> None:
        self.st.pop()
        self.mins.pop()

    def top(self) -> int:
        return self.st[-1]

    def getMin(self) -> int:
        return self.mins[-1]
`,
      javascript: `var MinStack = function() {
    this.st = [];
    this.mins = [];
};
MinStack.prototype.push = function(val) {
    this.st.push(val);
    this.mins.push(this.mins.length ? Math.min(val, this.mins[this.mins.length - 1]) : val);
};
MinStack.prototype.pop = function() {
    this.st.pop();
    this.mins.pop();
};
MinStack.prototype.top = function() {
    return this.st[this.st.length - 1];
};
MinStack.prototype.getMin = function() {
    return this.mins[this.mins.length - 1];
};
`,
      java: `class MinStack {
    private java.util.Deque<Integer> st = new java.util.ArrayDeque<>();
    private java.util.Deque<Integer> mins = new java.util.ArrayDeque<>();

    public MinStack() {}

    public void push(int val) {
        st.push(val);
        mins.push(mins.isEmpty() ? val : Math.min(val, mins.peek()));
    }

    public void pop() {
        st.pop();
        mins.pop();
    }

    public int top() { return st.peek(); }

    public int getMin() { return mins.peek(); }
}
`,
      cpp: `class MinStack {
    vector<int> st, mins;
public:
    MinStack() {}

    void push(int val) {
        st.push_back(val);
        mins.push_back(mins.empty() ? val : min(val, mins.back()));
    }

    void pop() {
        st.pop_back();
        mins.pop_back();
    }

    int top() { return st.back(); }

    int getMin() { return mins.back(); }
};
`,
      c: `typedef struct {
    int* st;
    int* mins;
    int n;
} MinStack;

MinStack* minStackCreate(void) {
    MinStack* obj = (MinStack*)malloc(sizeof(MinStack));
    obj->st = (int*)malloc(sizeof(int) * 30000);
    obj->mins = (int*)malloc(sizeof(int) * 30000);
    obj->n = 0;
    return obj;
}

void minStackPush(MinStack* obj, int val) {
    obj->st[obj->n] = val;
    obj->mins[obj->n] = (obj->n == 0 || val < obj->mins[obj->n - 1]) ? val : obj->mins[obj->n - 1];
    obj->n++;
}

void minStackPop(MinStack* obj) { obj->n--; }

int minStackTop(MinStack* obj) { return obj->st[obj->n - 1]; }

int minStackGetMin(MinStack* obj) { return obj->mins[obj->n - 1]; }

void minStackFree(MinStack* obj) {
    free(obj->st);
    free(obj->mins);
    free(obj);
}
`,
    },
  },
  {
    label: 'LRUCache (LeetCode 146)',
    spec: {
      name: 'LRUCache',
      constructorParams: [{ name: 'capacity', type: 'int' }],
      methods: [
        { name: 'get', returnType: 'int', params: [{ name: 'key', type: 'int' }] },
        {
          name: 'put',
          returnType: 'void',
          params: [
            { name: 'key', type: 'int' },
            { name: 'value', type: 'int' },
          ],
        },
      ],
    },
    cases: [
      {
        input:
          '["LRUCache","put","put","get","put","get","put","get","get","get"]\n[[2],[1,1],[2,2],[1],[3,3],[2],[4,4],[1],[3],[4]]',
        expectedOutput: '[null,null,null,1,null,-1,null,-1,3,4]',
        points: 3,
        isSample: true,
      },
      {
        input: '["LRUCache","put","get","get"]\n[[1],[2,1],[2],[1]]',
        expectedOutput: '[null,null,1,-1]',
        points: 2,
      },
    ],
    solutions: {
      python: `class LRUCache:

    def __init__(self, capacity: int):
        from collections import OrderedDict
        self.cap = capacity
        self.d = OrderedDict()

    def get(self, key: int) -> int:
        if key not in self.d:
            return -1
        self.d.move_to_end(key)
        return self.d[key]

    def put(self, key: int, value: int) -> None:
        if key in self.d:
            self.d.move_to_end(key)
        self.d[key] = value
        if len(self.d) > self.cap:
            self.d.popitem(last=False)
`,
      javascript: `var LRUCache = function(capacity) {
    this.cap = capacity;
    this.m = new Map();
};
LRUCache.prototype.get = function(key) {
    if (!this.m.has(key)) return -1;
    const v = this.m.get(key);
    this.m.delete(key);
    this.m.set(key, v);
    return v;
};
LRUCache.prototype.put = function(key, value) {
    if (this.m.has(key)) this.m.delete(key);
    this.m.set(key, value);
    if (this.m.size > this.cap) this.m.delete(this.m.keys().next().value);
};
`,
      java: `class LRUCache {
    private final int cap;
    private final java.util.LinkedHashMap<Integer, Integer> m;

    public LRUCache(int capacity) {
        cap = capacity;
        m = new java.util.LinkedHashMap<>(16, 0.75f, true);
    }

    public int get(int key) {
        return m.getOrDefault(key, -1);
    }

    public void put(int key, int value) {
        m.put(key, value);
        if (m.size() > cap) {
            java.util.Iterator<Integer> it = m.keySet().iterator();
            it.next();
            it.remove();
        }
    }
}
`,
      cpp: `class LRUCache {
    int cap;
    list<pair<int,int>> lru;
    unordered_map<int, list<pair<int,int>>::iterator> pos;
public:
    LRUCache(int capacity) : cap(capacity) {}

    int get(int key) {
        auto it = pos.find(key);
        if (it == pos.end()) return -1;
        lru.splice(lru.begin(), lru, it->second);
        return it->second->second;
    }

    void put(int key, int value) {
        auto it = pos.find(key);
        if (it != pos.end()) {
            it->second->second = value;
            lru.splice(lru.begin(), lru, it->second);
            return;
        }
        if ((int)lru.size() == cap) {
            pos.erase(lru.back().first);
            lru.pop_back();
        }
        lru.push_front({key, value});
        pos[key] = lru.begin();
    }
};
`,
      c: `typedef struct LRUNode {
    int key, value;
    struct LRUNode *prev, *next;
} LRUNode;

typedef struct {
    int cap, size;
    LRUNode *head, *tail;
} LRUCache;

LRUCache* lRUCacheCreate(int capacity) {
    LRUCache* obj = (LRUCache*)malloc(sizeof(LRUCache));
    obj->cap = capacity;
    obj->size = 0;
    obj->head = NULL;
    obj->tail = NULL;
    return obj;
}

static LRUNode* __find(LRUCache* obj, int key) {
    for (LRUNode* n = obj->head; n; n = n->next) if (n->key == key) return n;
    return NULL;
}

static void __unlink(LRUCache* obj, LRUNode* n) {
    if (n->prev) n->prev->next = n->next; else obj->head = n->next;
    if (n->next) n->next->prev = n->prev; else obj->tail = n->prev;
    n->prev = n->next = NULL;
}

static void __pushFront(LRUCache* obj, LRUNode* n) {
    n->prev = NULL;
    n->next = obj->head;
    if (obj->head) obj->head->prev = n;
    obj->head = n;
    if (!obj->tail) obj->tail = n;
}

int lRUCacheGet(LRUCache* obj, int key) {
    LRUNode* n = __find(obj, key);
    if (!n) return -1;
    __unlink(obj, n);
    __pushFront(obj, n);
    return n->value;
}

void lRUCachePut(LRUCache* obj, int key, int value) {
    LRUNode* n = __find(obj, key);
    if (n) {
        n->value = value;
        __unlink(obj, n);
        __pushFront(obj, n);
        return;
    }
    if (obj->size == obj->cap) {
        LRUNode* victim = obj->tail;
        __unlink(obj, victim);
        free(victim);
        obj->size--;
    }
    n = (LRUNode*)malloc(sizeof(LRUNode));
    n->key = key;
    n->value = value;
    __pushFront(obj, n);
    obj->size++;
}

void lRUCacheFree(LRUCache* obj) {
    LRUNode* n = obj->head;
    while (n) { LRUNode* nx = n->next; free(n); n = nx; }
    free(obj);
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
      classSpec: suite.spec,
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
console.log(`\n  ${pass} of ${total} class checks passing\n`);
await mongoose.disconnect();
process.exit(fail ? 1 : 0);
