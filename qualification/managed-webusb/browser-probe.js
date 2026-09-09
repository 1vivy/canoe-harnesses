/** Production USB+filesystem composition; call only after the native chooser.
 * No USB APIs, block I/O or filesystem implementations are substituted.
 */
export async function runFilesystemProbe(fixture, kind) {
  const {api, openFilesystem, grant} = fixture;
  let storage = fixture.storage;
  if (!storage?.usable() || grant.serialNumber !== 'CANOE_MANAGED')
    throw Error('Expected an open synthetic managed fixture');
  if (!['fat', 'ext4'].includes(kind)) throw Error('Expected fat or ext4');
  const check=(value,message)=>{if(!value)throw Error(message);};
  const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  const results=[];
  const path=`/qualification-${Date.now()}`;
  const open=async access=>storage=fixture.storage=await api.openManagedStorage(grant,access);
  const close=async()=>{await storage.sync();await storage.close();check(!grant.opened,'awaited close');};
  results.push({name:'real-webusb-initialize',identity:storage.identity(),capacity:storage.capacity()});
  const sampleHash=await hash(await storage.readRange(0n,4096));
  results.push({name:'first4096',sha256:sampleHash});
  let denied=false;try{await storage.writeRange(0n,new Uint8Array(1));}catch(error){denied=String(error).includes('read-only');}
  check(denied&&storage.usable(),'raw read-only rejection');
  const fs=await openFilesystem({storage,kind,access:'read-only'});
  results.push({name:'real-worker-read-only',inspection:await fs.inspect(),files:await fs.list('/')});
  const foreign=kind==='ext4'?await hash(await fs.read('/foreign.txt')):null;
  for(const [method,args] of [['mkdir',[path]],['createFile',[path]],['remove',[path]],['rename',[path,path+'-renamed']],['truncate',[path,0]],['write',[path,0,new Uint8Array(1)]]]){
    let denied=false;try{await fs[method](...args)}catch(error){denied=String(error).includes('read-only');}
    check(denied,`filesystem read-only ${method}`);
  }
  await fs.finish();await close();
  results.push({name:'all-read-only-mutations-refused',ok:true});
  for(let i=0;i<3;i++) {await open('read-only');check(await hash(await storage.readRange(0n,4096))===sampleHash,'fresh sample');await close();}
  results.push({name:'three-fresh-close-reopen-cycles',ok:true});
  await open('read-write');
  const writable=await openFilesystem({storage,kind,access:'read-write'});
  await writable.mkdir(path);await writable.createFile(path+'/probe.txt');
  const expected=new TextEncoder().encode(`Actual Chromium, guest USB host controller, QEMU BOT and Rust ${kind} worker.\n`);
  await writable.write(path+'/probe.txt',0,expected);await writable.rename(path+'/probe.txt',path+'/verified.txt');
  await writable.finish();await close();
  await open('read-only');
  const fresh=await openFilesystem({storage,kind,access:'read-only'});
  const actual=await fresh.read(path+'/verified.txt');check(await hash(actual)===await hash(expected),'fresh file readback');
  if(foreign)check(await hash(await fresh.read('/foreign.txt'))===foreign,'unrelated file unchanged');
  results.push({name:'write-rename-fresh-readback',bytes:actual.length,sha256:await hash(actual),path});
  await fresh.finish();await close();
  await open('read-write');const cleanup=await openFilesystem({storage,kind,access:'read-write'});
  await cleanup.remove(path+'/verified.txt');await cleanup.remove(path);await cleanup.finish();await close();
  await open('read-only');const last=await openFilesystem({storage,kind,access:'read-only'});
  check(!(await last.list('/')).some(entry=>'/'+entry.name===path),'fresh deletion readback');
  if(foreign)check(await hash(await last.read('/foreign.txt'))===foreign,'unrelated file after cleanup');
  await last.finish();await storage.sync();await storage.eject();
  check(!storage.usable()&&!grant.opened,'eject retires and closes');
  results.push({name:'remove-fresh-absence-sync-eject-close',ok:true});
  return {physicalPhone:false,realGuestUsb:true,results};
}

/** Plain JBD2 fixture generated independently by journal_mount_recovery.rs.
 * The caller supplies SHA256 of the separately retained complete image.
 */
export async function runJournalProbe(fixture, backupSha256) {
  const {api, openFilesystem, grant} = fixture;
  let storage=fixture.storage;
  if(!storage?.usable()||grant.serialNumber!=='CANOE_MANAGED'||!/^[a-f0-9]{64}$/.test(backupSha256))
    throw Error('Expected open synthetic fixture and independently saved backup digest');
  const rawHash=async()=>{
    const size=storage.capacity().bytes;
    if(size>64*1024*1024)throw Error('Journal qualification fixture exceeds64MiB');
    const all=new Uint8Array(size);
    for(let offset=0;offset<size;offset+=4194304)
      all.set(await storage.readRange(BigInt(offset),Math.min(4194304,size-offset)),offset);
    return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',all)),x=>x.toString(16).padStart(2,'0')).join('');
  };
  const beforeHash=await rawHash();
  if(beforeHash!==backupSha256)throw Error('Retained full backup does not match fixture');
  const fs=await openFilesystem({storage,kind:'ext4',access:'read-only'});
  const before=await fs.inspect();
  if(!before.needsRecovery||!before.journal.start)throw Error('Expected pending committed journal');
  await fs.list('/');await fs.finish();await storage.close();
  storage=fixture.storage=await api.openManagedStorage(grant,'read-only');
  const afterReadOnlyHash=await rawHash();
  if(afterReadOnlyHash!==beforeHash)throw Error('Read-only inspection mutated fixture');
  await storage.close();
  storage=fixture.storage=await api.openManagedStorage(grant,'read-write');
  const mounted=await openFilesystem({storage,kind:'ext4',access:'read-write'});
  const during=await mounted.inspect();
  await mounted.finish();await storage.sync();await storage.close();
  storage=fixture.storage=await api.openManagedStorage(grant,'read-only');
  const fresh=await openFilesystem({storage,kind:'ext4',access:'read-only'});
  const after=await fresh.inspect();
  if(after.needsRecovery||after.journal.start)throw Error('Recovery was not finalized');
  await fresh.finish();await storage.sync();await storage.eject();
  if(storage.usable()||grant.opened)throw Error('Eject did not retire and close');
  return {physicalPhone:false,realGuestUsb:true,beforeHash,afterReadOnlyHash,backupSha256,before,during,after};
}
