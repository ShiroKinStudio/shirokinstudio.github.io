#!/data/data/com.termux/files/usr/bin/bash
termux-wake-lock 2>/dev/null || true
sleep 8
mkdir -p "$HOME/kin-relay"
while true; do
  "$HOME/kin-relay/start.sh" >> "$HOME/kin-relay/boot.log" 2>&1
  sleep 5
done
