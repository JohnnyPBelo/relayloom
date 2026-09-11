"""Real OS PTY byte-stream link for serial adapter tests. No physical radio claim."""
import os, pty, tty, select, signal, json, sys
left, ls = pty.openpty()
right, rs = pty.openpty()
tty.setraw(ls)
tty.setraw(rs)
print(json.dumps({'left': os.ttyname(ls), 'right': os.ttyname(rs)}), flush=True)
running = True
connected = True
def stop(*_):
    global running
    running = False
def toggle(*_):
    global connected
    connected = not connected
signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGUSR1, toggle)
while running:
    ready, _, _ = select.select([left, right], [], [], .1)
    for fd in ready:
        try:
            data = os.read(fd, 65536)
            if connected and data:
                other = right if fd == left else left
                while data:
                    written = os.write(other, data)
                    data = data[written:]
        except OSError:
            pass
for fd in (left, ls, right, rs):
    os.close(fd)
