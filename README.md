# KPR Coding Platform — secure college coding-examination platform

A MERN platform for running in-class programming tests. Teachers write questions
and test cases, enrolled students solve them in a locked-down browser, solutions
are auto-graded against the test cases, and students get their score immediately
plus an optional AI explanation afterwards.

```
client/   React 18 + Vite + Tailwind v4 + Monaco   (port 5173)
server/   Express + MongoDB/Mongoose + Socket.IO   (port 4000)
```

---

## Quick start

```bash
npm install
cp server/.env.example server/.env
npm run seed
npm run dev
```

Open <http://localhost:5173>. With `ALLOW_DEV_LOGIN=true` you can sign in without
Google credentials using any seeded address:

| Email                    | Role    |
| ------------------------ | ------- |
| `teacher@college.edu`    | teacher |
| `student@college.edu`    | student |
| `student2@college.edu`   | student |

The seed also creates two questions and one live practice test.

**Prerequisites:** Node 20+, and MongoDB running locally (or set `MONGODB_URI`).

### "My student can't see the test"

```bash
npm run diagnose
```

Prints every account and every test with the three access conditions checked
per student, so the failing one is obvious. A test is invisible to students
unless **all** of these hold:

1. its status is `published` (a new test starts as a **draft**),
2. the student's email is on that test's allowlist, and
3. the current time is inside the scheduled window.

A published test outside its window still *appears* in the student's list,
marked "Opens soon" or "Closed" — it just can't be started.

---

## The six rules this codebase is built around

These are load-bearing. Changing any of them breaks the security model.

1. **Student code never runs on the server process.** Everything goes through
   `server/src/services/executor.js`, which routes to Judge0's sandbox.
2. **Judge0 is never exposed to the browser.** Its URL and token stay server-side;
   the client only ever talks to our own API.
3. **Grading is deterministic and test-case based.** `services/grader.js` compares
   program output to stored expected output. No language model is involved in a
   score, ever — the AI review is explanatory only and runs after the fact.
4. **Submissions are persisted before grading.** A judge outage leaves a
   recoverable `error` row, never a lost answer.
5. **All enforcement is server-side.** The browser only *reports* events;
   `services/violations.js` decides what counts and `accessGate.js` decides who
   may enter. Tampering with client code changes nothing.
6. **The test link is not the security boundary.** Access needs a Google-verified
   email on that test's allowlist **and** the current time inside the window
   **and** no other active session for that student.

---

## Multiple choice

A question is **coding** or **multiple choice**, chosen on the question editor's
first tab. A test mixes them freely — it is MCQ-only, coding-only, or both,
purely by which questions you add. There is no switch to turn on.

MCQ supports single or multiple correct answers, optional **partial credit** on
multi-select (each correct tick earns a share, each wrong tick cancels one out),
optional **negative marking**, and **per-student option shuffling**.

Three decisions worth knowing, because they are what make MCQ safe rather than
merely present:

- **The answer key never reaches the browser.** The student payload carries only
  `id` and `text` per option — no `isCorrect`, no explanation.
- **MCQ is graded when the attempt finishes, not on submit.** There is no submit
  button for an MCQ at all; the selection auto-saves like a code draft. Grading
  on demand would let a student find the right option by resubmitting each one
  and watching the verdict.
- **Options are shuffled per student**, seeded by the attempt, so neighbours see
  a different order but a student sees the same order across reloads.

Unanswered scores 0 and is never penalised — negative marking is for a wrong
answer, not for leaving a question alone. Individual questions can go negative
and the teacher sees that, but the **paper total is floored at zero**.

## How an answer is checked

Exact text by default, after normalising line endings and trailing whitespace —
a student loses marks for a wrong answer, never for a stray newline. Two switches
on each question loosen it, because for some problems exact text would mark a
**correct** answer wrong:

| Setting | For | Effect |
| --- | --- | --- |
| Order does not matter | 3Sum, Group Anagrams, Subsets | The answer is compared as a set |
| …nor inside each element | 3Sum yes, Permutations no | The same, one level down |
| Numeric tolerance | anything returning a fraction | Numbers compared numerically, not as text |

The two ordering switches are separate on purpose: "Permutations" accepts its
permutations in any order but each permutation is a specific sequence.

Comparison canonicalises innermost-first — an outer array can only be sorted
meaningfully once its elements already are, or `[[0,-1,1],[2,-1,-1]]` gets paired
against the wrong triplets.

A `double` answer gets a tolerance automatically if the teacher left it at zero,
since the five languages genuinely print floating point differently (`2` in
JavaScript, `2.0` in Python and Java) and exact text would fail every student on
a perfectly well-posed question.

## Three kinds of coding question

**Function signature is the default.** A new question is LeetCode-shaped unless
you deliberately switch it. Standard I/O remains available as the escape hatch
for problems the type system cannot express.

Legacy questions were pinned to their real mode by a one-time migration before
the default changed, so nothing was silently reinterpreted:

```bash
npm run migrate:iomode   # safe to re-run; also repairs a function question with no signature
```


Each question picks how the student answers, on the **Answer format** tab.

### Function signature (LeetCode style) — `ioMode: 'function'`

The teacher defines a signature; the platform does the rest:

- **Generated starter code** per language, so the student opens onto something
  that already compiles with the arguments in scope.
- **A generated harness** (never shown to the student) reads the arguments from
  stdin, calls their function, and prints the return value as canonical JSON.

A test case is then one JSON argument per line, and the expected value is the
JSON the function returns:

```
[2,7,11,15]      <- nums
9                <- target
```
expecting `[0,1]`.

This is what makes a LeetCode-shaped question runnable on a stdin/stdout judge.
It is why a student can write `nums.length` and `return new int[]{...}` and have
it simply work.

Supported in **every language the platform offers** — Python, JavaScript, Java,
C++ and C. Types are `int`, `long`, `boolean`, `string` and their 1-D/2-D array
forms, plus the two node types below. Floating point is deliberately excluded:
the five languages format it differently, so an exact comparison would fail for
reasons unrelated to the student's answer. Use standard I/O for those.

#### Linked lists and binary trees — `list` and `tree`

DSA questions are the point of a college paper, so these are first-class types
rather than a reason to fall back to stdin. They work exactly as they do on
LeetCode: **the teacher writes an array, the student receives real nodes.**

| Type   | Written in a test case as               | The student's function receives |
| ------ | --------------------------------------- | ------------------------------- |
| `list` | `[1,2,3]`, or `[]` for empty            | a `ListNode` chain              |
| `tree` | `[3,9,20,null,null,15,7]` (level order) | a `TreeNode` root               |

The node definition appears commented above the signature — again as on LeetCode
— and the real class lives in the hidden harness, so a student cannot break it:

```python
# Definition for singly-linked list.
# class ListNode:
#     def __init__(self, val=0, next=None):
#         self.val = val
#         self.next = next
class Solution:
    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:
```

Returning nodes serialises back to the same array form, so one stored expected
output works in all five languages. Trailing `null`s are trimmed from a tree, and
both serialisers are cycle-bounded: a student who accidentally links a node to
itself gets a wrong answer rather than a judge that spins until the time limit.

In Java the node classes are emitted *after* the student's code — Java forbids an
`import` after a type declaration, and students do write their own imports.

#### When the answer is a mutated argument — `void`

Plenty of classic problems return nothing: the answer is the state an argument is
left in. LeetCode's "Move Zeroes", "Rotate Image", "Merge Sorted Array" and
"Delete Node in a Linked List" are all this shape. Choose `void` as the return
type and then nominate which parameter holds the answer:

```
returns    void
answer is  nums
```

The harness calls the function for its side effect and prints that parameter
afterwards. The student sees the same note LeetCode shows them:

```java
class Solution {
    /** Do not return anything, modify nums in-place instead. */
    public void moveZeroes(int[] nums) {
```

#### Harness-only parameters and the `node` type

Two smaller pieces let a signature differ from the test-case shape, which is what
makes "Delete Node in a Linked List" posable at all — that problem hands the
student a node *without* the head.

- **`harnessOnly`** on a parameter: built from the test case, but withheld from
  the signature. Useful when it is the answer, or the source of a `node`.
- **`node`** as a parameter type: written in the test case as just a value, and
  the harness finds the node with that value inside the `list` or `tree`
  parameter you point it at (`of`).

Together:

| Parameter | Type   | Notes                       |
| --------- | ------ | --------------------------- |
| `head`    | `list` | harness-only, and the answer |
| `node`    | `node` | of `head`                   |

Test case `[4,5,1,9]` / `5` expecting `[4,1,9]`, and the student opens onto
exactly what LeetCode gives them:

```java
class Solution {
    public void deleteNode(ListNode node) {
```

C has no vectors and no length-carrying arrays, so its generator follows
LeetCode's own C convention, which students who have used that site will
recognise: an array parameter is followed by an `int` size parameter, an array
return value uses a trailing `int* returnSize` out-parameter, and 2-D arrays
also carry column sizes.

```c
int* twoSum(int* nums, int numsSize, int target, int* returnSize)
```

### Verifying the generators

```bash
npm run verify:compare     # the answer-comparison rules, in isolation
npm run verify:languages   # one question, all five languages, through the real grader
npm run verify:nodes       # list, tree, node and void/in-place questions
npm run verify:types       # char, char[][], double and the wider type matrix
npm run verify:classes     # design problems (MinStack, LRUCache) in every language
npm run verify:native      # compiles the generated C and C++ across the type matrix
npm run verify:seed        # every seeded question against a correct solution, per language
```

`verify:native` compiles with `-Wall` on purpose. It was written after the C
generator shipped a bug that only a warning revealed: `strdup` is POSIX, not ISO
C, so under `-std=c11` it is undeclared, GCC assumes it returns `int`, and the
truncated pointer segfaults on 64-bit. The generator now carries its own `__dup`.

### Design problems — `ioMode: 'class'`

For LRU Cache, Min Stack, Implement Trie. The teacher defines a constructor and
methods; the test case is a list of operations and their arguments, exactly as
LeetCode writes it:

```
["LRUCache","put","put","get","put","get"]
[[2],[1,1],[2,2],[1],[3,3],[2]]
```
expecting `[null,null,null,1,null,-1]` — one entry per operation, `null` for the
constructor and for any method that returns nothing.

The student gets the real LeetCode stub, including the comment showing how their
object will be used. C has no classes, so it follows LeetCode's own C convention
— an opaque struct plus `lRUCacheCreate`, `lRUCacheGet`, `lRUCacheFree`, with the
object as the first argument.

Dispatch is by method name, so overloads are rejected at authoring time, and
`list`/`tree` types are not available here (a method call has no way to name the
structure a node would come from).

### Standard input/output — `ioMode: 'stdin'` (default)

The student writes a whole program that reads stdin and prints stdout. Use it
for anything the type list above cannot express.

**No editor is ever blank.** A stdin question with no hand-written starter falls
back to a generated per-language skeleton — the includes, the entry point, and
the line that reads stdin. Each one compiles and runs untouched, so a student who
presses Run before writing anything gets a wrong answer rather than a compile
error that looks like the platform is broken. A teacher's own starter code on the
**Starter code** tab always wins.

Students also get **one editor buffer per language** and a **Reset to template**
button, so switching from Java to Python and back does not lose either draft, and
a mangled stub is always recoverable.

---

## The solve screen

Close to LeetCode's, deliberately — students should not have to learn a new tool
during an exam.

- **Run** executes the visible samples only and is never scored. **Submit** runs
  every case including the hidden ones.
- A **failed sample shows Input, Your output and Expected together**, so a
  student can see what went wrong without scrolling back to the statement.
  Hidden cases show a verdict and nothing else, ever.
- **Own input** — tick it and Run executes against input the student types
  instead of the samples, the way LeetCode lets you edit the testcase. It goes
  through the same sandbox and the same queue, is never compared to anything
  (the verdict reads "Ran", not "Accepted"), and Submit always ignores it. It is
  stored with the attempt, so a teacher can see what a student was probing.

---

## Code execution

All execution goes through one adapter. Pick a backend with `EXECUTOR`.

### `EXECUTOR=judge0` — required for production

Self-host Judge0 with Docker and point `JUDGE0_URL` at it:

```bash
wget https://github.com/judge0/judge0/releases/download/v1.13.1/judge0-v1.13.1.zip
unzip judge0-v1.13.1.zip && cd judge0-v1.13.1
# set REDIS_PASSWORD and POSTGRES_PASSWORD in judge0.conf first
docker compose up -d db redis && sleep 10 && docker compose up -d
```

```env
EXECUTOR=judge0
JUDGE0_URL=http://localhost:2358
JUDGE0_TOKEN=            # if you set AUTHN_TOKEN in judge0.conf
```

Judge0 Cloud works too — set `JUDGE0_RAPIDAPI_KEY` instead of `JUDGE0_URL`.

Submissions use Judge0's **asynchronous batch** mode with polling, which is what
keeps the judge responsive when a whole class submits at once. Expected output is
deliberately *not* sent to Judge0 — we compare it ourselves so output
normalization stays under our control.

### `EXECUTOR=local` — development only

Runs code as a normal child process on the host with a wall-clock timeout and an
output cap. **It is not a sandbox** — no filesystem isolation, no memory cap. It
exists so the platform can be developed and demoed without Docker. The server
**refuses to boot** with `NODE_ENV=production` unless `EXECUTOR=judge0`.

Languages fall back to whatever is installed locally. On Windows, where `gcc`
and `g++` are usually absent, the dev executor **falls back to WSL** if it is
available — it compiles and runs the same command inside WSL and translates the
paths, so C and C++ questions can still be exercised locally. Production uses
Judge0 and never touches any of this.

---

## A whole college submitting at once

An exam is the worst possible traffic shape: nothing for an hour, then every
student in the hall presses **Submit** inside the same minute. Four things carry
that load.

**Grading happens after the response, not inside it.** Submitting persists the
row and returns `202 { submissionId, status: 'pending' }` immediately; the
browser polls `GET /exam/submissions/:id/result` with a backoff that widens from
400 ms to 2.5 s. Holding a request open for a Judge0 round trip is fine for one
student and fatal for a thousand — every browser on a spinner, proxies timing
out, and a client that gives up losing a result the server already computed.

**One bounded queue in front of the judge.** `services/limiter.js` caps
concurrent executions at `JUDGE0_MAX_CONCURRENT` (16 by default) and queues the
rest, so a rush becomes a steady stream instead of a stampede. Past
`GRADING_MAX_QUEUE` the API says "try again" rather than letting the backlog grow
without bound. This is deliberately in-process rather than Redis/BullMQ — one
API process is the documented deployment, and an extra moving part in the
critical path of an exam is a liability.

**Work for one attempt is serialised.** Two submissions from the same student
would otherwise read-modify-write their attempt's total concurrently and one
would clobber the other.

**A dropped connection cannot cost a student their answer.** Run and Submit
carry a `clientToken` — a random id minted per press of the button. If the
connection drops, the browser resends the *same* token and the server returns the
submission it already made instead of filing the answer twice; a partial unique
index on `(student, clientToken)` settles the case where two retries race. The
client retries transport failures (never HTTP errors) on sign-in, attempt start,
run, submit and finish — but deliberately **not** on the heartbeat, where a
repeat could count a violation twice.

Restart safety: `recoverPendingSubmissions()` re-queues anything left `pending`
when the process died, so a mid-exam restart cannot strand a submission.

### Measuring it

```bash
npm run loadtest -- 1000 --ramp 20
```

Every simulated student signs in, sets a name, starts an attempt, autosaves,
heartbeats and submits. `--ramp N` spreads arrivals over N seconds; omit it for
the pathological all-at-once burst. The script creates its own throwaway test
and accounts and deletes them afterwards.

Measured on one Windows dev box — MongoDB, API and 1000 simulated students all
on the same machine, with the **local** executor at `LOCAL_MAX_CONCURRENT=8`:

| Scenario | Completed | Grading errors | Duplicates | p95 submit |
| -------- | --------- | -------------- | ---------- | ---------- |
| 1000, arriving over 20 s | 1000/1000 | 0 | 0 | 3.8 s |
| 1000, all in one instant | 1000/1000 | 0 | 0 | 3.6 s |

The instantaneous case only reaches 1000 *because of* the retry: one process
opening 6000 sockets in a single tick overruns the OS accept queue and Windows
refuses several hundred connects outright. Those clear on a retry a few hundred
milliseconds later — the server has the capacity, the burst just exceeds what a
TCP accept queue absorbs in one instant. A real hall never produces it (1000
separate machines, separate addresses, arriving over seconds), and a production
deployment puts nginx in front, which absorbs it properly.

The real throughput ceiling is the judge, not the API: doubling
`LOCAL_MAX_CONCURRENT` from 4 to 8 took grading from 7.4/s to 12.3/s with API
latency unchanged. **To grade a large cohort faster, run more Judge0 workers and
raise `JUDGE0_MAX_CONCURRENT` to match.** At 16 workers, 1000 submissions clear
in roughly a minute; students see "grading…" and their result arrives while they
carry on with the next question.

---

## Configuration

Everything lives in `server/.env`. See `.env.example` for the full list.

| Variable                | Notes                                                          |
| ----------------------- | -------------------------------------------------------------- |
| `API_PORT`              | Checked before `PORT`, so a supervisor exporting `PORT` for the frontend can't hijack the API |
| `MONGODB_URI`           | Defaults to `mongodb://127.0.0.1:27017/college_coding_app`      |
| `JWT_SECRET`            | Must be ≥32 random chars in production                          |
| `GOOGLE_CLIENT_ID`      | From Google Cloud Console → Credentials                         |
| `ALLOWED_EMAIL_DOMAIN`  | Optional: restrict sign-in to the college's Workspace domain    |
| `ADMIN_EMAILS` / `TEACHER_EMAILS` | Comma-separated; role granted on first sign-in       |
| `ALLOW_DEV_LOGIN`       | Password-less dev login. Must be `false` in production          |
| `ANTHROPIC_API_KEY`     | Enables the post-test AI review. Without it the button is hidden |
| `JUDGE0_MAX_CONCURRENT` | Executions in flight at once. Match it to your Judge0 worker count (default 16) |
| `LOCAL_MAX_CONCURRENT`  | Same, for the dev fallback. Roughly one per core (default 4)     |
| `GRADING_MAX_QUEUE`     | Submissions allowed to wait for a slot before the API sheds load (default 5000) |
| `LISTEN_BACKLOG`        | TCP accept queue. Raised from Node's 511 so an opening rush isn't refused (default 2048) |

`assertProductionSafety()` in `config/env.js` refuses to start the server on an
unsafe production configuration rather than starting insecurely.

### Google OAuth setup

1. Google Cloud Console → **APIs & Services → Credentials → OAuth client ID → Web application**
2. Authorised JavaScript origins: `http://localhost:5173` (and your real origin)
3. Copy the client ID into `GOOGLE_CLIENT_ID`

The frontend renders the Google Identity Services button; the backend verifies the
ID token with `google-auth-library` and issues its own httpOnly session cookie.
The email always comes from Google's verified claim, never from the client.

---

## Anti-cheat

Detection is in the browser (`hooks/useAntiCheat.js`); **counting and enforcement
are on the server** (`services/violations.js`).

| Signal                    | Behaviour                                                   |
| ------------------------- | ----------------------------------------------------------- |
| Tab switch / blur         | Timed. Under `graceMs` (default 2.5s) → warned, not counted  |
| Fullscreen exit           | Same grace treatment                                        |
| **Screen overlay**        | Page hidden while the window still had focus — the signature of an OS overlay drawn on top of it. Same grace treatment |
| **Screenshot key**        | PrintScreen → counted                                       |
| **Screen-snip tool**      | Win+Shift+S / Cmd+Shift+3-4-5 → counted                     |
| **Fullscreen deadline**   | Leaving fullscreen starts a countdown (`fullscreenGraceSec`, default 15s). Not back in time → attempt ends, work submitted and graded |
| Large paste               | ≥120 chars or ≥5 lines → counted; smaller pastes logged only |
| View source (Ctrl+U)      | Counted                                                     |
| Copy / right-click / print / save | Blocked in the UI and logged, never penalised       |

### The fullscreen re-entry deadline

Leaving fullscreen drops a full-screen countdown over the paper — deliberately
covering the questions, so someone who alt-tabbed away cannot keep reading while
the clock runs. A single large button returns them (browsers only grant
fullscreen from a real click).

The countdown in the page is **display only**. The attempt stores when
fullscreen was lost, and both the violation and heartbeat endpoints evaluate the
deadline against that timestamp — so a student who deletes the overlay in
devtools is still terminated on the next heartbeat.

One deliberate fairness guard: the deadline is **not enforced against a student
whose browser never granted fullscreen** in the first place. Getting thrown out
of an exam you were never able to enter properly would be indefensible. Set
`fullscreenGraceSec: 0` on a test to switch the deadline off entirely.

### Pasted answers

Every paste is recorded against the question it happened in, and summarised onto
the submission (count, total characters, largest single paste) covering only the
pastes since that student's previous submission of that question — so one early
paste does not follow them through the rest of the exam.

The student is told plainly, both in the pre-exam rules and on the result panel,
that pasted code is recorded and shown to their teacher. Teachers get a
**pasted** badge in the submissions list and the detail in the submission
viewer, with the caveat stated there: pasting is not proof of misconduct on its
own — a student may be moving their own code between questions.

### What "screen overlay" can and cannot tell you

A web page **cannot positively identify Circle to Search**, Windows Click to Do,
or any other system overlay — they are drawn by the OS, outside the page's
reach. What the page *can* observe is the side effect: it becomes hidden while
its window still holds focus, which an ordinary tab change never does. That is
why the event is called `screen_overlay` and labelled "screen covered by a
system overlay (possible on-screen search)" rather than named after a product it
cannot actually see.

Two honest limits worth telling students and staff:

- A student using a **second device** (phone camera, another laptop) is
  invisible to any browser-based system. Only invigilation catches that.
- A determined student can disable JavaScript-level detection. The server still
  counts what it is told and enforces the allowlist, window, single session and
  time limit — but detection itself is deterrence, not proof. For true lockdown
  you need a kiosk/native client.

Fairness safeguards, all server-side:

- **Grace period** — a brief slip warns on screen without spending a warning.
- **Dedupe** — one Alt-Tab fires several DOM events; anything within 1.8s of a
  counted strike collapses into it.
- **Instant visibility** — the banner shows the moment an event is detected, then
  updates with the server's verdict.
- **Terminate ≠ zero** — exceeding the limit auto-submits and **grades** the
  student's current code, flags the attempt, and attaches the full log. The
  teacher decides with the manual score override.
- **Crashes are not cheating** — a stale heartbeat is treated as a dead tab, so a
  disconnected student resumes from their auto-saved code instead of being locked
  out or penalised.

Every event is stored with the server's decision and reason, so a teacher
reviewing an attempt can see exactly why a student was or wasn't penalised.

---

## Identity and reporting

A student must supply their **full name** (and optionally a roll number) before
they can start any test — the server refuses with `428` until they do, and the
exam screen shows the form. Both are snapshotted onto the attempt, so a later
profile edit cannot rewrite who a past result belongs to.

Every teacher-facing surface therefore names a person, not a mailbox. The
**Analytics → Per student** table and the Excel export both carry:

| | |
|---|---|
| Started / Completed | wall-clock timestamps |
| Time taken | how long they actually spent |
| Submissions | graded submissions (excludes Run) |
| **Errored submissions** | failed to compile, crashed, or the judge could not run — *not* wrong answers |
| Runs | sample-only executions, no penalty |
| Warnings | counted violations |

## Diagrams in questions

The question editor has **+ Add diagram** on the statement field — for linked
lists, trees, graphs, anything easier drawn than described. PNG / JPEG / GIF /
WebP up to 3 MB. Uploading inserts the markdown and the image appears in the
preview and to students.

Two deliberate restrictions:

- **SVG is rejected.** It is a document format that can carry script, and these
  files are served to every student in the exam.
- The file's **magic number is checked**, not just its declared type — a script
  renamed to `.png` does not get through.
- Only `/uploads/…` images render. An external `![](https://…)` in a statement
  is refused, because an exam page fetching third-party images would leak every
  student's IP and viewing time to whoever owns that host.

## Changing a test that is already running

The ordinary settings save refuses to change the schedule or the paper while
students are working. Two deliberate exceptions exist for when reality
intervenes:

**Add a question mid-test** (Settings → *Add a question now*, shown only while
the test is live). It appends to the test *and* to every in-progress attempt, so
students already working receive it and their total marks rise accordingly. On a
randomised paper it joins the pool for new starters only, and says so rather
than silently doing nothing.

**Let a student back in** (Live proctor → *Let back in*). For an attempt ended
by the warning limit — or by a genuine technical failure. You choose how many
extra minutes to grant and whether to clear their warnings. Their existing
submissions stand and the best score per question still wins. Editing a question
that a running test uses is allowed too, with a banner naming the test and how
many students are mid-attempt.

Every intervention is recorded on the attempt (who, when, why) next to the
violation log, so the two can be read together afterwards.

## Sharing a test

**Share** tab: a copyable link, ready-to-paste instructions, and a downloadable
QR code for the projector.

The link is a **shortcut, not a key**. Opening it still requires signing in with
an account on that test's allowlist, inside the scheduled window — so a leaked
link or a photographed QR grants nobody extra access (non-negotiable #6). The
tab says exactly that, because a teacher who believes otherwise will share it
carelessly.

## Layout

```
server/src/
  config/     env (+ production safety gate), db, languages
  models/     User, Question, Test, Attempt, Submission, Review
  middleware/ auth (session + RBAC), error (zod/mongoose → clean messages)
  routes/     auth, questions, tests, exam, reviews, admin
  services/
    executor.js         the single door to code execution
    judge0.js           async batch submit + poll
    localExecutor.js    DEV-ONLY host fallback
    grader.js           deterministic scoring, verdicts, partial marks
    accessGate.js       allowlist + window + single-session
    violations.js       grace, dedupe, warning limit
    attemptFinalizer.js terminate/expire → auto-submit → grade → roll up
    allowlist.js        CSV / Excel / paste email extraction
    aiReview.js         post-test explanation (never grading)
    realtime.js         Socket.IO proctor feed

client/src/
  pages/exam/       the locked-down solve screen
  pages/student/    assigned tests, results + AI review
  pages/teacher/    tests, question editor, and the test tabs
                    (settings / students / live proctor / submissions / analytics)
  pages/admin/      user + role management
  hooks/            useAntiCheat, useCountdown
```

Monaco is **bundled** rather than loaded from a CDN — an exam must not fail
because the college network blocks jsdelivr. Only the four supported languages'
tokenizers are included (`lib/monaco.js`).

---

## Not built yet

- **JPlag plagiarism check** — §11 lists it last and it is not implemented.
- **Automated database backups** — use your MongoDB deployment's own backups.
- **Reusable student groups/sections** — allowlists are currently per test.

---

## Production checklist

- [ ] `NODE_ENV=production`, `EXECUTOR=judge0`, `ALLOW_DEV_LOGIN=false`
- [ ] `JWT_SECRET` ≥32 random characters
- [ ] Serve over HTTPS (session cookies become `secure` automatically)
- [ ] `GOOGLE_CLIENT_ID` set, and `ALLOWED_EMAIL_DOMAIN` if you want to restrict sign-in
- [ ] Judge0 reachable from the server and **not** reachable from the internet
- [ ] MongoDB backups configured
- [ ] `npm run build` and serve `client/dist` behind your web server
- [ ] `JUDGE0_MAX_CONCURRENT` matched to your Judge0 worker count — this, not the
      API, is what decides how fast a large cohort's submissions clear
- [ ] Put nginx (or your load balancer) in front, so the opening rush is absorbed
      there rather than by Node's accept queue
- [ ] Run `npm run loadtest -- <your cohort size> --ramp 20` against staging
      before the first real exam
