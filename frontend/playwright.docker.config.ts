import { defineConfig, devices } from "@playwright/test"

export default defineConfig({
  testDir: "./e2e/docker",
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: process.env.DOCKER_BASE_URL ?? "http://127.0.0.1:15173",
    timezoneId: "America/Los_Angeles",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
})
