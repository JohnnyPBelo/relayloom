"""RelayLoom byte streams over the unmodified Reticulum reference implementation.

No application identity or plaintext crosses this boundary. JSON-lines IPC is
private to the owning process, bounded, and never exposed as a network API.
"""
import argparse
import base64
import json
import os
from pathlib import Path
import queue
import sys
import threading
import time
import uuid
from collections import deque

import RNS
from RNS.Channel import MessageBase, ChannelException, CEType
from RNS.vendor.configobj import ConfigObj

MAX_LINKS = 16
MAX_FRAME = 4097
MAX_LINE = 8192
MAX_SEGMENT = 256
APP = "relayloom"
ASPECTS = ("stream", "v1")


class Segment(MessageBase):
    MSGTYPE = 0x524C

    def __init__(self, data=b""):
        self.data = data

    def pack(self):
        return self.data

    def unpack(self, raw):
        if not 0 < len(raw) <= MAX_SEGMENT:
            raise ValueError("invalid RelayLoom segment")
        self.data = raw


class Sidecar:
    def __init__(self, config):
        self.running = True
        self.events = queue.Queue(maxsize=256)
        self.commands = queue.Queue(maxsize=64)
        self.peers = {}
        self.desired = {}
        self.sent_segments = self.received_segments = self.proved_segments = 0
        self.guard = threading.RLock()
        directory = Path(config).resolve(strict=True)
        settings = ConfigObj(str(directory / "config"))
        # Never attach to, mutate or discover an unrelated shared local daemon.
        if not settings or settings["reticulum"].as_bool("share_instance"):
            raise ValueError("a dedicated config with share_instance=No is required")
        if settings["reticulum"].as_bool("enable_transport"):
            raise ValueError("application sidecars must use enable_transport=No; RelayLoom owns relay consent")
        allowed = {"TCPClientInterface", "TCPServerInterface", "SerialInterface", "RNodeInterface"}
        for section in settings.get("interfaces", {}).values():
            if not isinstance(section, dict) or section.get("type") not in allowed:
                raise ValueError("unsupported interface in dedicated config")
        if (directory / "interfaces").exists() and any((directory / "interfaces").iterdir()):
            raise ValueError("custom executable interfaces are not accepted")
        os.umask(0o077)
        # The application and RNS directories are independently selectable.
        # Two applications must never activate the same RNS transport identity.
        # Keep the OS lease until process exit, including RNS atexit persistence.
        self.lease = os.open(str(directory / "relayloom-owner.lock"),
                             os.O_CREAT | os.O_RDWR | getattr(os, "O_NOFOLLOW", 0), 0o600)
        try:
            if os.name == "nt":
                import msvcrt
                if os.fstat(self.lease).st_size == 0:
                    os.write(self.lease, b"\0")
                os.lseek(self.lease, 0, os.SEEK_SET)
                msvcrt.locking(self.lease, msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(self.lease)
            raise ValueError("Reticulum profile is already owned by another process") from None
        self.rns = RNS.Reticulum(configdir=str(directory), loglevel=RNS.LOG_ERROR,
                                logdest=lambda line: print(line, file=sys.stderr, flush=True))
        key = directory / "relayloom-transport.identity"
        if key.exists():
            self.identity = RNS.Identity.from_file(str(key))
            if self.identity is None:
                raise ValueError("invalid transport identity; refusing replacement")
        else:
            self.identity = RNS.Identity()
            self.identity.to_file(str(key))
        os.chmod(key, 0o600)
        self.destination = RNS.Destination(self.identity, RNS.Destination.IN,
                                           RNS.Destination.SINGLE, APP, *ASPECTS)
        self.destination.set_link_established_callback(self.inbound)
        threading.Thread(target=self.output, daemon=True).start()
        threading.Thread(target=self.input, daemon=True).start()
        self.emit({"t": "ready", "destination": self.destination.hash.hex(), "version": RNS.__version__})
        self.destination.announce()

    def emit(self, value):
        try:
            self.events.put_nowait(value)
        except queue.Full:
            self.running = False  # fail closed; never accumulate unbounded stdout

    def output(self):
        while self.running:
            try:
                value = self.events.get(timeout=1)
                sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
                sys.stdout.flush()
            except queue.Empty:
                continue
            except (BrokenPipeError, OSError):
                self.running = False

    def input(self):
        try:
            while self.running:
                line = sys.stdin.buffer.readline(MAX_LINE + 1)
                if not line or len(line) > MAX_LINE or not line.endswith(b"\n"):
                    break
                value = json.loads(line)
                if not isinstance(value, dict):
                    break
                self.commands.put_nowait(value)
        except (ValueError, queue.Full, OSError):
            pass
        finally:
            self.running = False

    def peer(self, link, remote=None):
        channel = link.get_channel()
        channel.register_message_type(Segment)
        ident = uuid.uuid4().hex
        p = {"id": ident, "link": link, "channel": channel, "remote": remote,
             "pending": None, "envelopes": deque(), "created": time.monotonic(), "up": False}
        with self.guard:
            full = len(self.peers) >= MAX_LINKS
            if not full:
                self.peers[ident] = p
        if full:
            link.teardown()
            return None
        channel.add_message_handler(lambda message: self.received(p, message))
        link.set_link_closed_callback(lambda closed: self.closed(ident))
        return p

    def up(self, p, remote):
        with self.guard:
            if p["id"] not in self.peers or p["up"]:
                return
            p["remote"] = remote
            p["up"] = True
        self.emit({"t": "up", "id": p["id"], "destination": remote,
                   "hops": RNS.Transport.hops_to(bytes.fromhex(remote))})

    def inbound(self, link):
        p = self.peer(link)
        if p:
            link.set_remote_identified_callback(lambda active, identity: self.up(
                p, RNS.Destination.hash(identity, APP, *ASPECTS).hex()))

    def established(self, link, remote):
        p = self.peer(link, remote)
        if p:
            link.identify(self.identity)
            self.up(p, remote)

    def closed(self, ident):
        with self.guard:
            if self.peers.pop(ident, None):
                self.emit({"t": "down", "id": ident})

    def received(self, p, message):
        if not isinstance(message, Segment):
            return False
        if not p["up"]:
            p["link"].teardown()
            return True
        self.received_segments += 1
        self.emit({"t": "data", "id": p["id"], "data": base64.b64encode(message.data).decode("ascii")})
        return True

    def command(self, cmd):
        kind = cmd.get("t")
        if kind == "stop" and set(cmd) == {"t"}:
            self.running = False
        elif kind == "connect" and set(cmd) == {"t", "destination"}:
            remote = cmd["destination"]
            if not isinstance(remote, str) or len(remote) != 32 or bytes.fromhex(remote).hex() != remote:
                raise ValueError("invalid destination")
            if remote == self.destination.hash.hex():
                raise ValueError("self connection")
            if remote not in self.desired and len(self.desired) >= MAX_LINKS:
                raise ValueError("peer budget")
            self.desired.setdefault(remote, {"next": 0, "link": None})
            self.destination.announce()
        elif kind in ("send", "close"):
            ident = cmd.get("id")
            p = self.peers.get(ident)
            if not p:
                return  # closing a link can race with already queued IPC
            if kind == "close" and set(cmd) == {"t", "id"}:
                p["link"].teardown()
            elif kind == "send" and set(cmd) == {"t", "id", "data"}:
                data = base64.b64decode(cmd["data"], validate=True)
                if not p["up"] or p["pending"] is not None or p["envelopes"] or not 0 < len(data) <= MAX_FRAME:
                    raise ValueError("write budget")
                p["pending"] = data
            else:
                raise ValueError("invalid stream command")
        else:
            raise ValueError("unknown command")

    def run(self):
        announce_at = time.monotonic() + 30
        stats_at = time.monotonic() + 5
        while self.running:
            for _ in range(64):
                try:
                    self.command(self.commands.get_nowait())
                except queue.Empty:
                    break
            now = time.monotonic()
            for remote, wanted in self.desired.items():
                link = wanted["link"]
                if any(p["remote"] == remote for p in list(self.peers.values())):
                    continue
                if link is not None and link.status != RNS.Link.CLOSED:
                    continue
                if now < wanted["next"]:
                    continue
                wanted["next"] = now + 5
                dest = bytes.fromhex(remote)
                identity = RNS.Identity.recall(dest)
                if not RNS.Transport.has_path(dest) or identity is None:
                    RNS.Transport.request_path(dest)
                else:
                    target = RNS.Destination(identity, RNS.Destination.OUT, RNS.Destination.SINGLE, APP, *ASPECTS)
                    wanted["link"] = RNS.Link(target, established_callback=lambda link, r=remote: self.established(link, r))
            for p in list(self.peers.values()):
                if not p["up"] and now - p["created"] > 10:
                    p["link"].teardown()
                # Four segments, retired ONLY as an ordered proved prefix.
                # Later packet proofs cannot advance past a partition gap.
                # The bounded pipeline fills RTT without unbounded admission;
                # native packet ACKs and content verification remain required.
                retired = False
                while p["envelopes"]:
                    envelope = p["envelopes"][0]
                    receipt = envelope.packet.receipt
                    if receipt is None or receipt.get_status() != RNS.PacketReceipt.DELIVERED:
                        break
                    p["envelopes"].popleft()
                    self.proved_segments += 1
                    retired = True
                if retired and not p["envelopes"] and p["pending"] is None:
                    self.emit({"t": "written", "id": p["id"]})
                data = p["pending"]
                if data and len(p["envelopes"]) < 4 and p["channel"].is_ready_to_send():
                    chunk = data[:min(MAX_SEGMENT, p["channel"].mdu)]
                    try:
                        p["envelopes"].append(p["channel"].send(Segment(chunk)))
                        self.sent_segments += 1
                        p["pending"] = data[len(chunk):] or None
                    except ChannelException as error:
                        if error.type != CEType.ME_LINK_NOT_READY:
                            p["link"].teardown()
            if now >= announce_at:
                self.destination.announce()
                announce_at = now + 30
            if now >= stats_at:
                self.emit({"t": "stats", "sent": self.sent_segments,
                           "received": self.received_segments, "proved": self.proved_segments,
                           "links": [{"pending": len(p["pending"] or b""),
                                      "unproved": len(p["envelopes"]),
                                      "rtt": p["link"].rtt, "window": p["channel"].window,
                                      "status": p["link"].status} for p in list(self.peers.values())]})
                stats_at = now + 5
            time.sleep(0.01)
        for p in list(self.peers.values()):
            p["link"].teardown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    try:
        Sidecar(args.config).run()
    except Exception as error:
        print(f"Reticulum adapter stopped: {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(1)
