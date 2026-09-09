#!/usr/bin/env python3
"""Read-only descriptor check. Run inside the leased synthetic USB guest."""
import json, struct
import usb.core

def le32(data, offset): return struct.unpack_from('<I',data,offset)[0]
all_devices=list(usb.core.find(find_all=True,idVendor=0x1209,idProduct=0xca0f))
devices=[d for d in all_devices if d.serial_number=='CANOE_MANAGED']
if len(devices)!=1: raise RuntimeError('Expected exactly one synthetic CANOE_MANAGED device')
d=devices[0]
i=d[0][(0,0)]
assert (i.bInterfaceClass,i.bInterfaceSubClass,i.bInterfaceProtocol)==(255,6,80)
os_string=bytes(d.ctrl_transfer(0x80,6,0x03ee,0x0409,18,timeout=5000))
assert os_string[2:16].decode('utf-16-le')=='MSFT100'
vendor=os_string[16]
compat=bytes(d.ctrl_transfer(0xc0,vendor,0,4,4096,timeout=5000))
assert le32(compat,0)==len(compat)==40 and compat[18:26].rstrip(b'\0')==b'WINUSB'
props=bytes(d.ctrl_transfer(0xc1,vendor,0,5,4096,timeout=5000))
assert le32(props,0)==len(props) and struct.unpack_from('<H',props,8)[0]==1
size=le32(props,10);kind=le32(props,14);name_size=struct.unpack_from('<H',props,18)[0]
name=props[20:20+name_size].decode('utf-16-le').rstrip('\0')
at=20+name_size;value_size=le32(props,at);value=props[at+4:at+4+value_size].decode('utf-16-le')
assert kind==7 and name=='DeviceInterfaceGUIDs' and value.endswith('\0\0')
assert len(props)==10+size==at+4+value_size
print(json.dumps({'serial':d.serial_number,'interface':[i.bInterfaceClass,i.bInterfaceSubClass,i.bInterfaceProtocol], 'msosVersion':1,'compatibleId':'WINUSB','property':name,'guid':value.rstrip('\0'),'propertyBytes':len(props),'physicalPhone':False},indent=2))
