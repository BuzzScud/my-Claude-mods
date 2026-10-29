#!/usr/bin/env python3
"""Drive a real Claude Code in a pty and capture its footer, cell by cell (no tmux, no node).

    python3 -m pip install --target .pylib pyte
    PYTHONPATH=.pylib python3 drive.py steps.json captures.json claude --dangerously-skip-permissions
    python3 render.py captures.json captures.png

Steps: ["snap", label] saves the bottom rows with each cell's glyph, ink and background;
["type", text, seconds] types the text and Enter; ["size", columns, seconds] resizes the window.
It starts at 140 columns, in an empty folder (RUN_DIR, default <tmp>/usage-footer-run), and
answers the folder-trust question there with yes. Typing /limits writes the add-on's saved choice
for every window on the Mac: end a run that changes it with /limits on.
"""
import fcntl, json, os, pty, select, signal, struct, sys, tempfile, termios, time

import pyte

steps = json.load(open(sys.argv[1]))
out, args = sys.argv[2], sys.argv[3:]
cols, rows = 140, 30
run_dir = os.environ.get('RUN_DIR', os.path.join(tempfile.gettempdir(), 'usage-footer-run'))
os.makedirs(run_dir, exist_ok=True)

pid, fd = pty.fork()
if pid == 0:
    os.chdir(run_dir)
    os.environ['TERM'] = 'xterm-256color'
    os.execvp(args[0], args)


def size(columns):
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))


class Screen(pyte.Screen):
    # Claude Code asks the terminal things pyte's screen can't answer; the pump answers them.
    def report_device_status(self, *args, **kwargs):
        pass

    def write_process_input(self, data):
        pass


size(cols)
screen = Screen(cols, rows)
stream = pyte.ByteStream(screen)
trusted = False


def pump(seconds):
    global trusted
    end = time.time() + seconds
    while time.time() < end:
        ready, _, _ = select.select([fd], [], [], 0.1)
        if not ready:
            continue
        try:
            data = os.read(fd, 65536)
        except OSError:
            return
        stream.feed(data)
        if b'\x1b[6n' in data:
            os.write(fd, b'\x1b[%d;%dR' % (screen.cursor.y + 1, screen.cursor.x + 1))
        if not trusted and 'trust this folder' in '\n'.join(screen.display):
            trusted = True
            time.sleep(0.5)
            os.write(fd, b'\x1b[B')
            time.sleep(0.3)
            os.write(fd, b'\r')


snaps = []
pump(10)
for step in steps:
    if step[0] == 'type':
        for ch in step[1]:
            os.write(fd, ch.encode())
            pump(0.05)
        pump(0.4)
        os.write(fd, b'\r')
        pump(step[2])
    elif step[0] == 'size':
        size(step[1])
        screen.resize(rows, step[1])
        os.kill(pid, signal.SIGWINCH)
        pump(step[2])
    elif step[0] == 'snap':
        lines = [[[screen.buffer[y][x].data, screen.buffer[y][x].fg, screen.buffer[y][x].bg] for x in range(screen.columns)] for y in range(rows)]
        text = [''.join(cell[0] for cell in line).rstrip() for line in lines]
        while text and not text[-1]:
            text.pop()
            lines.pop()
        # The footer row only.
        snaps.append({'label': step[1], 'columns': screen.columns, 'rows': lines[-1:]})
        print(f'--- {step[1]} ({screen.columns} columns)\n{text[-1]}')
os.kill(pid, signal.SIGTERM)
json.dump(snaps, open(out, 'w'))
