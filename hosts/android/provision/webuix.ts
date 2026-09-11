#!/usr/bin/env bun
// Explicit provision hook for an already booted, rooted disposable guest.
// It never calls up.sh or replaces the guest kernel/root provider.
import { createHash } from "node:crypto"
import { mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { androidControl } from "../adb"
import { loadProfile } from "../../../src/profile"

const release = {
  tag: "v438",
  commit: "1cd1e76d9438225cc76abf2b2b42f2cc35eb7490",
  url: "https://github.com/MMRLApp/WebUI-X-Portable/releases/download/v438/WebUI-X-v438-release-official.apk",
  sha256: "7d44dcad3ae8039c63920c547116d262c282d5f43dbcf09fcf0babfce29bd1ca",
  package: "com.dergoogler.mmrl.wx",
  versionCode: 438,
}
const profilePath = process.env.CANOE_HARNESS_PROFILE
const evidence = process.env.CANOE_HARNESS_EVIDENCE
if (!profilePath || !evidence) throw new Error("Run through the leased webuix profile's provision hook")
const state = process.env.CANOE_E2E_STATE ?? join(process.env.HOME!, ".local/share/canoe-e2e")
const lease = JSON.parse(readFileSync(join(state, "android/operation.lock"), "utf8"))
if (lease.pid !== process.ppid) throw new Error("WebUI X provisioning requires its parent harness controller's Android lease")
const profile = loadProfile(profilePath)
if (profile.control.kind !== "adb" || profile.platform !== "android") throw new Error("Android profile required")
if (profile.application?.webuiPackage !== release.package || profile.application.webuiVersionCode !== release.versionCode) throw new Error("Profile does not select the pinned official WebUI X host")
const adb = androidControl(profile.control.serial, join(evidence, "webuix-provision.log"))
await adb.adb(["connect", profile.control.serial])
const device = await adb.shell("getprop ro.product.device")
if (!/^vsoc_[a-zA-Z0-9_]+$/.test(device) || (profile.control.expectedDevice && profile.control.expectedDevice !== device)) throw new Error(`Unexpected virtual Android target: ${device}`)
if (await adb.shell("getprop sys.boot_completed") !== "1") throw new Error("Guest must already be booted")
if (!(await adb.root("id -u")).split("\n").includes("0")) throw new Error("Guest must already be rooted")
const directory = join(state, "android")
mkdirSync(directory, { recursive: true })
const path = join(directory, "WebUI-X-v438-release-official.apk")
if (!(await Bun.file(path).exists())) {
  const response = await fetch(release.url)
  if (!response.ok) throw new Error(`APK download failed: ${response.status}`)
  await Bun.write(path, response)
}
const digest = createHash("sha256").update(new Uint8Array(await Bun.file(path).arrayBuffer())).digest("hex")
if (digest !== release.sha256) throw new Error(`Pinned APK digest mismatch: ${digest}`)
await adb.adb(["install", "-r", path], 120_000)
const info = await adb.shell(`dumpsys package ${release.package}`)
if (info.match(/\bversionCode=(\d+)\b/)?.[1] !== String(release.versionCode)) throw new Error("Installed WebUI X version differs from release")
await Bun.write(join(evidence, "webuix-release.json"), JSON.stringify({ ...release, apk: path, device }, null, 2) + "\n")
console.log(`Installed official WebUI X ${release.tag}. Use its UI to select the existing root platform and enable Developer Mode for CDP; attach never changes those preferences.`)
