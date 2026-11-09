#!/usr/bin/env bash
# Builds the health check and installs it on the Oracle VPS (ssh alias oracle-vm) as a systemd USER unit:
# the check is read-only, so it needs no system user. Linger keeps the user manager (and the timer) running
# without a login session; enabling it is the one sudo step. NTFY_TOPIC is not part of
# this: it lives only in ~/.config/transit-health/env on the VPS (NTFY_TOPIC=..., mode 600).
set -euo pipefail
cd "$(dirname "$0")/../.."
bun run health:build
ssh oracle-vm 'mkdir -p ~/transit-health ~/.config/transit-health ~/.local/state/transit-health && chmod 700 ~/.config/transit-health'
scp -q dist-health/transit-health.mjs oracle-vm:transit-health/transit-health.mjs
scp -q ops/transit-health/transit-health.service ops/transit-health/transit-health.timer oracle-vm:transit-health/
ssh oracle-vm 'sudo loginctl enable-linger "$USER" && mkdir -p ~/.config/systemd/user &&
  install -m 644 ~/transit-health/transit-health.service ~/transit-health/transit-health.timer ~/.config/systemd/user/ &&
  systemctl --user daemon-reload &&
  if [ -f ~/.config/transit-health/env ]; then systemctl --user enable --now transit-health.timer;
  else echo "no topic yet: ~/.config/transit-health/env (NTFY_TOPIC=...)"; fi'
