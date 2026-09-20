#!/usr/bin/env python3
import json
import socket
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path.home() / "kin-relay"
CFG = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
STATE = ROOT / "relay_state.json"

def mac_bytes(mac):
    clean = mac.replace("-", "").replace(":", "").strip()
    if len(clean) != 12:
        raise ValueError("Invalid MAC")
    return bytes.fromhex(clean)

def send_wol():
    mac = mac_bytes(CFG["target_mac"])
    packet = b"\xff" * 6 + mac * 16
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        for _ in range(int(CFG.get("repeat", 3))):
            sock.sendto(packet, (CFG["broadcast_ip"], int(CFG.get("wol_port", 9))))
            time.sleep(int(CFG.get("repeat_delay_ms", 180)) / 1000)
    finally:
        sock.close()
    print("[KIN Relay] WoL gonderildi ->", CFG["target_mac"], flush=True)

def load_state():
    try:
        return json.loads(STATE.read_text(encoding="utf-8"))
    except Exception:
        return {}

def save_state(last_id):
    STATE.write_text(json.dumps({"last_id": last_id}), encoding="utf-8")

def fetch_messages(since):
    topic = urllib.parse.quote(CFG["topic"], safe="")
    since_q = urllib.parse.quote(str(since), safe="")
    url = f'{CFG["ntfy_base"].rstrip("/")}/{topic}/json?poll=1&since={since_q}'
    req = urllib.request.Request(url, headers={"User-Agent":"KIN-Phone-Relay/0.2"})
    with urllib.request.urlopen(req, timeout=30) as r:
        lines = r.read().decode("utf-8", errors="replace").splitlines()
    out = []
    for raw in lines:
        try:
            out.append(json.loads(raw))
        except Exception:
            pass
    return out

def main():
    expected = f'{CFG["wake_message"]}:{CFG["command_secret"]}'
    state = load_state()
    last_id = state.get("last_id")
    startup_since = str(int(time.time()))

    if not last_id:
        try:
            latest = fetch_messages("latest")
            ids = [m.get("id") for m in latest if m.get("event") == "message" and m.get("id")]
            if ids:
                last_id = ids[-1]
                save_state(last_id)
        except Exception:
            pass

    print("[KIN Relay] ONLINE - komut bekleniyor", flush=True)

    while True:
        try:
            since = last_id or startup_since
            messages = fetch_messages(since)
            for msg in messages:
                if msg.get("event") != "message":
                    continue
                msg_id = msg.get("id")
                if msg_id and msg_id == last_id:
                    continue
                body = str(msg.get("message", "")).strip()
                if body == expected:
                    send_wol()
                elif body.startswith("WAKE"):
                    print("[KIN Relay] Gecersiz wake komutu reddedildi.", flush=True)
                if msg_id:
                    last_id = msg_id
                    save_state(last_id)
            time.sleep(5)
        except Exception as e:
            print("[KIN Relay] baglanti yenileniyor:", type(e).__name__, flush=True)
            time.sleep(5)

if __name__ == "__main__":
    main()
