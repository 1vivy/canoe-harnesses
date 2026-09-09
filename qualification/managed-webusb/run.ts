import { chromium } from 'playwright-core'
import { connectSession, loadProfile } from '../../src/index.ts'

const [sessionId, output, kind = 'fat'] = process.argv.slice(2)
if (!sessionId || !output || !['fat', 'ext4'].includes(kind))
  throw Error('Usage: bun qualification/managed-webusb/run.ts SESSION OUTPUT.json [fat|ext4]')
const session = connectSession(sessionId)
await session.observe() // Authenticate to the live owner before opening controls.
const profile = loadProfile(session.record.profilePath)
if (!profile.browser || !('cdpEndpoint' in profile.browser)) throw Error('A leased fixture CDP profile is required')
const browser = await chromium.connectOverCDP(profile.browser.cdpEndpoint)
try {
  const pages = browser.contexts().flatMap(context => context.pages()).filter(page => new URL(page.url()).pathname.endsWith('/page.html'))
  if (pages.length !== 1) throw Error('Expected one selected fixture page')
  const page = pages[0]!
  await page.waitForFunction(() => globalThis.fixture?.storage?.usable() || globalThis.fixture?.error, {}, { timeout: 25_000 })
  const report = await page.evaluate(async kind => {
    const { runFilesystemProbe } = await import('/browser-probe.js')
    return runFilesystemProbe(globalThis.fixture, kind)
  }, kind)
  await Bun.write(output, JSON.stringify({ browser: browser.version(), ...report }, null, 2) + '\n')
  console.log(`Saved actual guest USB/browser evidence to ${output}`)
} finally { await browser.close() }
