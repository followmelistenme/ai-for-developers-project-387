import { expect, test } from "./fixtures"

test("владелец удаляет тип в любом состоянии, старые ссылки не заменяются одноимённым типом", async ({ page, request }, testInfo) => {
  const ids: string[] = []
  for (const [name, state] of [["Черновик", "draft"], ["Опубликованный", "published"], ["Закрытый", "withdrawn"]]) {
    const type = await (await request.post("/api/owner/meeting-types", { data: { name, durationMinutes: 30 } })).json() as { id: string }
    ids.push(type.id)
    if (state !== "draft") await request.post(`/api/owner/meeting-types/${type.id}/publish`)
    if (state === "withdrawn") await request.post(`/api/owner/meeting-types/${type.id}/withdraw`)
  }
  await page.goto("/owner")
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await expect.poll(() => page.locator("html").evaluate((el: { scrollWidth: number }) => el.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: testInfo.outputPath(`delete-owner-${width}.png`), fullPage: true })
  }
  for (const name of ["Черновик", "Опубликованный", "Закрытый"]) {
    const card = page.getByRole("article", { name, exact: true })
    await expect(card.getByText("Удаление доступно, только если по типу нет встреч, включая прошедшие.")).toBeVisible()
    await card.getByRole("button", { name: "Удалить", exact: true }).click()
    await expect(card).toHaveCount(0)
  }
  await page.reload()
  await expect(page.getByRole("heading", { name: "Пока нет типов встреч", exact: true })).toBeVisible()
  const replacement = await (await request.post("/api/owner/meeting-types", { data: { name: "Опубликованный", durationMinutes: 30 } })).json() as { id: string }
  await request.post(`/api/owner/meeting-types/${replacement.id}/publish`)
  await page.goto("/booking")
  await expect(page.getByRole("link", { name: /Подробнее/ })).toHaveAttribute("href", `/booking/${replacement.id}`)
  for (const id of ids) {
    await page.goto(`/booking/${id}`)
    await expect(page.getByRole("heading", { name: "Тип встречи недоступен", exact: true })).toBeVisible()
    await expect(page.getByRole("button", { name: /Подтвердить|Повторить/ })).toHaveCount(0)
  }
})

for (const action of ["confirm", "refresh"] as const) {
  test(`удалённый тип закрывает старую форму при ${action}`, async ({ page, request }, testInfo) => {
    const type = await (await request.post("/api/owner/meeting-types", { data: { name: "Старая ссылка", durationMinutes: 30 } })).json() as { id: string }
    await request.post(`/api/owner/meeting-types/${type.id}/publish`)
    await page.goto(`/booking/${type.id}`)
    await page.getByRole("button", { name: "09:00–09:30", exact: true }).click()
    await page.getByLabel("Ваше имя", { exact: true }).fill("Анна")
    await page.getByLabel("Email", { exact: true }).fill("anna@example.com")
    expect((await request.delete(`/api/owner/meeting-types/${type.id}`)).status()).toBe(204)
    const other = await (await request.post("/api/owner/meeting-types", { data: { name: "Старая ссылка", durationMinutes: 30 } })).json() as { id: string }
    await request.post(`/api/owner/meeting-types/${other.id}/publish`)
    await page.getByRole("button", { name: action === "confirm" ? "Подтвердить запись" : "Обновить слоты", exact: true }).click()
    await expect(page.getByRole("alert")).toHaveText("Тип встречи больше недоступен. Выберите другой тип в каталоге.")
    await expect(page.getByLabel("Дата встречи по Москве")).toHaveCount(0)
    await expect(page.getByRole("button", { name: /Подтвердить|Повторить|Обновить слоты/ })).toHaveCount(0)
    await expect(page.getByRole("group", { name: "Свободные слоты по Москве" })).toHaveCount(0)
    expect(await (await request.get("/api/owner/meetings")).json()).toEqual([])
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await expect.poll(() => page.locator("html").evaluate((el: { scrollWidth: number }) => el.scrollWidth)).toBeLessThanOrEqual(width)
      await page.screenshot({ path: testInfo.outputPath(`delete-stale-${action}-${width}.png`), fullPage: true })
    }
  })
}

test("ошибка удаления допускает повтор, а наличие встречи сохраняет снятие публикации", async ({ page, request }, testInfo) => {
  const type = await (await request.post("/api/owner/meeting-types", { data: { name: "Сохранённая встреча", durationMinutes: 30 } })).json() as { id: string }
  await request.post(`/api/owner/meeting-types/${type.id}/publish`)
  const availability = await (await request.get(`/api/meeting-types/${type.id}/slots`)).json() as { slots: { start: string }[] }
  expect((await request.post(`/api/meeting-types/${type.id}/meetings`, { data: { attemptId: crypto.randomUUID(), start: availability.slots[0].start, guestName: "Анна", guestEmail: "anna@example.com" } })).status()).toBe(201)
  await page.goto("/owner")
  const card = page.getByRole("article", { name: "Сохранённая встреча", exact: true })
  await page.route(`**/api/owner/meeting-types/${type.id}`, (route) => route.abort(), { times: 1 })
  await card.getByRole("button", { name: "Удалить", exact: true }).click()
  await expect(card.getByRole("alert")).toContainText("Не удалось удалить тип встречи")
  await card.getByRole("button", { name: "Удалить", exact: true }).click()
  await expect(card.getByRole("alert")).toHaveText("Нельзя удалить тип встречи, по которому есть встречи")
  await expect(card.getByRole("button", { name: "Снять публикацию", exact: true })).toBeEnabled()
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await expect.poll(() => page.locator("html").evaluate((el: { scrollWidth: number }) => el.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: testInfo.outputPath(`delete-conflict-${width}.png`), fullPage: true })
  }
  await card.getByRole("button", { name: "Снять публикацию", exact: true }).click()
  await expect(card.getByText("Снят с публикации", { exact: true })).toBeVisible()
  await expect(page.getByRole("region", { name: "Предстоящие встречи" }).getByRole("article")).toHaveCount(1)
  await page.reload()
  await expect(card).toBeVisible()
})

test("повтор после потерянного удаления убирает карточку по 404, поздняя публикация её не возвращает", async ({ page, request, apiURL }) => {
  const type = await (await request.post("/api/owner/meeting-types", { data: { name: "Удаляемый черновик", durationMinutes: 30 } })).json() as { id: string }
  await page.goto("/owner")
  const card = page.getByRole("article", { name: "Удаляемый черновик", exact: true })
  let accepted: () => void = () => undefined
  const published = new Promise<void>((resolve) => { accepted = resolve })
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route("**/publish", async (route) => {
    const response = await route.fetch({ url: `${apiURL}/api/owner/meeting-types/${type.id}/publish` })
    expect(response.status()).toBe(200)
    accepted()
    await held
    await route.fulfill({ response })
  })
  await page.route(`**/api/owner/meeting-types/${type.id}`, async (route) => {
    const response = await route.fetch({ url: `${apiURL}/api/owner/meeting-types/${type.id}` })
    expect(response.status()).toBe(204)
    await route.abort()
  }, { times: 1 })
  try {
    await card.getByRole("button", { name: "Опубликовать", exact: true }).click()
    await published
    await card.getByRole("button", { name: "Удалить", exact: true }).click()
    await expect(card.getByRole("alert")).toContainText("Не удалось удалить тип встречи")
    await card.getByRole("button", { name: "Удалить", exact: true }).click()
    await expect(card).toHaveCount(0)
    const lateResponse = page.waitForResponse((response) => response.url().endsWith("/publish"))
    release()
    await (await lateResponse).finished()
    await page.evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))")
    await expect(page.getByRole("status")).toContainText("Тип встречи удалён")
    await expect(card).toHaveCount(0)
    await page.reload()
    await expect(card).toHaveCount(0)
  } finally { release() }
})

test("поздний 404 слотов сохраняет неизвестную недоставленную попытку до безопасного повтора", async ({ page, request, apiURL }) => {
  const type = await (await request.post("/api/owner/meeting-types", { data: { name: "Неизвестный результат", durationMinutes: 30 } })).json() as { id: string }
  await request.post(`/api/owner/meeting-types/${type.id}/publish`)
  await page.goto(`/booking/${type.id}`)
  await page.getByRole("button", { name: "09:00–09:30", exact: true }).click()
  await page.getByLabel("Ваше имя", { exact: true }).fill("Ева")
  await page.getByLabel("Email", { exact: true }).fill("eva@example.com")
  let attempted: () => void = () => undefined
  const sent = new Promise<void>((resolve) => { attempted = resolve })
  let release: () => void = () => undefined
  const held = new Promise<void>((resolve) => { release = resolve })
  let slotsRead: () => void = () => undefined
  const slotsReady = new Promise<void>((resolve) => { slotsRead = resolve })
  const bodies: string[] = []
  await page.route("**/slots*", async (route) => {
    await held
    const response = await route.fetch({ url: `${apiURL}/api/meeting-types/${type.id}/slots` })
    expect(response.status()).toBe(404)
    await route.fulfill({ response })
    slotsRead()
  })
  await page.route("**/meetings", async (route) => {
    bodies.push(route.request().postData() ?? "")
    if (bodies.length === 1) { attempted(); await held; await route.abort(); return }
    const response = await route.fetch({ url: `${apiURL}/api/meeting-types/${type.id}/meetings` })
    await route.fulfill({ response })
  })
  try {
    await page.evaluate("const form = document.querySelector('form'); window.dispatchEvent(new Event('focus')); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))")
    await sent
    expect((await request.delete(`/api/owner/meeting-types/${type.id}`)).status()).toBe(204)
    release()
    await slotsReady
    await expect(page.getByRole("alert")).toContainText("Результат подтверждения неизвестен")
    await expect(page.getByLabel("Дата встречи по Москве")).toBeDisabled()
    await page.evaluate("window.dispatchEvent(new Event('focus'))")
    await page.getByRole("button", { name: "Повторить подтверждение", exact: true }).click()
    expect(bodies).toHaveLength(2)
    expect(bodies[1]).toBe(bodies[0])
    await expect(page.getByRole("alert")).toHaveText("Тип встречи больше недоступен. Выберите другой тип в каталоге.")
    await expect(page.getByRole("button", { name: /Подтвердить|Повторить|Обновить слоты/ })).toHaveCount(0)
    expect(await (await request.get("/api/owner/meetings")).json()).toEqual([])
  } finally { release() }
})
