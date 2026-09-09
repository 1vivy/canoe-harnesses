/** Hotplug only named synthetic disks in the isolated Windows fixture. */
import {connectSession,loadProfile} from '../../src/index.ts'
const [id,which,image]=process.argv.slice(2)
if(!id||!['managed','manual'].includes(which??'')||!image||!(image==='detach'||/^[a-zA-Z0-9_-]+\.img$/.test(image)))
  throw Error('Usage: windows-cycle.ts SESSION managed|manual IMAGE.img|detach')
const session=connectSession(id)
const profile=loadProfile(session.record.profilePath)
if(profile.platform!=='windows'||profile.qemu?.container!=='canoe-e2e-webusb-windows')
  throw Error('This helper only controls the isolated Windows fixture')
await session.observe()
const monitor=async(command:string)=>String(await session.interact({kind:'qemu-monitor',command}))
const present=async()=>(await monitor('info usb')).includes(`ID: ${which}`)
if(await present()){
  await monitor(`device_del ${which}`)
  const end=Date.now()+10_000
  while(await present()){
    if(Date.now()>end)throw Error('Synthetic USB detach did not complete')
    await Bun.sleep(100)
  }
}
if(image==='detach'){console.log(`Detached ${which}`);process.exit(0)}
const drive=await monitor(`drive_add 0 file=/fixtures/${image},format=raw,if=none,id=${which}-drive`)
if(drive.trim()!=='OK')throw Error(`Cannot open synthetic backing: ${drive}`)
const properties=which==='managed'?'managed=on,productid=0xca0f,serial=CANOE_MANAGED':'removable=on,productid=0xca0e,serial=CANOE_MANUAL'
const added=await monitor(`device_add usb-storage,bus=fixture-xhci.0,drive=${which}-drive,id=${which},vendorid=0x1209,${properties}`)
if(added.trim())throw Error(`Cannot attach synthetic disk: ${added}`)
if(!(await present()))throw Error('Synthetic device absent after attach')
console.log(`Attached ${which} from /fixtures/${image}`)
