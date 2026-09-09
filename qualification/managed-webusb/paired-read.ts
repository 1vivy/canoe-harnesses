/** Reopen a freshly re-enumerated, previously granted synthetic USB disk. */
import {chromium} from 'playwright-core'
import {connectSession,loadProfile} from '../../src/index.ts'
const [id,output,expectedSha256]=process.argv.slice(2)
if(!id||!output||!/^[a-f0-9]{64}$/.test(expectedSha256??''))throw Error('Usage: paired-read.ts SESSION OUTPUT.json FIRST4096_SHA256')
const session=connectSession(id),profile=loadProfile(session.record.profilePath)
if(!profile.browser||!('cdpEndpoint' in profile.browser))throw Error('Expected leased browser fixture')
await session.observe()
const browser=await chromium.connectOverCDP(profile.browser.cdpEndpoint)
try{
 const pages=browser.contexts().flatMap(c=>c.pages()).filter(p=>new URL(p.url()).pathname==='/page.html')
 if(pages.length!==1)throw Error('Expected one fixture page')
 const result=await pages[0]!.evaluate(async expected=>{
   const f=globalThis.fixture,end=Date.now()+10000
   if(f.storage?.usable())throw Error('Close previous session before paired reopen')
   let grants=[]
   do{
     grants=(await navigator.usb.getDevices()).filter(d=>d.serialNumber==='CANOE_MANAGED')
     if(grants.length)break
     await new Promise(resolve=>setTimeout(resolve,100))
   }while(Date.now()<end)
   if(grants.length!==1)throw Error('Expected one re-enumerated paired fixture')
   f.grant=grants[0];f.storage=await f.api.openManagedStorage(f.grant,'read-only')
   const sample=await f.storage.readRange(0n,4096)
   const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',sample)),x=>x.toString(16).padStart(2,'0')).join('')
   if(sha256!==expected)throw Error('Fresh sample differs from backing file')
   const identity=f.storage.identity(),capacity=f.storage.capacity()
   await f.storage.sync();await f.storage.eject()
   if(f.storage.usable()||f.grant.opened)throw Error('Eject did not close')
   return {identity,capacity,sha256,pairedReopen:true,ejected:true,opened:f.grant.opened}
 },expectedSha256)
 await Bun.write(output,JSON.stringify({browser:browser.version(),physicalPhone:false,realGuestUsb:true,...result},null,2)+'\n')
 console.log(`Saved paired reopen evidence to ${output}`)
}finally{await browser.close()}
