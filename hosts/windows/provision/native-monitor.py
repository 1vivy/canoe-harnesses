# Runs inside the dedicated QEMU container, including on the secure desktop.
import socket
import time

with socket.socket(socket.AF_UNIX) as monitor:
    monitor.connect('/run/shm/monitor.sock')
    monitor.recv(4096)
    monitor.sendall(b'screendump /tmp/canoe-elevation.ppm\n')
    time.sleep(0.2)
    monitor.recv(16384)
    # Acknowledge the auto-deny policy's blocking notice. Never approve UAC.
    monitor.sendall(b'sendkey esc\n')
    time.sleep(0.2)
