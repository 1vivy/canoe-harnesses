#!/usr/bin/env python3
"""Cycle only the named synthetic managed disk, under an owning harness lease.

The supplied socket must belong to the separate canoe-webusb-fixture guest.
No container name, libvirt domain or physical USB path is inferred.
"""
import argparse, json, socket, time
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('state',type=Path)
p.add_argument('--image',default='managed.img')
p.add_argument('--detach',action='store_true')
a=p.parse_args()
s=socket.socket(socket.AF_UNIX);s.settimeout(10);s.connect(str(a.state/'qmp.sock'))
f=s.makefile('rwb',buffering=0)
events=[]
assert 'QMP' in json.loads(f.readline())
def command(name,args=None):
 f.write((json.dumps({'execute':name,'arguments':args or {}})+'\n').encode())
 while True:
  r=json.loads(f.readline())
  if 'event' in r: events.append(r)
  if 'error' in r: raise RuntimeError(r['error'])
  if 'return' in r: return r['return']
command('qmp_capabilities')
name=command('query-name')
if name.get('name')!='canoe-webusb-fixture': raise RuntimeError('Refusing another guest')
devices=command('qom-list',{'path':'/machine/peripheral'})
if any(d.get('name')=='managed' for d in devices):
 command('device_del',{'id':'managed'})
 deadline=time.monotonic()+10
 while True:
  r=events.pop(0) if events else json.loads(f.readline())
  if r.get('event')=='DEVICE_DELETED' and r.get('data',{}).get('device')=='managed': break
  if time.monotonic()>deadline: raise TimeoutError('Managed fixture did not detach')
nodes=command('query-named-block-nodes')
if any(n.get('node-name')=='managed-media' for n in nodes):
 command('blockdev-del',{'node-name':'managed-media'})
if a.detach:
 print(json.dumps({'detached':'managed','physicalDevice':False}));raise SystemExit(0)
image=(a.state/a.image).resolve()
if image.parent!=a.state.resolve() or not image.is_file(): raise RuntimeError('Expected an existing fixture image in the fixture directory')
command('blockdev-add',{'driver':'raw','node-name':'managed-media','file':{'driver':'file','filename':str(image)}})
command('device_add',{'driver':'usb-storage','bus':'xhci.0','drive':'managed-media','id':'managed','removable':True,'vendorid':0x1209,'productid':0xca0f,'managed':True,'serial':'CANOE_MANAGED'})
print(json.dumps({'cycled':'managed','physicalDevice':False}))
