import { expect, test } from "./fixtures"

test("гость выбирает дату и интервал по Москве без резервирования", async ({ page, request }) => {
  const created = await request.post("/api/owner/meeting-types", { data: { name: "Обсудим проект", durationMinutes: 45 } })
  const type = await created.json() as { id: string }
  await request.post(`/api/owner/meeting-types/${type.id}/publish`)
  const response = await request.get(`/api/meeting-types/${type.id}/slots`)
  const available = await response.json() as { windowStart: string, windowEnd: string }
  await page.goto(`/booking/${type.id}`)
  await expect(page.getByLabel("Дата встречи по Москве")).toHaveValue(available.windowStart)
  await page.getByRole("button", { name: "09:00–09:45", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("Выбран интервал")
  await expect(page.getByRole("status")).toContainText("09:00–09:45")
  await page.getByLabel("Дата встречи по Москве").fill(available.windowEnd)
  await expect(page.getByText("Выбран интервал", { exact: false })).toHaveCount(0)
  await page.getByRole("button", { name: "17:00–17:45", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("17:00–17:45")
  await expect(page.getByRole("button", { name: "Подтвердить запись", exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByLabel("Дата встречи по Москве")).toHaveValue(available.windowStart)
  await expect(page.getByText("Выбран интервал", { exact: false })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "09:00–09:45", exact: true })).toHaveAttribute("aria-pressed", "false")
})

test("слоты показывают загрузку, сетевую ошибку, повтор и пустую дату", async ({ page, request }) => {
  const created = await request.post("/api/owner/meeting-types", { data: { name: "Состояния слотов", durationMinutes: 30 } })
  const type = await created.json() as { id: string }
  await request.post(`/api/owner/meeting-types/${type.id}/publish`)
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route("**/slots*", async (route) => { await held; await route.abort() }, { times: 1 })
  await page.goto(`/booking/${type.id}`)
  await expect(page.getByRole("status")).toHaveText("Загружаем свободные слоты…")
  release()
  await expect(page.getByRole("alert")).toContainText("Не удалось загрузить свободные слоты")
  await page.getByRole("button", { name: "Попробовать ещё раз", exact: true }).click()
  await page.getByRole("button", { name: "09:00–09:30", exact: true }).click()
  const available = await (await request.get(`/api/meeting-types/${type.id}/slots`)).json() as Record<string, unknown>
  await page.route("**/slots*", (route) => route.fulfill({ json: { ...available, slots: [] } }), { times: 1 })
  await page.getByRole("button", { name: "Обновить слоты", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("На эту дату нет свободных слотов")
  await expect(page.getByText("Выбран интервал", { exact: false })).toHaveCount(0)
  await page.getByRole("button", { name: "Обновить слоты", exact: true }).click()
  await expect(page.getByRole("button", { name: "09:00–09:30", exact: true })).toHaveAttribute("aria-pressed", "false")
})

test("ошибка загрузки выбранной даты сохраняет её для повторной попытки", async ({ page, request }) => {
  const created = await request.post("/api/owner/meeting-types", { data: { name: "Повтор выбранной даты", durationMinutes: 30 } })
  const type = await created.json() as { id: string }
  await request.post(`/api/owner/meeting-types/${type.id}/publish`)
  const available = await (await request.get(`/api/meeting-types/${type.id}/slots`)).json() as { windowEnd: string }
  await page.goto(`/booking/${type.id}`)
  await page.getByRole("button", { name: "09:00–09:30", exact: true }).click()
  await page.route(`**/slots?date=${available.windowEnd}`, (route) => route.abort(), { times: 1 })
  await page.getByLabel("Дата встречи по Москве").fill(available.windowEnd)
  await expect(page.getByRole("alert")).toContainText("Не удалось загрузить свободные слоты")
  await expect(page.getByText("Выбран интервал", { exact: false })).toHaveCount(0)
  await expect.soft(page.getByLabel("Дата встречи по Москве")).toHaveValue(available.windowEnd)
  await page.getByRole("button", { name: "Попробовать ещё раз", exact: true }).click()
  await page.getByRole("button", { name: "09:00–09:30", exact: true }).click()
  const [year, month, day] = available.windowEnd.split("-")
  await expect(page.getByRole("status")).toContainText(`${day}.${month}.${year}, 09:00–09:30 по Москве`)
  await expect(page.getByLabel("Дата встречи по Москве")).toHaveValue(available.windowEnd)
})

test("возврат фокуса во время загрузки сохраняет выбранную дату", async ({ page, request }) => {
  const created = await request.post("/api/owner/meeting-types", { data: { name: "Фокус при смене даты", durationMinutes: 30 } })
  const type = await created.json() as { id: string }
  await request.post(`/api/owner/meeting-types/${type.id}/publish`)
  const available = await (await request.get(`/api/meeting-types/${type.id}/slots`)).json() as { windowEnd: string }
  await page.goto(`/booking/${type.id}`)
  await page.getByRole("button", { name: "09:00–09:30", exact: true }).click()
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => { release = resolve })
  let intercepted: () => void = () => undefined
  const pending = new Promise<void>((resolve) => { intercepted = resolve })
  await page.route(`**/slots?date=${available.windowEnd}`, async (route) => {
    const response = await route.fetch()
    intercepted()
    await held
    await route.fulfill({ response })
  }, { times: 1 })
  try {
    await page.getByLabel("Дата встречи по Москве").fill(available.windowEnd)
    await pending
    await expect(page.getByRole("status")).toHaveText("Загружаем свободные слоты…")
    await expect(page.getByText("Выбран интервал", { exact: false })).toHaveCount(0)
    await page.evaluate("window.dispatchEvent(new Event('focus'))")
    await page.getByRole("button", { name: "09:00–09:30", exact: true }).click()
    release()
    await expect(page.getByLabel("Дата встречи по Москве")).toHaveValue(available.windowEnd)
    const [year, month, day] = available.windowEnd.split("-")
    await expect(page.getByRole("status")).toContainText(`${day}.${month}.${year}, 09:00–09:30 по Москве`)
  } finally { release() }
})

test("быстрая смена дат игнорирует старый ответ и повторный вход сбрасывает выбор", async ({ page, request }) => {
  const created = await request.post("/api/owner/meeting-types", { data: { name: "Смена дат", durationMinutes: 15 } })
  const type = await created.json() as { id: string }
  await request.post(`/api/owner/meeting-types/${type.id}/publish`)
  const available = await (await request.get(`/api/meeting-types/${type.id}/slots`)).json() as { windowStart: string, windowEnd: string }
  await page.goto(`/booking/${type.id}`)
  await page.getByRole("button", { name: "09:00–09:15", exact: true }).click()
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route(`**/slots?date=${available.windowEnd}`, async (route) => {
    const response = await route.fetch()
    await held
    await route.fulfill({ response })
  }, { times: 1 })
  await page.getByLabel("Дата встречи по Москве").fill(available.windowEnd)
  await expect(page.getByRole("status")).toHaveText("Загружаем свободные слоты…")
  await page.getByLabel("Дата встречи по Москве").fill(available.windowStart)
  await page.getByRole("button", { name: "09:00–09:15", exact: true }).click()
  release()
  await expect(page.getByLabel("Дата встречи по Москве")).toHaveValue(available.windowStart)
  await expect(page.getByRole("status")).toContainText("09:00–09:15")
  await page.getByRole("link", { name: "Все типы встреч", exact: true }).click()
  await page.getByRole("link", { name: "Подробнее" }).click()
  await expect(page.getByRole("button", { name: "09:00–09:15", exact: true })).toHaveAttribute("aria-pressed", "false")
})

test("отображение по Москве одинаково в разных часовых поясах браузера", async ({ browser, request, apiURL }) => {
  const created = await request.post("/api/owner/meeting-types", { data: { name: "Московское время", durationMinutes: 60 } })
  const type = await created.json() as { id: string }
  await request.post(`/api/owner/meeting-types/${type.id}/publish`)
  for (const timezoneId of ["America/Los_Angeles", "Asia/Tokyo"]) {
    const context = await browser.newContext({ timezoneId, baseURL: "http://127.0.0.1:4173" })
    try {
      await context.route("**/api/**", async (route) => {
        const original = new URL(route.request().url())
        const response = await route.fetch({ url: `${apiURL}${original.pathname}${original.search}` })
        await route.fulfill({ response })
      })
      const page = await context.newPage()
      await page.goto(`/booking/${type.id}`)
      await page.getByRole("button", { name: "09:00–10:00", exact: true }).click()
      await expect(page.getByRole("status")).toContainText("09:00–10:00 по Москве")
    } finally { await context.close() }
  }
})

test("московская полночь обновляет окно и очищает выбранный интервал", async ({ page, request }) => {
  const created = await request.post("/api/owner/meeting-types", { data: { name: "Сдвиг окна", durationMinutes: 30 } })
  const type = await created.json() as { id: string }
  await request.post(`/api/owner/meeting-types/${type.id}/publish`)
  await page.clock.install({ time: new Date("2020-01-01T00:00:00Z") })
  const before = {
    serverTime: "2026-12-31T23:59:59+03:00", nextWindowUpdate: "2027-01-01T00:00:00+03:00", timeZone: "Europe/Moscow",
    windowStart: "2027-01-01", windowEnd: "2027-01-14", selectedDate: "2027-01-01",
    slots: [{ start: "2027-01-01T09:00:00+03:00", end: "2027-01-01T09:30:00+03:00" }],
  }
  const after = {
    ...before, serverTime: "2027-01-01T00:00:00+03:00", nextWindowUpdate: "2027-01-02T00:00:00+03:00",
    windowStart: "2027-01-02", windowEnd: "2027-01-15", selectedDate: "2027-01-02",
    slots: [{ start: "2027-01-02T09:00:00+03:00", end: "2027-01-02T09:30:00+03:00" }],
  }
  await page.route("**/slots*", (route) => route.fulfill({ json: after }))
  await page.route("**/slots*", (route) => route.fulfill({ json: before }), { times: 1 })
  await page.goto(`/booking/${type.id}`)
  await page.getByRole("button", { name: "09:00–09:30", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("01.01.2027")
  await page.clock.fastForward(1200)
  await expect(page.getByLabel("Дата встречи по Москве")).toHaveValue("2027-01-02")
  await expect(page.getByLabel("Дата встречи по Москве")).toHaveAttribute("max", "2027-01-15")
  await expect(page.getByRole("button", { name: "09:00–09:30", exact: true })).toHaveAttribute("aria-pressed", "false")
  await expect(page.getByText("Выбран интервал", { exact: false })).toHaveCount(0)
})

test("возврат фокуса очищает выбор и обновляет дату, вышедшую из окна", async ({ page, request }) => {
  const created = await request.post("/api/owner/meeting-types", { data: { name: "Возврат к выбору", durationMinutes: 30 } })
  const type = await created.json() as { id: string }
  await request.post(`/api/owner/meeting-types/${type.id}/publish`)
  const available = await (await request.get(`/api/meeting-types/${type.id}/slots`)).json() as { windowStart: string, windowEnd: string }
  await page.goto(`/booking/${type.id}`)
  await page.getByLabel("Дата встречи по Москве").fill(available.windowEnd)
  await page.getByRole("button", { name: "09:00–09:30", exact: true }).click()
  await page.route(`**/slots?date=${available.windowEnd}`, (route) => route.fulfill({ status: 400, json: { message: "Дата вне окна", fields: { date: "Выберите дату" } } }), { times: 1 })
  await page.evaluate("window.dispatchEvent(new Event('focus'))")
  await expect(page.getByLabel("Дата встречи по Москве")).toHaveValue(available.windowStart)
  await expect(page.getByRole("button", { name: "09:00–09:30", exact: true })).toHaveAttribute("aria-pressed", "false")
  const refreshed = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname.endsWith("/slots") && !url.searchParams.has("date") && response.ok()
  }, { timeout: 3000 })
  await page.getByRole("button", { name: "Обновить слоты", exact: true }).click()
  await refreshed
  await expect(page.getByLabel("Дата встречи по Москве")).toHaveValue(available.windowStart)
  await expect(page.getByRole("button", { name: "09:00–09:30", exact: true })).toHaveAttribute("aria-pressed", "false")
})
