#!/bin/bash
#
# Brings Judge0 up inside WSL. Run from Windows with:
#
#   wsl -u root -e bash /mnt/e/College-Coding-App/scripts/start-judge0.sh
#
# Why this script exists rather than "docker compose up":
#
# Judge0's sandbox (isolate 1.8) puts each submission in its own control group
# under /sys/fs/cgroup/memory/box-N. That path exists only in the cgroup **v1**
# hierarchy. WSL2 and Ubuntu 24.04 mount cgroup **v2**, where isolate fails and
# every submission returns "Internal Error" — the API looks healthy, students
# get no marks, and nothing in the logs says why.
#
# The combination that works, all three parts required:
#   * systemd off in /etc/wsl.conf   (systemd owns the v2 hierarchy and will
#                                     not release the memory controller)
#   * cgroup v1 mounted by hand      (below)
#   * Docker 26.x                    (Docker 28+ removed cgroup v1 support and
#                                     its daemon panics on startup here)
#
# On the real exam server none of this applies: choose Ubuntu 22.04, set
# `systemd.unified_cgroup_hierarchy=0` in GRUB, and Judge0's documented install
# works normally.
set -e

JUDGE0_DIR=/opt/judge0/judge0-v1.13.1

echo "==> cgroup v1"
if [ -f /sys/fs/cgroup/cgroup.controllers ]; then
  umount /sys/fs/cgroup 2>/dev/null || umount -l /sys/fs/cgroup
  mount -t tmpfs -o mode=755 tmpfs /sys/fs/cgroup
fi
for c in memory cpuacct cpuset cpu blkio pids devices freezer; do
  mkdir -p "/sys/fs/cgroup/$c"
  mountpoint -q "/sys/fs/cgroup/$c" || mount -t cgroup -o "$c" cgroup "/sys/fs/cgroup/$c" 2>/dev/null || true
done
if [ -d /sys/fs/cgroup/memory ]; then
  echo "    memory controller ready"
else
  echo "    FAILED: no memory controller. Is systemd still enabled? (/etc/wsl.conf)" >&2
  exit 1
fi

echo "==> docker"
if ! pidof dockerd >/dev/null; then
  nohup dockerd >/var/log/dockerd.log 2>&1 &
  sleep 15
fi
docker info --format '    daemon up, cgroup v{{.CgroupVersion}}'

echo "==> judge0"
cd "$JUDGE0_DIR"
docker compose up -d db redis >/dev/null 2>&1
sleep 12
docker compose up -d >/dev/null 2>&1
sleep 20

for i in $(seq 1 20); do
  if curl -sf -m 5 http://localhost:2358/about >/dev/null 2>&1; then
    echo "    Judge0 answering on http://localhost:2358"
    # Prove the sandbox actually executes, not just that the API replies. A
    # running server with a broken sandbox is the failure mode this whole
    # script exists to prevent, and it is invisible from /about alone.
    OUT=$(curl -sS -m 25 -X POST 'http://localhost:2358/submissions?base64_encoded=false&wait=true' \
      -H 'Content-Type: application/json' \
      -d '{"language_id":71,"source_code":"print(2+3)"}' 2>/dev/null)
    if echo "$OUT" | grep -q '"stdout":"5'; then
      echo "    sandbox executes correctly — ready for exams"
      exit 0
    fi
    echo "    WARNING: Judge0 is up but the sandbox did not execute:" >&2
    echo "    $OUT" >&2
    exit 1
  fi
  sleep 3
done

echo "    Judge0 did not come up. Check: docker compose -f $JUDGE0_DIR/docker-compose.yml logs" >&2
exit 1
