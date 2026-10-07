#!/usr/bin/env bash
# Builds the bot and installs it on the Oracle VPS (ssh alias oracle-vm). The token is not part of this:
# it lives only in /home/ubuntu/.config/oasa-bus-bot/env on the VPS (TELEGRAM_TOKEN=..., mode 600).
set -euo pipefail
cd "$(dirname "$0")/.."
bun run bot:build
ssh oracle-vm 'mkdir -p ~/oasa-bus-bot ~/.local/state/oasa-bus-bot ~/.config/oasa-bus-bot && chmod 700 ~/.config/oasa-bus-bot'
scp -q dist-bot/oasa-bus-bot.mjs oracle-vm:oasa-bus-bot/oasa-bus-bot.mjs
scp -q bot/oasa-bus-bot.service oracle-vm:oasa-bus-bot/oasa-bus-bot.service
ssh oracle-vm 'sudo install -m 644 ~/oasa-bus-bot/oasa-bus-bot.service /etc/systemd/system/ && sudo systemctl daemon-reload &&
  sudo systemctl enable oasa-bus-bot >/dev/null 2>&1; if [ -f ~/.config/oasa-bus-bot/env ]; then sudo systemctl restart oasa-bus-bot; else echo "no token yet: ~/.config/oasa-bus-bot/env"; fi'
