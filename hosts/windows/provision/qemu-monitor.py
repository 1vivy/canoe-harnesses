"""Bounded HMP control for the dedicated Windows fixture, never a host device."""
import socket
import sys

with socket.socket(socket.AF_UNIX) as monitor:
    monitor.settimeout(15)
    monitor.connect('/run/shm/monitor.sock')
    def receive():
        data = b''
        while not data.endswith(b'(qemu) '):
            chunk = monitor.recv(65536)
            if not chunk:
                raise RuntimeError('QEMU monitor closed')
            data += chunk
        return data.decode(errors='replace')
    receive()
    for command in sys.argv[1:]:
        if '\n' in command or '\r' in command:
            raise ValueError('one command per argument required')
        monitor.sendall(command.encode() + b'\n')
        # Drop HMP's terminal-edit echo (one line of cursor escapes per input
        # character). Preserve the actual response, including errors.
        response = receive()
        if '\r\n' in response:
            response = response.split('\r\n', 1)[1]
        print(response.removesuffix('(qemu) ').rstrip())
