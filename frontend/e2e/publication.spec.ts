import { expect, test } from "./fixtures"

test("создание, публикация и выбор гостем сохраняют отдельную ссылку", async ({ page }) => {
  await page.goto("/owner")
  await page.getByRole("button", { name: "Создать тип встречи", exact: true }).click()
  await page.getByLabel("Название", { exact: true }).fill("Знакомство")
  await page.getByLabel("Описание", { exact: true }).fill("Обсудим <b>планы</b> и познакомимся.")
  await page.getByLabel("Длительность", { exact: true }).selectOption("45")
  await page.getByRole("button", { name: "Сохранить черновик", exact: true }).click()
  const type = page.getByRole("article", { name: "Знакомство", exact: true })
  await type.getByRole("button", { name: "Опубликовать", exact: true }).click()
  await expect(type.getByText("Опубликован", { exact: true })).toBeVisible()
  await expect(type.getByRole("button", { name: "Снять публикацию", exact: true })).toBeVisible()
  await page.reload()
  await expect(type.getByText("Опубликован", { exact: true })).toBeVisible()
  const link = await type.getByRole("link", { name: "Открыть страницу типа" }).getAttribute("href")
  expect(link).toMatch(/^\/booking\/[^/]+$/)
  await page.goto("/booking")
  const card = page.getByRole("article", { name: "Знакомство", exact: true })
  await expect(card.getByText("45 минут", { exact: true })).toBeVisible()
  await card.getByRole("link", { name: "Подробнее" }).click()
  await expect(page).toHaveURL(link ?? "")
  await page.reload()
  await expect(page.getByRole("heading", { name: "Знакомство", level: 1 })).toBeVisible()
  await expect(page.getByText("Обсудим <b>планы</b> и познакомимся.", { exact: true })).toBeVisible()
  await expect(page.getByRole("button", { name: /подтвердить|записаться/i })).toHaveCount(0)
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await expect.poll(() => page.locator("html").evaluate((element: { scrollWidth: number }) => element.scrollWidth)).toBeLessThanOrEqual(width)
    await page.getByRole("link", { name: "Все типы встреч", exact: true }).click()
    await expect(card).toBeVisible()
    await expect.poll(() => page.locator("html").evaluate((element: { scrollWidth: number }) => element.scrollWidth)).toBeLessThanOrEqual(width)
    await card.getByRole("link", { name: "Подробнее" }).click()
  }
})

test("одинаковые названия имеют разные ссылки, а черновик и неизвестный тип недоступны", async ({ page, request }) => {
  const published: { id: string; durationMinutes: number }[] = []
  for (const durationMinutes of [15, 60]) {
    const response = await request.post("/api/owner/meeting-types", { data: { name: "Одинаковое название", durationMinutes } })
    expect(response.status()).toBe(201)
    const { id } = await response.json() as { id: string }
    expect((await request.post(`/api/owner/meeting-types/${id}/publish`)).status()).toBe(200)
    published.push({ id, durationMinutes })
  }
  expect(published[0].id).not.toBe(published[1].id)
  const draftResponse = await request.post("/api/owner/meeting-types", { data: { name: "Скрытый черновик", durationMinutes: 30 } })
  expect(draftResponse.status()).toBe(201)
  const draft = await draftResponse.json() as { id: string }
  await page.goto("/booking")
  const links = page.getByRole("link", { name: /Подробнее/ })
  await expect(links).toHaveCount(published.length)
  await expect(page.getByRole("article", { name: "Скрытый черновик", exact: true })).toHaveCount(0)
  for (const [index, { id }] of published.entries()) {
    await expect(links.nth(index)).toHaveAttribute("href", `/booking/${id}`)
  }
  const heading = page.getByRole("heading", { name: "Одинаковое название", exact: true, level: 1 })
  for (const { id, durationMinutes } of published) {
    await page.goto(`/booking/${id}`)
    await expect(heading).toBeVisible()
    await page.reload()
    await expect(heading).toBeVisible()
    await expect(page.getByText(`${durationMinutes} минут`, { exact: true })).toBeVisible()
  }
  for (const id of [draft.id, "missing"]) {
    await page.goto(`/booking/${id}`)
    await expect(page.getByRole("heading", { name: "Тип встречи недоступен", level: 1 })).toBeVisible()
    await expect(page.getByText("Скрытый черновик", { exact: true })).toHaveCount(0)
    await page.getByRole("link", { name: "Все типы встреч", exact: true }).click()
    await expect(page.getByRole("heading", { name: "Выберите тип встречи", level: 1 })).toBeVisible()
  }
})

test("каталог и отдельный тип показывают загрузку и повторяют запрос после сбоя сети", async ({ page, request }) => {
  const response = await request.post("/api/owner/meeting-types", { data: { name: "Повтор загрузки", durationMinutes: 30 } })
  const type = await response.json() as { id: string }
  await request.post(`/api/owner/meeting-types/${type.id}/publish`)
  for (const [path, apiPath, loading] of [
    ["/booking", "/api/meeting-types", "Загружаем типы встреч…"],
    [`/booking/${type.id}`, `/api/meeting-types/${type.id}`, "Загружаем тип встречи…"],
  ]) {
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => { release = resolve })
    await page.route(`**${apiPath}`, async (route) => { await held; await route.abort() }, { times: 1 })
    await page.goto(path)
    await expect(page.getByRole("status")).toHaveText(loading)
    release()
    await expect(page.getByRole("alert")).toContainText("Не удалось загрузить")
    await page.getByRole("button", { name: "Попробовать ещё раз", exact: true }).click()
    await expect(page.getByRole("alert")).toHaveCount(0)
    await expect(page.getByRole("heading", { name: "Повтор загрузки", exact: true })).toBeVisible()
  }
})

test("публикацию можно повторить после сетевого сбоя без потери черновика", async ({ page, request }) => {
  await request.post("/api/owner/meeting-types", { data: { name: "Повтор публикации", durationMinutes: 30 } })
  await page.goto("/owner")
  const card = page.getByRole("article", { name: "Повтор публикации", exact: true })
  await page.route("**/publish", (route) => route.abort(), { times: 1 })
  await card.getByRole("button", { name: "Опубликовать", exact: true }).click()
  await expect(card.getByRole("alert")).toContainText("Не удалось опубликовать")
  await expect(card.getByText("Черновик", { exact: true })).toBeVisible()
  await card.getByRole("button", { name: "Опубликовать", exact: true }).click()
  await expect(card.getByText("Опубликован", { exact: true })).toBeVisible()
  await expect(card.getByRole("alert")).toHaveCount(0)
})

test("каталог с завершающим слешем загружается, вложенная ссылка недоступна", async ({ page }) => {
  await page.goto("/booking/")
  await expect(page.getByRole("heading", { name: "Выберите тип встречи", level: 1 })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Пока нет опубликованных типов встреч" })).toBeVisible()
  await page.goto("/booking/missing/extra")
  await expect(page.getByRole("heading", { name: "Тип встречи недоступен", level: 1 })).toBeVisible()
})
