import { spawn, type ChildProcess } from 'node:child_process'
import { closeSync, existsSync, openSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { connectCdp, type CdpConnection } from './cdp'

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// Google refuses sign-in inside embedded browsers, so accounts are signed in through the
// person's own Chrome (or Edge) in a profile that belongs to NAIS3 alone. Google also
// refuses a browser started for remote control ("this browser or app may not be secure"),
// so the window a person signs in on is an ordinary one; only after it closes does NAIS3
// reopen the same profile under DevTools to read the sessions.
export function browserCandidates(env: NodeJS.ProcessEnv = process.env): string[] {
  const roots = [env['PROGRAMFILES'], env['PROGRAMFILES(X86)'], env['LOCALAPPDATA']].filter(
    (root): root is string => !!root
  )
  return [
    ...roots.map((root) => join(root, 'Google', 'Chrome', 'Application', 'chrome.exe')),
    ...roots.map((root) => join(root, 'Microsoft', 'Edge', 'Application', 'msedge.exe'))
  ]
}

function findBrowser(): string {
  const executable = browserCandidates().find((path) => existsSync(path))
  if (!executable) throw new Error('BROWSER_NOT_FOUND')
  return executable
}

/**
 * Whether a browser is running on this profile. Chrome holds the profile's lockfile open
 * while it runs and removes it on exit, so this sees windows NAIS3 did not start itself.
 */
export function profileInUse(profileDir: string): boolean {
  try {
    closeSync(openSync(join(profileDir, 'lockfile'), 'r+'))
    return false
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES'
  }
}

/** Waits until no browser holds the profile, so the next start owns it. */
export async function profileReleased(profileDir: string, timeoutMs = 8_000): Promise<boolean> {
  const started = Date.now()
  while (profileInUse(profileDir)) {
    if (Date.now() - started > timeoutMs) return false
    await sleep(250)
  }
  return true
}

/**
 * Opens the sign-in page in an ordinary browser window: no DevTools port and nothing
 * attached, exactly what the person would get by starting the browser themselves. If a
 * window is already open on this profile, the page opens there as a new tab.
 */
export async function openSignInWindow(profileDir: string, url: string): Promise<void> {
  const executable = findBrowser()
  await mkdir(profileDir, { recursive: true })
  const child = spawn(
    executable,
    ['--user-data-dir=' + profileDir, '--no-first-run', '--no-default-browser-check', url],
    { stdio: 'ignore', windowsHide: false, detached: true }
  )
  child.once('error', () => undefined)
  child.unref()
  const started = Date.now()
  while (Date.now() - started < 15_000) {
    if (profileInUse(profileDir)) return
    if (child.exitCode !== null && child.exitCode !== 0) throw new Error('BROWSER_START_TIMEOUT')
    await sleep(200)
  }
  throw new Error('BROWSER_START_TIMEOUT')
}

export interface BrowserCookie {
  name: string
  value: string
  domain: string
  path: string
  expires: number
  secure: boolean
  httpOnly: boolean
  session?: boolean
  sameSite?: string
  partitionKey?: unknown
}

export interface CaptureTab {
  poll(): Promise<unknown[]>
  close(): Promise<void>
}

// Reads what the capture script queued, without enabling the page's Runtime domain.
const POLL =
  '(()=>{const q=globalThis.__moaCaptured;return JSON.stringify(Array.isArray(q)?q.splice(0):[])})()'

export class LoginBrowser {
  private constructor(
    private readonly child: ChildProcess,
    private readonly cdp: CdpConnection,
    readonly userAgent: string
  ) {}

  static async launch(profileDir: string): Promise<LoginBrowser> {
    const executable = findBrowser()
    await mkdir(profileDir, { recursive: true })
    // An ordinary window on this profile would swallow the launch; the caller checks first.
    if (profileInUse(profileDir)) throw new Error('BROWSER_ALREADY_OPEN')
    // Port 0 lets the browser pick a free port and report it in this file.
    const portFile = join(profileDir, 'DevToolsActivePort')
    await rm(portFile, { force: true })
    const child = spawn(
      executable,
      [
        '--user-data-dir=' + profileDir,
        '--remote-debugging-port=0',
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank'
      ],
      { stdio: 'ignore', windowsHide: false }
    )
    let exited = false
    child.once('exit', () => {
      exited = true
    })
    child.once('error', () => {
      exited = true
    })
    const started = Date.now()
    while (Date.now() - started < 20_000) {
      // A window already open on this profile absorbs the launch and exits it at once.
      if (exited) throw new Error('BROWSER_ALREADY_OPEN')
      try {
        const [port, path] = (await readFile(portFile, 'utf8')).split(/\r?\n/)
        if (/^\d+$/.test(port) && path?.startsWith('/devtools/browser/')) {
          const cdp = await connectCdp('ws://127.0.0.1:' + port + path)
          const version = await cdp.send<{ userAgent: string }>('Browser.getVersion')
          return new LoginBrowser(child, cdp, version.userAgent.replace('HeadlessChrome', 'Chrome'))
        }
      } catch {
        /* The port file is not written yet. */
      }
      await sleep(250)
    }
    child.kill()
    throw new Error('BROWSER_START_TIMEOUT')
  }

  get alive(): boolean {
    return this.child.exitCode === null && !this.cdp.closed
  }

  async cookies(): Promise<BrowserCookie[]> {
    return (await this.cdp.send<{ cookies: BrowserCookie[] }>('Storage.getCookies')).cookies
  }

  // Addresses of the open tabs, read from the browser itself without attaching to any page.
  async pageUrls(): Promise<string[]> {
    const { targetInfos } = await this.cdp.send<{ targetInfos: { type: string; url: string }[] }>(
      'Target.getTargets'
    )
    return targetInfos.filter((target) => target.type === 'page').map((target) => target.url)
  }

  // A plain tab: nothing is attached to it, so a sign-in page sees an ordinary browser.
  async openTab(url: string): Promise<void> {
    const { targetId } = await this.cdp.send<{ targetId: string }>('Target.createTarget', { url })
    await this.cdp.send('Target.activateTarget', { targetId }).catch(() => undefined)
  }

  async openCaptureTab(url: string, script: string): Promise<CaptureTab> {
    const { targetId } = await this.cdp.send<{ targetId: string }>('Target.createTarget', {
      url: 'about:blank',
      // Behind the tab the person is signing in on, so a check never steals the window.
      background: true
    })
    const { sessionId } = await this.cdp.send<{ sessionId: string }>('Target.attachToTarget', {
      targetId,
      flatten: true
    })
    await this.cdp.send('Page.enable', {}, sessionId)
    await this.cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: script }, sessionId)
    await this.cdp.send('Page.navigate', { url }, sessionId)
    return {
      poll: async () => {
        try {
          const result = await this.cdp.send<{ result: { value?: string } }>(
            'Runtime.evaluate',
            { expression: POLL, returnByValue: true },
            sessionId
          )
          const value = JSON.parse(result.result.value || '[]')
          return Array.isArray(value) ? value : []
        } catch {
          return []
        }
      },
      close: async () => {
        await this.cdp.send('Target.closeTarget', { targetId }).catch(() => undefined)
      }
    }
  }

  async close(): Promise<void> {
    await this.cdp.send('Browser.close').catch(() => undefined)
    this.cdp.close()
    const started = Date.now()
    while (this.child.exitCode === null && this.child.signalCode === null) {
      if (Date.now() - started > 5_000) {
        this.child.kill()
        break
      }
      await sleep(100)
    }
  }
}
