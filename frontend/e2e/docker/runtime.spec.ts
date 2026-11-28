import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { expect, test } from "@playwright/test"
import type { AvailableSlots, ConfirmMeeting } from "../../src/api/generated/types.gen"

function compose(args: string[], env = process.env) {
  const project = process.env.COMPOSE_PROJECT_NAME
  if (!project?.startsWith("booking-check-")) throw new Error("Run with mise run docker-check to isolate containers")
  execFileSync("docker", ["compose", "--project-name", project, "--file", fileURLToPath(new URL("../../../compose.yaml", import.meta.url)), ...args], { stdio: "inherit", timeout: 120_000, env })
}

test("контейнеры отдают интерфейс, API и документацию с одного адреса", async ({ page, request }) => {
  expect(await (await request.get("/api/owner/meeting-types")).json()).toEqual([])
  expect(await (await request.get("/api/owner/meetings")).json()).toEqual([])
  const schema = await request.get("/openapi.json")
  expect(schema.status()).toBe(200)
  expect(await schema.json()).toHaveProperty("openapi", expect.stringMatching(/^3\.0\.\d+$/))
  const yaml = await request.get("/openapi.yaml")
  expect(yaml.status()).toBe(200)
  expect(await yaml.text()).toContain("/api/owner/meetings:")
  await page.goto("/docs")
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  for (const path of ["/", "/owner", "/booking"]) {
    expect((await page.goto(path))?.status()).toBe(200)
    await page.reload()
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
  }
})

test("создание, публикация и запись по Москве работают в контейнерах, перезапуск очищает данные", async ({ page, request }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  const apiOrigins = new Set<string>()
  page.on("pageerror", (error) => errors.push(error.message))
  page.on("request", (outgoing) => {
    if (new URL(outgoing.url()).pathname.startsWith("/api/")) apiOrigins.add(new URL(outgoing.url()).origin)
  })
  await page.goto("/")
  await page.getByRole("link", { name: "Для владельца", exact: true }).click()
  await expect(page.getByRole("heading", { name: "Пока нет типов встреч" })).toBeVisible()
  await page.getByRole("button", { name: "Создать тип встречи", exact: true }).click()
  await page.getByLabel("Название", { exact: true }).fill("Контейнерный звонок")
  await page.getByLabel("Описание", { exact: true }).fill("Время календаря не зависит от окружения")
  await page.getByLabel("Длительность", { exact: true }).selectOption("30")
  await page.getByRole("button", { name: "Сохранить черновик", exact: true }).click()
  const type = page.getByRole("article", { name: "Контейнерный звонок", exact: true })
  await type.getByRole("button", { name: "Опубликовать", exact: true }).click()
  await expect(type.getByText("Опубликован", { exact: true })).toBeVisible()
  const link = await type.getByRole("link", { name: "Открыть страницу типа" }).getAttribute("href")
  expect(link).toMatch(/^\/booking\/[^/]+$/)
  const bookingPath = link as string
  const typeId = bookingPath.split("/").at(-1) as string
  const available = await (await request.get(`/api/meeting-types/${typeId}/slots`)).json() as AvailableSlots
  expect(available.timeZone).toBe("Europe/Moscow")
  // Derive the calendar date from the server instant in Moscow, not the browser's zone.
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Moscow", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(available.serverTime))
  const tomorrow = new Date(`${today}T00:00:00Z`)
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)
  expect(available.windowStart).toBe(tomorrow.toISOString().slice(0, 10))
  expect(available.slots[0]).toEqual({ start: `${available.windowStart}T09:00:00+03:00`, end: `${available.windowStart}T09:30:00+03:00` })
  expect(await (await request.get(`${process.env.DOCKER_BACKEND_URL}/api/owner/meeting-types`)).json()).toEqual(await (await request.get("/api/owner/meeting-types")).json())

  await page.goto("/")
  await page.getByRole("link", { name: "Перейти к записи", exact: true }).first().click()
  await page.reload()
  await page.getByRole("link", { name: "Подробнее о типе Контейнерный звонок" }).click()
  await expect(page).toHaveURL(bookingPath)
  await page.reload()
  await expect(page.getByLabel("Дата встречи по Москве")).toHaveValue(available.windowStart)
  await page.getByRole("button", { name: "09:00–09:30", exact: true }).click()
  await page.getByLabel("Ваше имя", { exact: true }).fill("Анна")
  await page.getByLabel("Email", { exact: true }).fill("anna@example.com")
  const submitted = page.waitForRequest((outgoing) => outgoing.method() === "POST" && outgoing.url().endsWith("/meetings"))
  await page.getByRole("button", { name: "Подтвердить запись", exact: true }).click()
  const attempt = (await submitted).postDataJSON() as ConfirmMeeting
  await expect(page.getByRole("heading", { name: "Вы записаны на звонок" })).toBeVisible()
  await expect(page.getByRole("region", { name: "Вы записаны на звонок" })).toContainText("09:00–09:30 по Москве")
  await expect(page.getByLabel("Ссылка для звонка", { exact: true })).toHaveValue(/^http:\/\/localhost\/event\/.+/)
  await page.goto("/owner")
  await page.reload()
  const meetings = page.getByRole("region", { name: "Предстоящие встречи" })
  await expect(meetings.getByRole("article")).toHaveCount(1)
  await expect(meetings).toContainText("Контейнерный звонок")
  await expect(meetings).toContainText("anna@example.com")
  await expect(meetings).toContainText("09:00–09:30 по Москве")
  expect(apiOrigins).toEqual(new Set([new URL(page.url()).origin]))

  compose(["restart", "backend"])
  await expect.poll(async () => {
    const response = await request.get("/api/owner/meeting-types")
    return response.ok() ? await response.json() as unknown : null
  }, { timeout: 30_000 }).toEqual([])
  await page.reload()
  await expect(page.getByRole("heading", { name: "Пока нет типов встреч" })).toBeVisible()
  await expect(meetings).toContainText("Пока нет предстоящих встреч")
  expect(await (await request.get("/api/owner/meetings")).json()).toEqual([])
  await page.goto(bookingPath)
  await expect(page.getByRole("heading", { name: "Тип встречи недоступен" })).toBeVisible()
  expect((await request.get(`/api/meeting-types/${typeId}/slots`)).status()).toBe(404)
  expect((await request.post(`/api/meeting-types/${typeId}/meetings`, { data: attempt })).status()).toBe(404)

  // Keep nginx running while the backend container is replaced.
  const replacement = await request.post("/api/owner/meeting-types", { data: { name: "До пересоздания", durationMinutes: 30 } })
  expect(replacement.status()).toBe(201)
  compose(["up", "-d", "--no-deps", "--force-recreate", "--wait", "backend"])
  await expect.poll(async () => {
    const response = await request.get("/api/owner/meeting-types")
    return response.ok() ? await response.json() as unknown : null
  }, { timeout: 30_000 }).toEqual([])
  await page.goto("/owner")
  await expect(page.getByRole("heading", { name: "Пока нет типов встреч" })).toBeVisible()
  expect(errors).toEqual([])
})

test("адрес API меняется при запуске без пересборки интерфейса", async ({ page, request, baseURL }) => {
  test.setTimeout(120_000)
  if (!baseURL) throw new Error("Container base URL is required")
  // Preserve the assigned host port while recreating nginx with a different origin.
  const env = { ...process.env, FRONTEND_PORT: new URL(baseURL).port }
  try {
    compose(["up", "-d", "--no-deps", "--force-recreate", "frontend"], { ...env, API_TARGET: "http://127.0.0.1:1" })
    await expect.poll(async () => (await request.get("/api/owner/meeting-types").catch(() => null))?.status(), { timeout: 30_000 }).toBe(502)
    await page.goto("/")
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible()
    for (const path of ["/docs", "/openapi.json", "/openapi.yaml"]) {
      expect((await request.get(path)).status()).toBe(502)
    }
  } finally {
    compose(["up", "-d", "--no-deps", "--force-recreate", "--wait", "frontend"], { ...env, API_TARGET: "http://calendar-api:8080" })
  }
  expect(await (await request.get("/api/owner/meeting-types")).json()).toEqual([])
  expect((await request.get("/openapi.json")).status()).toBe(200)
  await page.goto("/owner")
  await expect(page.getByRole("heading", { name: "Пока нет типов встреч" })).toBeVisible()
})
