# Getting it in front of people

Two ways, in the order most people want them. Do the first to show teachers it
works; do the second when a class needs to actually sit a paper.

Everything here assumes the repository is cloned and you are in its folder.

---

## Step 0 — the one thing both paths need

A Google OAuth client id. Without it nobody can sign in.

1. <https://console.cloud.google.com/apis/credentials>
2. Create a project if you have none (any name).
3. **Create credentials -> OAuth client ID -> Web application**
4. If it asks you to configure a consent screen first: choose **External**, fill
   in an app name and your own email, and save. You do not need to publish it —
   while it is in Testing, add each person's Google address under **Test users**.
5. Leave **Authorised JavaScript origins** empty for now; you add the address in
   step 1 or 2 once you know it.
6. Copy the **Client ID** (ends `.apps.googleusercontent.com`) into
   `server/.env` as `GOOGLE_CLIENT_ID=`.

The consent screen in Testing mode allows 100 test users, which is plenty for a
demo and a class.

---

## Path A — from your laptop, free, about 20 minutes

For showing teachers. Real Google sign-in, real grading, public https link.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\demo.ps1
```

It starts Judge0, builds, opens a tunnel, and prints a link like
`https://something.trycloudflare.com`.

**Then, before anyone signs in:** paste that link into your OAuth client's
**Authorised JavaScript origins** and save. Google takes a minute to apply it.

Share the link. Ctrl+C ends it.

**Know this:**

- The link changes every run, so you re-add it to Google each time.
- It lives only while your laptop is awake and running the script. Turn off
  sleep: Settings -> Power -> Screen and sleep -> Never, while plugged in.
- Fine for a demo. Not for a graded exam — you do not want a paper depending on
  a laptop lid.

---

## Path B — a real server

For a class. **About an hour to set up, once. Roughly Rs 380 per month to run.**

Billing is hourly against that monthly cap, so a server you create for a
three-day trial and then delete costs about Rs 40, not Rs 380. You can put it up
for a demo, delete it, and create it again when the college is ready.

### 1. The machine

**Hetzner CX22** (2 vCPU, 4 GB, ~EUR 3.79) at <https://hetzner.com/cloud>.
Choose **Ubuntu 22.04** — not 24.04, see the note at the end.

4 GB is the floor: Judge0 alone wants about 1.5 GB alongside MongoDB and the
app. That comfortably runs 60 students, and 500 with room to spare.

### 2. A domain, free

<https://duckdns.org> -> sign in -> create `kpr-exams` -> set it to your
server's IP. You get `kpr-exams.duckdns.org`, and Let's Encrypt will issue a
certificate for it.

### 3. cgroup v1, then reboot

Judge0's sandbox puts each submission in a control group under
`/sys/fs/cgroup/memory/box-N`, which only exists under cgroup v1. Without this
every submission returns "Internal Error" while the server looks perfectly
healthy.

```bash
ssh root@YOUR_SERVER_IP

sed -i 's/GRUB_CMDLINE_LINUX="\(.*\)"/GRUB_CMDLINE_LINUX="\1 systemd.unified_cgroup_hierarchy=0"/' /etc/default/grub
update-grub
reboot
```

Wait a minute, reconnect, and confirm — do not assume:

```bash
ls /sys/fs/cgroup/memory     # must exist
```

### 4. Install

```bash
git clone https://github.com/dhanushkumar066/KPR-Coding-Platform.git /opt/kpr-exams
cd /opt/kpr-exams
bash scripts/setup-server.sh
```

It asks four things:

| Prompt | Answer |
|---|---|
| Domain | `kpr-exams.duckdns.org` |
| Google client id | paste it |
| Restrict email domain | press Enter, unless every user has a college address |
| First head of department | your Google address |

Ten to fifteen minutes, mostly pulling Judge0's images.

### 5. HTTPS

```bash
certbot --nginx -d kpr-exams.duckdns.org
```

Not optional. The session cookie is Secure, so over plain http nobody can stay
signed in — it looks like a mysterious login bug and is not one.

### 6. Tell Google

Add `https://kpr-exams.duckdns.org` to your OAuth client's **Authorised
JavaScript origins**.

### 7. Check before trusting it

```bash
npm run preflight
```

Every line must be `ok`. It runs real code through the sandbox rather than
merely pinging it, because a judge that answers but cannot execute marks a whole
paper zero while looking healthy.

---

## First run, in the app

1. Open your site, sign in with Google.
2. It asks once **which department you head**. Type it.
3. **Staff** -> add your teachers by email. They can be added before they have
   ever signed in; their first login lands them straight on the teaching screens.
4. **Question library -> GATE -> Build a paper**, or **New question** for a
   normal test.
5. Create a test, add the students' emails under **Students**, publish.
6. **Share** gives you a link and a QR code for the hall.

---

## Before the first graded paper

Run a rehearsal. Two questions, twenty to thirty real students, on the hall's
own machines and network, with you watching the **Live proctor** tab.

A rehearsal finds what no checklist does: the hall's firewall, the browser
version on the lab machines, a projector that makes every student's second
screen fire at once.

Then set up backups. Git holds the code and none of the students' work:

```bash
# /etc/cron.daily/kpr-backup
mongodump --db college_coding_app --out /backup/$(date +\%F)
tar czf /backup/uploads-$(date +\%F).tgz /opt/kpr-exams/server/uploads
```

Restore one onto a spare machine once, before you rely on it.

---

## Things that will waste your afternoon if you skip them

**Ubuntu 22.04, not 24.04.** Judge0 needs cgroup v1 and 22.04 still gives it to
you without a fight.

**Docker 26, not newer.** Docker 28 removed cgroup v1 support and its daemon
panics on a v1 host. The setup script pins this for you.

**Judge0 must stay on 127.0.0.1.** Its shipped compose publishes on 0.0.0.0,
which puts a service that runs arbitrary code on the network with no login in
front of it. The script fixes this; `preflight` checks it.

**Check the clock.** Every deadline is computed from the server's time. A server
running slow gives some students extra time and cuts others short, and nothing
in the app can detect it.

---

`DEPLOYMENT.md` has the reasoning behind each step, and a section on what to do
when something goes wrong mid-exam.
