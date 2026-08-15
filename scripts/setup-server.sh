#!/usr/bin/env bash
#
# Sets up the exam server. Ubuntu 22.04, run as root from the repo root:
#
#   sudo bash scripts/setup-server.sh
#
# It asks for the two things only you know — the domain and the Google OAuth
# client id — and does everything else itself, including the steps that are easy
# to skip and expensive to get wrong:
#
#   * generates a real JWT secret, so the placeholder can never reach production
#   * binds Judge0 to 127.0.0.1, because its shipped compose publishes on
#     0.0.0.0 and that puts a code-execution service on the college network
#   * turns dev login off
#   * installs the systemd unit and an nginx site that proxies websockets, which
#     the live proctor feed silently needs
#
# Safe to run twice. It never overwrites an existing .env, and every step says
# what it is doing.
set -euo pipefail

RED=$'\e[31m'; GRN=$'\e[32m'; YEL=$'\e[33m'; DIM=$'\e[2m'; RST=$'\e[0m'
say()  { echo "${GRN}==>${RST} $*"; }
warn() { echo "${YEL}  ! ${RST}$*"; }
die()  { echo "${RED}  x ${RST}$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run with sudo."
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO"
[[ -f package.json ]] || die "Run this from the repository root."

# ---------------------------------------------------------------------------
say "Checking the machine"
# ---------------------------------------------------------------------------
. /etc/os-release 2>/dev/null || true
echo "${DIM}    ${PRETTY_NAME:-unknown OS}${RST}"
if [[ "${VERSION_ID:-}" != "22.04" ]]; then
  warn "Judge0's sandbox needs cgroup v1, which 22.04 still gives you easily."
  warn "On ${VERSION_ID:-this release} you may have to fight it. Continuing anyway."
fi

if [[ -d /sys/fs/cgroup/memory ]]; then
  echo "${DIM}    cgroup v1 memory controller present${RST}"
else
  warn "No /sys/fs/cgroup/memory — Judge0's sandbox will fail on every submission."
  warn "Add systemd.unified_cgroup_hierarchy=0 to GRUB_CMDLINE_LINUX, update-grub, reboot."
  warn "See DEPLOYMENT.md §3. Continuing so the rest can be set up."
fi

timedatectl set-ntp true 2>/dev/null || warn "Could not enable NTP. Every exam deadline depends on this clock."

# ---------------------------------------------------------------------------
say "What only you know"
# ---------------------------------------------------------------------------
read -rp "    Domain students will use (e.g. exams.kpriet.ac.in): " DOMAIN
[[ -n "$DOMAIN" ]] || die "A domain is required — it is the origin the session cookie is scoped to."
DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN%%/*}"

read -rp "    Google OAuth client id (…apps.googleusercontent.com): " GOOGLE_ID
[[ -n "$GOOGLE_ID" ]] || warn "Left blank — nobody can sign in until GOOGLE_CLIENT_ID is set in server/.env."

read -rp "    College email domain to restrict sign-in to (blank for none): " MAIL_DOMAIN
read -rp "    Email of the first head of department: " ADMIN_EMAIL
[[ -n "$ADMIN_EMAIL" ]] || warn "Left blank — no administrator can exist until ADMIN_EMAILS is set."

# ---------------------------------------------------------------------------
say "Writing server/.env"
# ---------------------------------------------------------------------------
if [[ -f server/.env ]]; then
  warn "server/.env already exists — leaving it alone."
  warn "Delete it and re-run if you want a fresh one."
else
  # Generated here, on the machine that will use it: a secret that has been
  # through a chat window, a repository or a wiki is not a secret.
  JWT="$(openssl rand -base64 48 | tr -d '\n')"
  cp server/.env.production.example server/.env

  set_kv() {
    local key="$1" val="$2"
    if grep -qE "^${key}=" server/.env; then
      # | as the delimiter: values contain / and +
      sed -i "s|^${key}=.*|${key}=${val}|" server/.env
    else
      echo "${key}=${val}" >> server/.env
    fi
  }

  set_kv NODE_ENV production
  set_kv CLIENT_ORIGIN "https://${DOMAIN}"
  set_kv JWT_SECRET "$JWT"
  set_kv GOOGLE_CLIENT_ID "$GOOGLE_ID"
  set_kv ALLOWED_EMAIL_DOMAIN "$MAIL_DOMAIN"
  set_kv ADMIN_EMAILS "$ADMIN_EMAIL"
  set_kv ALLOW_DEV_LOGIN false
  set_kv EXECUTOR judge0
  set_kv JUDGE0_URL "http://127.0.0.1:2358"

  chmod 600 server/.env
  echo "${DIM}    secret generated, dev login off, executor judge0${RST}"
fi

# ---------------------------------------------------------------------------
say "Building"
# ---------------------------------------------------------------------------
npm ci --silent
npm run build --silent
echo "${DIM}    client built${RST}"

# ---------------------------------------------------------------------------
say "Judge0"
# ---------------------------------------------------------------------------
J0="$(find /opt -maxdepth 2 -name 'judge0-v*' -type d 2>/dev/null | head -1)"
if [[ -z "$J0" ]]; then
  warn "Judge0 not found under /opt. Install it per DEPLOYMENT.md §3, then re-run."
else
  # The shipped compose publishes 2358 on every interface. That is a service
  # whose whole purpose is running arbitrary code, reachable by anyone on the
  # network, with no login in front of it.
  if grep -qE '^\s*-\s*"?2358:2358"?' "$J0/docker-compose.yml"; then
    sed -i -E 's|^(\s*)-\s*"?2358:2358"?|\1- "127.0.0.1:2358:2358"|' "$J0/docker-compose.yml"
    say "  bound Judge0 to 127.0.0.1 (was listening on every interface)"
    (cd "$J0" && docker compose up -d >/dev/null 2>&1) || warn "Could not restart Judge0 — do it by hand."
  else
    echo "${DIM}    already bound to localhost${RST}"
  fi
fi

# ---------------------------------------------------------------------------
say "systemd"
# ---------------------------------------------------------------------------
RUN_USER="${SUDO_USER:-root}"
cat > /etc/systemd/system/kpr-exams.service <<UNIT
[Unit]
Description=KPR Coding Platform
After=network.target mongod.service

[Service]
Type=simple
WorkingDirectory=${REPO}
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
User=${RUN_USER}
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable kpr-exams >/dev/null 2>&1
echo "${DIM}    kpr-exams.service installed (runs as ${RUN_USER})${RST}"

# ---------------------------------------------------------------------------
say "nginx"
# ---------------------------------------------------------------------------
if command -v nginx >/dev/null; then
  cat > "/etc/nginx/sites-available/${DOMAIN}" <<NGINX
server {
    listen 80;
    server_name ${DOMAIN};

    client_max_body_size 8M;   # question images

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        # The live proctor feed is a websocket. Without these two headers it
        # never connects, and nothing anywhere says why.
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
    }
}
NGINX
  ln -sf "/etc/nginx/sites-available/${DOMAIN}" "/etc/nginx/sites-enabled/${DOMAIN}"
  nginx -t >/dev/null 2>&1 && systemctl reload nginx && echo "${DIM}    site enabled for ${DOMAIN}${RST}" \
    || warn "nginx config test failed — check it before going live."
else
  warn "nginx is not installed; skipping. The app still listens on :4000."
fi

# ---------------------------------------------------------------------------
say "Starting the app"
# ---------------------------------------------------------------------------
systemctl restart kpr-exams
sleep 6
systemctl is-active --quiet kpr-exams \
  && echo "${DIM}    running${RST}" \
  || warn "It did not start. journalctl -u kpr-exams -n 40"

echo ""
say "Now do these two things by hand"
cat <<NEXT
${DIM}
    1. TLS. The session cookie is Secure, so nobody can stay signed in over
       plain http — it presents as a mysterious auth bug, not a config one.

         sudo certbot --nginx -d ${DOMAIN}

    2. Google. At https://console.cloud.google.com/apis/credentials add
       https://${DOMAIN} to your OAuth client's Authorised JavaScript origins.
${RST}
NEXT

say "Preflight"
cd "$REPO" && npm run preflight || true

echo ""
echo "When preflight says ${GRN}Ready${RST}, do a rehearsal before the first"
echo "graded paper: 20-30 real students, hall machines, hall network."
