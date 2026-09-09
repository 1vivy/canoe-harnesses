/** A read-only in-flight disconnect against the isolated Windows USB fixture. */
import {chromium} from 'playwright-core'
import {connectSession,loadProfile} from '../../src/index.ts'
const [id,output]=process.argv.slice(2)
if(!id||!output)throw Error('Usage: windows-unplug.ts SESSION OUTPUT.json')
const session=connectSession(id),profile=loadProfile(session.record.profilePath)
if(profile.qemu?.container!=='canoe-e2e-webusb-windows'||!profile.browser||!('cdpEndpoint' in profile.browser))throw Error('Expected isolated Windows CDP fixture')
await session.observe()
const browser=await chromium.connectOverCDP(profile.browser.cdpEndpoint)
try{
 const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>new URL(p.url()).pathname==='/page.html')
 if(pages.length!==1)throw Error('Expected one fixture page')
 const page=pages[0]!
 await page.evaluate(async()=>{
   const grants=(await navigator.usb.getDevices()).filter(d=>d.serialNumber==='CANOE_MANAGED')
   if(grants.length!==1)throw Error('Expected one previously granted fixture')
   const f=globalThis.fixture;f.grant=grants[0];f.storage=await f.api.openManagedStorage(f.grant,'read-only')
   f.fault={completedReads:0,rangeBytes:4194304,done:false,error:null}
   f.pending=(async()=>{
     try{for(let i=0;i<1000;i++){await f.storage.readRange(0n,4194304);f.fault.completedReads++}}
     catch(error){f.fault.error=String(error)}
     f.fault.usable=f.storage.usable();f.fault.opened=f.grant.opened;f.fault.done=true
   })()
 })
 await page.waitForFunction(()=>globalThis.fixture.fault.completedReads>=2,{}, {timeout:15000})
 await session.interact({kind:'qemu-monitor',command:'device_del managed'})
 await page.waitForFunction(()=>globalThis.fixture.fault.done,{}, {timeout:30000})
 const fault=await page.evaluate(()=>globalThis.fixture.fault)
 if(!fault.error||fault.usable||fault.opened)throw Error('Disconnected session did not retire/close')
 await Bun.write(output,JSON.stringify({browser:browser.version(),physicalPhone:false,realGuestUsb:true,...fault},null,2)+'\n')
 console.log(`Saved read-only unplug evidence to ${output}`)
}finally{await browser.close()}
