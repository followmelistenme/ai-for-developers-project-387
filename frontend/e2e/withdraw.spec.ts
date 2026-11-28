import { expect, test } from "./fixtures"

test("владелец окончательно снимает публикацию, старые ссылки закрыты и новый одноимённый тип независим", async ({ page, request }, testInfo) => {
  const created = await request.post("/api/owner/meeting-types", { data: { name: "Знакомство", durationMinutes: 45 } })
  const type = await created.json() as { id: string }
  await request.post(`/api/owner/meeting-types/${type.id}/publish`)
  await page.goto("/owner")
  const card = page.getByRole("article", { name: "Знакомство", exact: true })
  await expect(card.getByText(/Снятие публикации окончательно/)).toBeVisible()
  await page.route("**/withdraw", (route) => route.abort(), { times: 1 })
  await card.getByRole("button", { name: "Снять публикацию", exact: true }).click()
  await expect(card.getByRole("alert")).toContainText("Не удалось снять публикацию")
  await expect(card.getByText("Опубликован", { exact: true })).toBeVisible()
  await card.getByRole("button", { name: "Снять публикацию", exact: true }).click()
  await expect(card.getByText("Снят с публикации", { exact: true })).toBeVisible()
  await expect(card.getByRole("button", { name: /Опубликовать|Снять публикацию/ })).toHaveCount(0)
  await page.reload()
  await expect(card.getByText("Снят с публикации", { exact: true })).toBeVisible()
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await expect.poll(() => page.locator("html").evaluate((el: { scrollWidth: number }) => el.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: testInfo.outputPath(`withdraw-owner-${width}.png`), fullPage: true })
  }
  await page.goto("/booking")
  await expect(page.getByRole("article")).toHaveCount(0)
  const replacement = await request.post("/api/owner/meeting-types", { data: { name: "Знакомство", durationMinutes: 30 } })
  const other = await replacement.json() as { id: string }
  expect(other.id).not.toBe(type.id)
  await request.post(`/api/owner/meeting-types/${other.id}/publish`)
  await page.reload()
  await expect(page.getByRole("link", { name: /Подробнее/ })).toHaveAttribute("href", `/booking/${other.id}`)
  await page.goto(`/booking/${type.id}`)
  await expect(page.getByRole("heading", { name: "Запись на этот тип встречи закрыта", exact: true })).toBeVisible()
  await expect(page.getByRole("group", { name: "Свободные слоты по Москве" })).toHaveCount(0)
  await expect(page.getByRole("button", { name: /Подтвердить|Повторить/ })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole("heading", { name: "Запись на этот тип встречи закрыта", exact: true })).toBeVisible()
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await expect.poll(() => page.locator("html").evaluate((el: { scrollWidth: number }) => el.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: testInfo.outputPath(`withdraw-guest-${width}.png`), fullPage: true })
  }
})

for (const action of ["confirm", "refresh"] as const) {
  test(`старый выбранный интервал закрывается при ${action} без новой встречи и сохраняет общую занятость`, async ({ page, request }, testInfo) => {
    const type = await (await request.post("/api/owner/meeting-types", { data: { name: "Закрываемый тип", durationMinutes: 45 } })).json() as { id: string }
    const other = await (await request.post("/api/owner/meeting-types", { data: { name: "Другой тип", durationMinutes: 15 } })).json() as { id: string }
    for (const item of [type, other]) await request.post(`/api/owner/meeting-types/${item.id}/publish`)
    const availability = await (await request.get(`/api/meeting-types/${type.id}/slots`)).json() as { slots: { start: string }[] }
    const saved = await request.post(`/api/meeting-types/${type.id}/meetings`, { data: { attemptId: crypto.randomUUID(), start: availability.slots[0].start, guestName: "Анна", guestEmail: "anna@example.com" } })
    expect(saved.status()).toBe(201)
    const meeting = await saved.json() as { id: string, callUrl: string }
    await page.goto(`/booking/${type.id}`)
    await page.getByRole("button", { name: "10:00–10:45", exact: true }).click()
    await page.getByLabel("Ваше имя", { exact: true }).fill("Борис")
    await page.getByLabel("Email", { exact: true }).fill("boris@example.com")
    expect((await request.post(`/api/owner/meeting-types/${type.id}/withdraw`)).status()).toBe(200)
    await page.getByRole("button", { name: action === "confirm" ? "Подтвердить запись" : "Обновить слоты", exact: true }).click()
    await expect(page.getByRole("alert")).toHaveText("Запись на этот тип встречи закрыта")
    await expect(page.getByRole("group", { name: "Свободные слоты по Москве" })).toHaveCount(0)
    await expect(page.getByLabel("Дата встречи по Москве")).toHaveCount(0)
    await expect(page.getByRole("form", { name: "Подтвердите запись" })).toHaveCount(0)
    await expect(page.getByRole("button", { name: /Подтвердить|Повторить|Обновить слоты/ })).toHaveCount(0)
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await expect.poll(() => page.locator("html").evaluate((el: { scrollWidth: number }) => el.scrollWidth)).toBeLessThanOrEqual(width)
      await page.screenshot({ path: testInfo.outputPath(`withdraw-stale-${action}-${width}.png`), fullPage: true })
    }
    const meetings = await (await request.get("/api/owner/meetings")).json() as { id: string }[]
    expect(meetings.map((item) => item.id)).toEqual([meeting.id])
    await page.goto(`/booking/${other.id}`)
    await expect(page.getByRole("button", { name: "09:00–09:15", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "09:30–09:45", exact: true })).toHaveCount(0)
    await expect(page.getByRole("button", { name: "10:00–10:15", exact: true })).toBeVisible()
    await page.goto("/owner")
    const list = page.getByRole("region", { name: "Предстоящие встречи" })
    await expect(list.getByRole("article")).toHaveCount(1)
    await expect(list).toContainText("Анна")
    await expect(list).toContainText("anna@example.com")
    await expect(list.getByRole("link", { name: "Ссылка для звонка", exact: true })).toHaveAttribute("href", meeting.callUrl)
  })
}

for (const delivery of ["held", "lost", "undelivered"] as const) {
  test(`закрытие записи сохраняет ${delivery} попытку до определённого ответа`, async ({ page, request, apiURL }) => {
    const type = await (await request.post("/api/owner/meeting-types", { data: { name: "Повтор после закрытия", durationMinutes: 30 } })).json() as { id: string }
    await request.post(`/api/owner/meeting-types/${type.id}/publish`)
    await page.goto(`/booking/${type.id}`)
    await page.getByRole("button", { name: "09:00–09:30", exact: true }).click()
    await page.getByLabel("Ваше имя", { exact: true }).fill("Ева")
    await page.getByLabel("Email", { exact: true }).fill("eva@example.com")
    const bodies: string[] = []
    let saved: () => void = () => undefined
    const accepted = new Promise<void>((resolve) => { saved = resolve })
    let release: () => void = () => undefined
    const held = new Promise<void>((resolve) => { release = resolve })
    let releaseSlots: () => void = () => undefined
    const heldSlots = new Promise<void>((resolve) => { releaseSlots = resolve })
    let slotsRead: () => void = () => undefined
    const slotsReady = new Promise<void>((resolve) => { slotsRead = resolve })
    await page.route("**/slots*", async (route) => {
      await heldSlots
      const response = await route.fetch({ url: `${apiURL}${new URL(route.request().url()).pathname}` })
      expect(response.status()).toBe(410)
      await route.fulfill({ response })
      slotsRead()
    })
    await page.route("**/meetings", async (route) => {
      bodies.push(route.request().postData() ?? "")
      const response = delivery === "undelivered" && bodies.length === 1 ? undefined : await route.fetch({ url: `${apiURL}${new URL(route.request().url()).pathname}` })
      if (bodies.length === 1) {
        saved()
        await held
        if (delivery !== "held") { await route.abort(); return }
      }
      if (!response) throw new Error("Missing actual confirmation response")
      await route.fulfill({ response })
    })
    try {
      // Start an availability refresh immediately before sending the already selected form.
      // Its late 410 is unrelated to the result of this attempt.
      await page.evaluate("const form = document.querySelector('form'); window.dispatchEvent(new Event('focus')); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))")
      await accepted
      const meetings = await (await request.get("/api/owner/meetings")).json() as { id: string, callUrl: string }[]
      expect(meetings).toHaveLength(delivery === "undelivered" ? 0 : 1)
      await request.post(`/api/owner/meeting-types/${type.id}/withdraw`)
      releaseSlots()
      await slotsReady
      await expect(page.getByRole("alert")).toHaveCount(0)
      release()
      if (delivery !== "held") {
        await expect(page.getByRole("alert")).toContainText("Результат подтверждения неизвестен")
        await page.evaluate("window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))")
        await expect(page.getByRole("button", { name: "Повторить подтверждение", exact: true })).toBeEnabled()
        await page.getByRole("button", { name: "Повторить подтверждение", exact: true }).click()
        expect(bodies).toHaveLength(2)
        expect(bodies[1]).toBe(bodies[0])
      }
      if (delivery === "undelivered") {
        await expect(page.getByRole("alert")).toHaveText("Запись на этот тип встречи закрыта")
        await expect(page.getByRole("button", { name: /Подтвердить|Повторить|Обновить слоты/ })).toHaveCount(0)
        expect(await (await request.get("/api/owner/meetings")).json()).toEqual([])
      } else {
        await expect(page.getByRole("heading", { name: "Вы записаны на звонок" })).toBeVisible()
        await expect(page.getByLabel("Ссылка для звонка", { exact: true })).toHaveValue(meetings[0].callUrl)
        await page.evaluate("window.dispatchEvent(new Event('focus')); document.dispatchEvent(new Event('visibilitychange'))")
        await expect(page.getByRole("heading", { name: "Вы записаны на звонок" })).toBeVisible()
        expect((await (await request.get("/api/owner/meetings")).json() as { id: string }[]).map((item) => item.id)).toEqual([meetings[0].id])
      }
    } finally { release(); releaseSlots() }
  })
}
