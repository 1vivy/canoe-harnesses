#!/usr/bin/env python3
"""Model BDS leaving mass-storage after SCSI eject, including USB teardown delay."""
import sys
import time
from pathlib import Path

gadget = Path(sys.argv[1])
lun = gadget / 'functions/mass_storage.0/lun.0/file'
udc = gadget / 'UDC'
delay_file = Path('/opt/canoe/export-disconnect-delay-ms')
delay_ms = int(delay_file.read_text()) if delay_file.exists() else 500
if not 0 <= delay_ms <= 15000:
    raise ValueError('invalid export-disconnect delay')
try:
    controller = udc.read_text().strip()
    while controller and udc.read_text().strip() == controller:
        if not lun.read_text().strip():
            time.sleep(delay_ms / 1000)
            if udc.read_text().strip() == controller and not lun.read_text().strip():
                udc.write_text('\n')
            break
        time.sleep(.05)
except FileNotFoundError:
    pass  # The fixture was explicitly unplugged/reset.
