import { spawn } from "node:child_process"
import { once } from "node:events"
import { createServer } from "node:net"
import { test as base, expect } from "@playwright/test"

// Each browser scenario gets a real process with independent in-memory data.
export const test = base.extend<{ apiURL: string }>({
  apiURL: async ({ playwright }, use) => {
    const listener = createServer()
    listener.listen(0, "127.0.0.1")
    await once(listener, "listening")
    const address = listener.address()
    if (!address || typeof address === "string") throw new Error("No test API port")
    const port = address.port
    await new Promise<void>((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()))
    const child = spawn("go", ["run", "./cmd/server"], {
      cwd: "../backend",
      env: { ...process.env, BACKEND_HOST: "127.0.0.1", BACKEND_PORT: String(port), GIN_MODE: "release" },
      detached: true,
      stdio: "ignore",
    })
    const url = `http://127.0.0.1:${port}`
    const client = await playwright.request.newContext()
    try {
      await expect.poll(async () => {
        if (child.exitCode !== null) throw new Error("Test API exited before startup")
        try { return (await client.get(`${url}/api/owner/meeting-types`)).status() } catch { return 0 }
      }, { timeout: 30_000 }).toBe(200)
      await use(url)
    } finally {
      try {
        await client.dispose()
      } finally {
        if (child.pid && child.exitCode === null) process.kill(-child.pid, "SIGTERM")
      }
    }
  },
  page: async ({ page, apiURL }, use) => {
    await page.route("**/api/**", async (route) => {
      const original = new URL(route.request().url())
      const response = await route.fetch({ url: `${apiURL}${original.pathname}${original.search}` })
      await route.fulfill({ response })
    })
    await use(page)
  },
  request: async ({ playwright, apiURL }, use) => {
    const client = await playwright.request.newContext({ baseURL: apiURL })
    await use(client)
    await client.dispose()
  },
})
export { expect } from "@playwright/test"
