# KPR Coding Platform — design brief for Stitch

Paste **Part 1** into Stitch first as the project context. Then paste **one
screen prompt at a time** from Part 2 — Stitch produces much better results from
a single focused screen than from a whole app at once.

Everything here describes an application that **already exists and works**. Do
not invent features: if a screen is not listed, it does not exist, and if a
control is not described, it has no behaviour behind it. The goal is to redesign
the surface, not to redesign the product.

---

## Part 1 — Project context (paste this first)

> **Product**
>
> KPR Coding Platform — a secure online coding-examination system for KPR
> Institute of Engineering and Technology. Students sit timed, proctored
> programming exams in a locked-down fullscreen browser window. Teachers author
> questions, run the exam live, and mark it afterwards. It replaces HackerRank
> for internal assessments.
>
> **Who uses it**
>
> - **Students** — 18-22, on college lab desktops and their own laptops, often
>   nervous and under time pressure. Many have used LeetCode. Screen sizes vary
>   from 1366×768 lab monitors upward.
> - **Teachers** — set the paper, watch the room live, mark and export results.
>   Not necessarily technical beyond their subject.
> - **Admins** — manage accounts and roles.
>
> **Brand**
>
> KPR Institute. Two brand colours taken from the college logo:
>
> - Deep institutional blue `#1F4E9C` — primary
> - Green `#00A65A` — secondary and success
>
> The logo is an abstract green-and-blue mark above the words "KPR INSTITUTE /
> of / ENGINEERING AND TECHNOLOGY / LEARN BEYOND".
>
> **Tone and visual direction**
>
> Calm, serious, institutional — this is an exam, not a game. No playful
> illustrations, no confetti, no marketing gradients. Generous whitespace, clear
> hierarchy, high contrast. A student under time pressure must be able to find
> the timer, the question, and the Submit button instantly.
>
> Dense where it needs to be dense: the teacher's tables and the student's code
> editor carry a lot of information and should not be padded into needing
> scrolling.
>
> **Required**
>
> - **Light and dark themes**, both first-class. Students sit exams at all hours.
> - Body text in a clean system sans-serif. **All code, test-case input/output,
>   and function signatures in a monospace font** — never sans.
> - Status colours must stay distinguishable for colour-blind users: pair every
>   colour with an icon or a word, never colour alone.
> - Desktop-first. The exam screen is desktop-only; teacher screens should
>   degrade sensibly to tablet. No mobile exam-taking.
>
> **Vocabulary used throughout**
>
> - **Test** — one exam paper, with a scheduled window and a duration.
> - **Question** — coding or multiple-choice. Coding questions come in three
>   shapes: *function signature* (LeetCode style, the default), *class/design*
>   (LRU Cache style), and *standard input/output*.
> - **Test case** — one input and its expected output. *Sample* cases are shown
>   to students; *hidden* cases are not.
> - **Run** — executes the visible sample cases only, unscored.
> - **Submit** — executes every case including hidden ones, and is scored.
> - **Attempt** — one student's sitting of one test.
> - **Verdict** — Accepted, Wrong Answer, Time Limit Exceeded, Runtime Error,
>   Compile Error.
> - **Violation** — a recorded anti-cheat event (tab switch, leaving fullscreen,
>   window losing focus, paste).

---

## Part 2 — Screens

Fourteen screens. Prompts are written to be pasted individually.

### 1. Sign-in

> A centred sign-in card on an otherwise empty page. The KPR logo above the
> product name "KPR Coding Platform" and a one-line subtitle "Sign in with your
> college Google account to continue."
>
> The card contains a Google sign-in button. Below it, a clearly separated and
> visually de-emphasised development-only section labelled "DEV ONLY —
> password-less sign-in" containing an email field, a role dropdown (Student /
> Teacher / Admin) and a Continue button. This section must look obviously
> secondary and temporary, not like a normal way in.
>
> A closing line of fine print: "Access to each test is granted by your
> teacher's allowlist and its scheduled window."

### 2. Student — My tests

> A list of exam papers assigned to the signed-in student. Page title "My tests"
> with the subtitle "Tests your teachers have assigned to your college account."
>
> Each test is a card showing: status pill (Open now / Opens in 2 days / Closed /
> Practice), title, one-line description, and a row of small labelled stats —
> Questions, Duration, Closes (date and time). A primary "Start test" button on
> the right of the card.
>
> A card for a test already in progress shows "Resume test" instead, plus the
> time remaining. A card for a finished test shows the score and a "View result"
> link.
>
> Show the empty state: no tests assigned yet.

### 3. Student — Results

> A list of the student's completed attempts. For each: test title, date
> submitted, score as "34 / 50" with a proportional bar, and a per-question
> breakdown expandable inline — question title, verdict pill, score, language
> used.
>
> Nothing here is editable. Hidden test cases must never be revealed: a hidden
> case shows only its verdict, never its input or expected output.

### 4. Exam — pre-flight gate

> A full-page interstitial shown after a student presses "Start test", before
> the exam opens. Not dismissible except by starting or going back.
>
> Header: test title, a "Practice" pill if applicable, and three stats —
> questions, duration, closes at. A large countdown showing time remaining.
>
> The body is a rules list titled "Before you begin". Each rule is a separate
> line with an icon. The rules are:
>
> - The test runs in fullscreen. Leaving fullscreen, switching tabs, or clicking
>   away from this window is recorded.
> - If you leave fullscreen you get 15 seconds to return. A countdown covers the
>   questions until you do. Miss it and your attempt ends — your work is
>   submitted and graded, not discarded.
> - Pasted code is recorded and shown to your teacher next to the answer you
>   submit.
> - You get 3 warnings. Exceeding them ends your attempt — your work is
>   submitted and graded automatically, and your teacher reviews it.
> - A very brief slip (under 3 seconds) warns you without costing a warning.
> - Copy, paste and right-click are disabled. Large pastes into the editor are
>   logged.
> - Your code auto-saves every few seconds. If your browser crashes or your
>   connection drops, sign back in and continue — that is not treated as
>   cheating.
> - Run tests only the visible samples and costs nothing. Submit grades every
>   case, including hidden ones. You may submit as often as you like; your best
>   submission counts.
>
> Two buttons: a secondary "Not now" and a primary "Begin test in fullscreen".
>
> The tone must be firm but reassuring — it should reduce anxiety, not raise it.
> The rules about work being *submitted and graded* rather than discarded are
> the reassuring part and should not be buried.

### 5. Exam — the solve screen (the most important screen)

> A fullscreen, three-region coding workspace with no site navigation. Modelled
> on LeetCode's solve page but calmer and less dense.
>
> **Top bar**, always visible: test title on the left; a numbered question
> navigator in the centre (buttons 1–6, each showing at a glance whether it is
> unattempted, attempted, or answered correctly); on the right a large
> monospace countdown timer, a warnings indicator ("1 of 3 warnings used"), and
> a "Finish test" button. The timer must be the most prominent element in the
> bar, and should change colour as time runs short.
>
> **Left pane** — the problem. Title, difficulty pill, marks. The statement in
> readable prose, supporting headings, bold, code spans, and images (teachers
> attach diagrams for linked-list questions). Then Constraints. Then "Sample
> cases": each sample in its own bordered block showing Input and Expected
> output side by side in monospace, with an optional explanation line beneath.
> Finally a line: "Submitting also runs 4 hidden test cases you cannot see."
>
> **Right pane, upper** — the code editor. A toolbar above it with: a language
> dropdown (python, javascript, java, cpp, c), a "Reset to template" button, an
> "Own input" checkbox, and Run and Submit buttons on the right. Submit is the
> primary action. The editor itself is a syntax-highlighted code area with line
> numbers.
>
> **Optional strip** between editor and results, shown only when "Own input" is
> ticked: a small labelled textarea for the student's own test input, with a
> hint line and a "Reset to sample" link.
>
> **Right pane, lower** — the results console. Before running: an empty state
> explaining that Run checks the samples with no penalty and Submit grades every
> case. After running: a sticky summary bar with the verdict pill, "3 of 5
> passed", score, and runtime; then one block per test case showing Passed or
> Failed, the case name, and — for a failed sample — its Input, the student's
> output, and the Expected output side by side. A hidden case shows its verdict
> and nothing else.
>
> The two panes are separated by a draggable vertical splitter.
>
> Design light and dark versions. Dark is what most students will use.

### 6. Exam — fullscreen re-entry countdown

> A full-screen overlay that appears the instant a student leaves fullscreen
> during an exam, covering the questions completely so nothing can be read while
> outside.
>
> A large circular countdown from 15 seconds, a heading "Return to fullscreen",
> a line explaining that the attempt will end and be submitted for grading if
> the countdown reaches zero, and one large primary button "Re-enter fullscreen".
>
> Urgent but not cruel. This student may have knocked a key by accident.

### 7. Exam — multiple-choice question

> The same shell as the solve screen, but the right pane is a multiple-choice
> panel instead of a code editor.
>
> The question statement, then the options as large clickable rows with radio
> buttons (or checkboxes when multiple answers are allowed). A clear note when
> multiple selection is active: "Select all that apply — 2 of the 4 options are
> correct." A subtle "Saved" indicator, since MCQ answers save automatically and
> are never "submitted" individually.
>
> No verdict is ever shown here — MCQ answers are graded only when the whole
> test is finished.

### 8. Exam — finished

> A calm full-page confirmation after a student finishes or is terminated.
>
> Three variants to design:
>
> - **Submitted** — "Your test has been submitted", the score if released, and
>   a link back to results.
> - **Time expired** — explains the work was submitted and graded automatically.
> - **Terminated for rule violations** — explains plainly that the attempt was
>   ended, that their work *was* submitted and graded rather than voided, and
>   that their teacher will review it. This must not feel like a punishment
>   screen; it must feel like a factual notice.

### 9. Teacher — Tests

> A table of every test the teacher has created. Columns: title, status pill
> (Draft / Published / Paused / Closed), window (start and end date-time),
> duration, question count, students on the allowlist, and how many have
> attempted. Row click opens the test.
>
> A prominent "New test" button. Filters by status. Empty state for a teacher
> with no tests yet.

### 10. Teacher — Test detail, six tabs

> A test workspace with a header (title, status pill, publish/pause controls)
> and six tabs. Design the tab shell once, then each tab:
>
> **Settings** — a form: title, description, start and end date-time, duration
> in minutes, which languages are allowed (multi-select chips: python,
> javascript, java, cpp, c), warning limit, grace period, and the question list
> with drag-to-reorder, per-question marks, and Add/Remove. A warning banner
> when editing a test that is currently live.
>
> **Allowlist** — the students permitted to sit this test. A bulk paste box
> accepting emails one per line, plus a table of current entries with a remove
> action. Show the count.
>
> **Share** — the generated link to the test, a copy button, and a large QR code
> students can scan. Include an explicit caution: "This link is not a password —
> anyone with it still has to sign in and be on the allowlist."
>
> **Proctor** — the live invigilation view, refreshing in real time. One card per
> student currently sitting the exam: name, roll number, email, time remaining,
> current question, warnings used, and a live status (Active / Away from window /
> Left fullscreen / Disconnected). Colour-code the state. Include actions to
> terminate an attempt and to reinstate a student who was terminated. A summary
> strip at the top: how many sitting, how many finished, how many flagged.
>
> **Submissions** — a table of every submission: student name, question,
> language, verdict pill, score, time, and a paste-flag icon where pasted code
> was detected. Filterable by verdict and by question. Row opens the submission.
> An "Export to Excel" button.
>
> **Analytics** — charts and summary statistics for the paper: score
> distribution histogram, per-question pass rate, average time per question,
> language popularity, and counts of error-producing submissions. Also start and
> completion times per student.

### 11. Teacher — Question editor (the second most complex screen)

> A long two-column authoring form for one question, with a live preview.
>
> Top: a kind toggle — **Coding** or **Multiple choice**.
>
> For a coding question, an "answer format" chooser with three large radio
> cards:
>
> - **Implement a function (LeetCode style) — default.** You define a signature;
>   every language gets a ready-made stub.
> - **Implement a class (design problem).** For LRU Cache, Min Stack.
> - **Standard input and output.** The escape hatch.
>
> Then, depending on the choice, a signature builder: function name, return type
> dropdown, and a list of parameters each with a name and type dropdown. The
> class variant instead has a class name, constructor parameters, and a list of
> methods each with their own name, return type and parameters.
>
> Then: title, statement (rich text with image upload for diagrams),
> constraints, difficulty, marks, time limit, memory limit, tags.
>
> Then an **answer-checking** panel: two checkboxes ("The order of the answer
> does not matter", "…nor the order inside each element") and a numeric
> tolerance field, each with a one-line explanation of when to use it.
>
> Then the **test cases** — a repeating block per case with Input and Expected
> output textareas in monospace, a points field, a "sample / hidden" toggle, and
> an optional explanation. Show a warning when a case has the wrong number of
> input lines for the signature.
>
> Right column, sticky: **Generated starter code** — the signature rendered as a
> line of monospace, language tabs (python / javascript / java / cpp / c), and
> the generated stub for the selected language in a read-only code block. Below
> it, a live **preview of exactly what the student will see**.
>
> This screen is long. Use clear section cards, sticky section navigation, and
> keep the preview visible while scrolling.

### 12. Teacher — Question library

> A searchable, filterable table of all questions this teacher has written.
> Columns: title, difficulty pill, marks, tags, number of test cases, how many
> tests currently use it, last updated. Search box, tag filter, difficulty
> filter. "New question" button. Row click opens the editor.

### 13. Teacher — Submission viewer

> One student's answer to one question, for marking.
>
> Header: student name, roll number, question title, language, verdict pill,
> score, and submitted time. A prominent warning banner when the submission
> contains pasted code, stating how many pastes and how many characters.
>
> Body, two columns: the student's code in a read-only syntax-highlighted block
> on the left; on the right the per-case results — every case including hidden
> ones, since teachers see everything — each with input, expected output, actual
> output, verdict, time and memory.
>
> A manual override panel: a score field, a note field, and a Save button, so a
> teacher can award marks the automatic grader did not.

### 14. Admin — Users

> A table of every account: name, email, role pill (Student / Teacher / Admin),
> roll number, when they joined, when they last signed in. A role dropdown per
> row to promote or demote. Search by name or email, filter by role.

---

## Part 3 — Components to design once and reuse

> - **Verdict pill** — Accepted (green), Wrong Answer (red), Time Limit Exceeded
>   (amber), Runtime Error (red), Compile Error (red), Judge Error (grey),
>   Pending (grey), Ran (green). Each pairs a colour with its word.
> - **Status pill** — Draft, Published, Paused, Closed, Open now, Practice.
> - **Stat tile** — a small label above a large value, used in rows of three or
>   four across the teacher screens.
> - **Empty state** — an icon, a sentence explaining what would appear here, and
>   the primary action that creates the first one.
> - **Code block** — monospace, line numbers optional, with a copy button on
>   read-only variants.
> - **Test-case block** — Input and Expected side by side in monospace, with an
>   optional explanation beneath.
> - **Toast** — success, error, warning, info. Appears top-right, auto-dismisses.
> - **Data table** — the shared shell for the teacher and admin tables: sticky
>   header, zebra-free rows, row hover, and a filter bar above it.

---

## Part 4 — What to send back

Once Stitch has produced the screens, send me any one of:

1. The **Stitch project link**, or
2. **Screenshots** of each screen (name them by screen number above), or
3. The exported **HTML/CSS**, or a `DESIGN.md` if Stitch generates one.

From any of those I can extract the design system — colours, spacing scale,
typography, component specs — and apply it to the real app. Screenshots alone
are enough to work from; the exported code is better because it pins down exact
values rather than making me estimate them.

**Most useful of all:** flag which screens you actually want changed. The app
works today, and redesigning all fourteen at once is a large change to review.
Starting with the exam solve screen and the student test list would give the
biggest visible improvement for the least risk.
