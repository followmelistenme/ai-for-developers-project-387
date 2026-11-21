import { expect, test } from "./fixtures"

test("обе кнопки ведут в каталог с возвратом на главную", async ({ page }) => {
  await page.goto("/")

  const bookingLinks = page.getByRole("link", {
    name: "Перейти к записи",
    exact: true,
  })
  await expect(bookingLinks).toHaveCount(2)

  for (let index = 0; index < 2; index += 1) {
    await bookingLinks.nth(index).click()
    await expect(page).toHaveURL(/\/booking$/)
    await page.reload()
    await expect(
      page.getByRole("heading", { name: "Выберите тип встречи", level: 1, exact: true }),
    ).toBeVisible()
    await expect(page.getByText("Пока нет опубликованных типов встреч", { exact: true })).toBeVisible()

    await page.getByRole("link", { name: "На главную", exact: true }).click()
    await expect(page).toHaveURL("/")
  }
})

for (const width of [320, 390]) {
  test(`на телефоне шириной ${width}px запись доступна без горизонтальной прокрутки`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.goto("/")

    await expect(
      page.getByRole("link", { name: "Как это работает", exact: true }),
    ).toBeHidden()

    const bookingLinks = page.getByRole("link", { name: "Перейти к записи", exact: true })
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

test("ссылка в шапке приводит к трём шагам записи", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("link", { name: "Как это работает", exact: true }).click()

  await expect(page).toHaveURL(/\/#how-it-works$/)
  await expect(
    page.getByRole("heading", { name: "Как это работает", exact: true }),
  ).toBeInViewport()
  for (const name of ["Выберите тип встречи", "Найдите удобное время", "Подтвердите запись"]) {
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
  }
})
