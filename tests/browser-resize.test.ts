import {expect,test} from 'bun:test'
import {mkdtempSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import type {Browser,Page} from 'playwright-core'
import {Target} from '../src/target'

test.skipIf(!process.env.DISPLAY)('manual browser follows native window resizing without viewport emulation',async()=>{
  const evidence=mkdtempSync(join(tmpdir(),'canoe-harness-resize-'))
  const target=new Target({schemaVersion:1,id:'native-window-resize',platform:'linux',control:{kind:'local'},browser:{url:'data:text/html,<title>Harness resize check</title>',headless:false}},evidence,'isolated-resize-profile')
  try {
    await target.interact({kind:'launch'})
    // Inspect this isolated controller's browser, never an attached user session.
    const {browser,page}=target as unknown as {browser:Browser;page:Page}
    expect(page.viewportSize()).toBeNull()
    const cdp=await browser.newBrowserCDPSession()
    const pageCdp=await page.context().newCDPSession(page)
    const {targetInfo}=await pageCdp.send('Target.getTargetInfo')
    const {windowId}=await cdp.send('Browser.getWindowForTarget',{targetId:targetInfo.targetId})
    const widths:number[]=[]
    for(const width of [1100,680]) {
      await cdp.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal',width,height:780}})
      await page.waitForFunction(expected=>Math.abs(window.outerWidth-expected)<20,width)
      await page.waitForFunction(()=>Math.abs(window.innerWidth-window.outerWidth)<40)
      widths.push(await page.evaluate(()=>window.innerWidth))
    }
    expect(widths[0]!-widths[1]!).toBeGreaterThan(350)
  } finally {
    await target.close()
    rmSync(evidence,{recursive:true,force:true})
  }
},30_000)
