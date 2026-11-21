import { defineConfig, devices } from "@playwright/test"

const baseURL = "http://127.0.0.1:4173"

export default defineConfig({
  testDir: "./e2e",
  testIgnore: "**/docker/**",
  forbidOnly: Boolean(process.env.CI),
  workers: 1,
  retries: 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [{
    command: "go run ./cmd/server",
    cwd: "../backend",
    env: { BACKEND_HOST: "127.0.0.1", BACKEND_PORT: "8081", GIN_MODE: "release" },
    url: "http://127.0.0.1:8081/api/owner/meeting-types",
    reuseExistingServer: false,
    timeout: 120_000,
  }, {
    command:
      "npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort",
    url: baseURL,
    env: { API_TARGET: "http://127.0.0.1:8081" },
    reuseExistingServer: false,
    timeout: 120_000,
  }],
})
