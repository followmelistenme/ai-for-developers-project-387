import { expect, test } from "@playwright/test"

test("приложение запускается без ошибок JavaScript", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))

  const response = await page.goto("/")

  expect(response?.ok()).toBe(true)
  await expect(
    page.getByRole("heading", {
      name: "Запись на звонок без лишней переписки",
      level: 1,
      exact: true,
    }),
  ).toBeVisible()
  expect(errors).toEqual([])
})
