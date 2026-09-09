#!/usr/bin/env python3
"""Create a NEW, empty 32/64 MiB 4Kn VHDX fixture; never edit an existing disk.

QEMU's VHDX creator has no sector-size option. Set the two metadata items on
its new empty single-chunk image before any payload exists. MS-VHDX 2.6.2:
https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-vhdx/ef27fead-4178-4756-8d0f-dc76edd7e76d
"""
import argparse
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import uuid

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('destination', type=Path)
parser.add_argument('--mib', type=int, choices=[32, 64], default=32)
args = parser.parse_args()
if args.destination.suffix.lower() != '.vhdx' or args.destination.exists():
    parser.error('destination must be a new .vhdx fixture')
with tempfile.TemporaryDirectory(dir=args.destination.parent) as work:
    path = Path(work) / 'empty.vhdx'
    subprocess.run(['qemu-img', 'create', '-f', 'vhdx', str(path), f'{args.mib}M'], check=True)
    data = bytearray(path.read_bytes())
    assert data[:8] == b'vhdxfile'
    region_id = uuid.UUID('8b7ca206-4790-4b9a-b8fe-575f050f886e').bytes_le
    sector_ids = {uuid.UUID(value).bytes_le for value in [
        '8141bf1d-a96f-4709-ba47-f233a8faab5f',
        'cda348c7-445d-4471-9cc9-e9885251c556',
    ]}
    regions = set()
    for table in [192 * 1024, 256 * 1024]:
        assert data[table:table + 4] == b'regi'
        count = struct.unpack_from('<I', data, table + 8)[0]
        assert 0 < count < 2048
        for index in range(count):
            pos = table + 16 + index * 32
            if data[pos:pos + 16] == region_id:
                regions.add(struct.unpack_from('<Q', data, pos + 16)[0])
    assert len(regions) == 1
    start = regions.pop()
    assert data[start:start + 8] == b'metadata'
    count = struct.unpack_from('<H', data, start + 10)[0]
    assert 0 < count < 2048
    seen = set()
    for index in range(count):
        pos = start + 32 + index * 32
        key = bytes(data[pos:pos + 16])
        if key in sector_ids:
            offset, size = struct.unpack_from('<II', data, pos + 16)
            assert size == 4 and start + offset + size <= len(data)
            assert struct.unpack_from('<I', data, start + offset)[0] == 512
            struct.pack_into('<I', data, start + offset, 4096)
            seen.add(key)
    assert seen == sector_ids
    path.write_bytes(data)
    # Same-filesystem no-replace publication; do not overwrite a mounted fixture.
    os.link(path, args.destination)
