# Deploying the KPR Coding Platform

For whoever puts this on the college's server. Work top to bottom; the order
matters. At the end, `npm run preflight` tells you whether it is fit to run an
exam, and it is the only answer worth trusting.

---

## What you are building

Three pieces on one machine:

| | | |
|---|---|---|
| **The app** | Node, port 4000 | one worker per core |
| **MongoDB** | port 27017 | students, papers, results |
| **Judge0** | port 2358, **localhost only** | the sandbox student code runs in |

Nginx (or equivalent) in front, terminating TLS.

**Judge0 must never be reachable from a browser.** It executes arbitrary code by
design; exposing it hands anyone on the network a free code-execution service.
Bind it to `127.0.0.1` and let only the app talk to it.

---

## 1. The machine

- **Ubuntu 22.04 LTS.** Not 24.04. See §3 — Judge0's sandbox needs cgroup v1,
  and 22.04 still gives it to you without a fight.
- 8 cores and 16 GB RAM comfortably handles 2000 concurrent students. 4 cores
  and 8 GB will do 500.
- Disk: 40 GB is plenty. Question images are the only thing that grows.
- **NTP running.** Every exam deadline is computed from this clock. A server
  running slow gives some students extra time and cuts others short, and
  nothing in the application can detect it.

```bash
sudo apt update && sudo apt install -y nginx mongodb-org nodejs npm
sudo timedatectl set-ntp true
```

---

## 2. The app

```bash
git clone <your repo> /opt/kpr-exams
cd /opt/kpr-exams
npm ci
npm run build

cp server/.env.production.example server/.env
# Fill it in — every REQUIRED field. Then:
openssl rand -base64 48        # paste into JWT_SECRET
```

Run it under systemd so it restarts on boot and on crash:

```ini
# /etc/systemd/system/kpr-exams.service
[Unit]
Description=KPR Coding Platform
After=network.target mongod.service

[Service]
Type=simple
WorkingDirectory=/opt/kpr-exams
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
User=kpr

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now kpr-exams
```

---

## 3. Judge0

Judge0's sandbox (`isolate`) puts every submission in its own control group
under `/sys/fs/cgroup/memory/box-N`. **That path exists only under cgroup v1.**
On a v2 system every submission comes back `Internal Error` — the API answers
normally, the server looks healthy, and a whole paper marks as zero.

On Ubuntu 22.04:

```bash
sudo sed -i 's/GRUB_CMDLINE_LINUX="\(.*\)"/GRUB_CMDLINE_LINUX="\1 systemd.unified_cgroup_hierarchy=0"/' /etc/default/grub
sudo update-grub
sudo reboot
```

After the reboot, confirm — do not assume:

```bash
ls /sys/fs/cgroup/memory   # must exist
```

Then install Judge0:

```bash
cd /opt
wget https://github.com/judge0/judge0/releases/download/v1.13.1/judge0-v1.13.1.zip
unzip judge0-v1.13.1.zip && cd judge0-v1.13.1

# Set REDIS_PASSWORD and POSTGRES_PASSWORD in judge0.conf — it will not start
# with them blank. Set AUTH_TOKEN too and copy it into the app's JUDGE0_TOKEN.

docker compose up -d db redis
sleep 15
docker compose up -d
```

**Docker must be 26.x or older.** Docker 28+ removed cgroup v1 support and its
daemon panics on a v1 host. If your Docker is newer:

```bash
sudo apt install docker-ce=5:26.1.1-1~ubuntu.22.04~jammy docker-ce-cli=5:26.1.1-1~ubuntu.22.04~jammy
```

Verify the sandbox **executes**, not merely that it answers:

```bash
curl -s -X POST 'http://localhost:2358/submissions?base64_encoded=false&wait=true' \
  -H 'Content-Type: application/json' \
  -d '{"language_id":71,"source_code":"print(2+3)"}'
```

You want `"stdout":"5\n"` and `"description":"Accepted"`. Anything else means
the sandbox is broken, however healthy the rest looks.

---

## 4. TLS

The session cookie is `Secure`. Over plain http nobody can stay signed in —
they will appear logged out immediately after logging in, which looks like a
mysterious auth bug and is not one.

```bash
sudo certbot --nginx -d exams.kpriet.ac.in
```

Nginx must proxy websockets too, or the live proctor feed silently never
connects:

```nginx
location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

---

## 5. Google sign-in

At <https://console.cloud.google.com/apis/credentials>, create an OAuth client
id and add `https://exams.kpriet.ac.in` to **Authorised JavaScript origins**.
Put the client id in `GOOGLE_CLIENT_ID`.

Set `ALLOWED_EMAIL_DOMAIN` to the college domain so personal accounts cannot
even reach the sign-in step.

---

## 6. First administrator

Put one college address in `ADMIN_EMAILS` and restart. When that person signs
in they are asked once which department they head, and from then on everything
happens in the app: they appoint their own teachers by email, and a second head
so the department is not locked out if they lose their account.

`ADMIN_EMAILS` is only ever touched again to create a **new department's** first
head.

If you are migrating from a pre-department install:

```bash
npm run migrate:departments -- CSE
```

---

## 7. Backups

Git covers the code. It does not cover students, papers or results.

```bash
# /etc/cron.daily/kpr-backup
mongodump --db college_coding_app --out /backup/$(date +\%F)
tar czf /backup/uploads-$(date +\%F).tgz /opt/kpr-exams/server/uploads
```

Question images live in `server/uploads/` and are deliberately not in git.
**Restore a backup onto a spare machine once**, before you rely on it. An
untested backup is a hope, not a backup.

---

## 8. Before every exam

```bash
npm run preflight
```

It checks configuration, that Judge0 **executes real code**, that an
administrator exists, that uploads are writable, and that the worker count
matches the hardware. `FAIL` means the exam will not work.

Then, the week before the first real paper:

1. Set a two-question practice test — one coding, one MCQ.
2. Have **20–30 students actually sit it**, on the hall's own machines and
   network.
3. Watch the live proctor tab while they do.
4. Export the results to Excel and read them.

A rehearsal finds things no checklist does: the hall's firewall, the browser
version on the lab machines, a projector cable that makes `screen.isExtended`
fire on every student at once.

---

## When something goes wrong mid-exam

**Everyone's submissions are stuck "pending".** Judge0 has stopped.
`docker compose ps` in the Judge0 directory. Nothing is lost — submissions are
persisted before grading and drain when it returns.

**A student is locked out after a crash.** They sign back in and resume: same
code, same remaining time, same warning count. A crash is never treated as
cheating. If they were terminated by mistake, a teacher reinstates them from
the proctor tab.

**A student says the timer is wrong.** Deadlines are computed server-side from
`startedAt`; the browser clock is display only. Check NTP on the server.

**The judge is overloaded.** Queue depth is at `/api/health`, as
`pendingSubmissions` — that figure is the whole system. The per-worker numbers
below it are one worker's view and will look far smaller.

---

## The rules this system will not bend

Worth knowing before someone asks you to change one:

1. Student code only ever runs sandboxed. Production will not start otherwise.
2. Judge0 is never exposed to the browser.
3. Grading is deterministic and key-based. No language model is anywhere near a
   score.
4. A submission is persisted before it is graded, so a crash cannot lose work.
5. Every rule is enforced server-side. The browser is not trusted.
6. The share link is not the security boundary — the allowlist is. A leaked
   link gets a stranger a login page and nothing else.
