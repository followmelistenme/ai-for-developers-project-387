import { expect, test } from "./fixtures"

const stepNames = ["Выберите тип встречи", "Найдите удобное время", "Подтвердите запись"]

test("обе кнопки ведут в каталог с возвратом на главную", async ({ page }) => {
  await page.goto("/")

  const howLink = page.getByRole("link", { name: "Как это работает", exact: true, includeHidden: true })
  await expect(howLink).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Для владельца", exact: true })).toBeVisible()

  const bookingLinks = page.getByRole("link", {
    name: "Перейти к записи",
    exact: true,
  })
  await expect(bookingLinks).toHaveCount(2)

  for (let index = 0; index < 2; index += 1) {
    await bookingLinks.nth(index).click()
    await expect(page).toHaveURL(/\/booking$/)
    await expect(howLink).toHaveCount(0)
    await expect(page.getByRole("link", { name: "Перейти к записи", exact: true })).toHaveCount(0)
    await page.reload()
    await expect(
      page.getByRole("heading", { name: "Выберите тип встречи", level: 1, exact: true }),
    ).toBeVisible()
    await expect(page.getByText("Пока нет опубликованных типов встреч", { exact: true })).toBeVisible()

    await page.getByRole("link", { name: "На главную", exact: true }).click()
    await expect(page).toHaveURL("/")
  }

  await page.getByRole("link", { name: "Для владельца", exact: true }).click()
  await expect(page).toHaveURL(/\/owner$/)
  await expect(page.getByRole("heading", { name: "Типы встреч", level: 1, exact: true })).toBeVisible()
  await expect(howLink).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Перейти к записи", exact: true })).toHaveCount(0)
  await expect(page.getByRole("link", { name: "Для владельца", exact: true })).toHaveAttribute("aria-current", "page")
  await page.getByRole("link", { name: "Календарь звонков — главная", exact: true }).click()
  await expect(page).toHaveURL("/")
})

for (const width of [320, 390]) {
  test(`на телефоне шириной ${width}px запись доступна без горизонтальной прокрутки`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto("/")

    await expect(page.getByRole("link", { name: "Как это работает", exact: true, includeHidden: true })).toHaveCount(0)
    await expect(page.locator("#how-it-works")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Как это работает", exact: true })).toBeVisible()
    for (const name of stepNames) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
    }

    const boxes = await Promise.all(stepNames.map((name) => (
      page.getByRole("heading", { name, exact: true }).boundingBox()
    )))
    const positions = boxes.filter((box): box is NonNullable<(typeof boxes)[number]> => box !== null)
    expect(positions).toHaveLength(3)
    for (let index = 1; index < positions.length; index += 1) {
      expect(positions[index].y).toBeGreaterThan(positions[index - 1].y)
      expect(Math.abs(positions[index].x - positions[0].x)).toBeLessThan(2)
    }

    const bookingLinks = page.getByRole("link", { name: "Перейти к записи", exact: true })
    await expect(bookingLinks).toHaveCount(2)
    const contentWidth = () => page.locator("html").evaluate(
      (element: { scrollWidth: number }) => element.scrollWidth,
    )
    for (let index = 0; index < 2; index += 1) {
      await expect(bookingLinks.nth(index)).toBeInViewport()
      await expect.poll(contentWidth).toBeLessThanOrEqual(width)
      await bookingLinks.nth(index).click()
      await expect(page.getByText("Пока нет опубликованных типов встреч", { exact: true })).toBeVisible()
      await expect.poll(contentWidth).toBeLessThanOrEqual(width)
      await page.getByRole("link", { name: "На главную", exact: true }).click()
    }
  })
}

test("якорь раздела и три шага доступны без ссылки в шапке", async ({ page }) => {
  await page.goto("/")
  await page.evaluate("window.location.hash = '#how-it-works'")

  await expect(page.getByRole("link", { name: "Как это работает", exact: true, includeHidden: true })).toHaveCount(0)
  await expect(page).toHaveURL(/\/#how-it-works$/)
  await expect(page.locator("#how-it-works")).toBeVisible()
  await expect(page.getByRole("heading", { name: "Как это работает", exact: true })).toBeInViewport()
  await expect(page.getByText("Три простых шага. И время для разговора уже в ваших планах.", { exact: true })).toBeVisible()
  for (const name of stepNames) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
  }
})
