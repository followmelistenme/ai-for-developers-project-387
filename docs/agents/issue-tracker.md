# Issue tracker: Local Markdown

Задачи и спецификации хранятся в `.scratch/` репозитория
«Календарь звонков (продолжение)». [Трекер в GitHub](https://github.com/followmelistenme/ai-for-developers-project-387/tree/main/.scratch)

## Структура

- Одна директория на функциональность: `.scratch/<feature-slug>/`.
- Спецификация: `.scratch/<feature-slug>/spec.md`.
- Каждая задача — отдельный файл:
  `.scratch/<feature-slug>/issues/<NN>-<slug>.md`.
- Нумерация задач начинается с `01`.
- Имена директорий и файлов — в kebab-case.

Пример: `.scratch/booking/issues/01-prevent-overlaps.md`.

## Работа с задачами

- При указании «опубликовать в трекере» создайте локальный Markdown-файл.
- При указании «прочитать задачу» откройте переданный путь.
  Номер задачи разрешайте в пределах соответствующей функциональности.
- В начале задачи указывайте `Status:`; значения описаны
  в `docs/agents/triage-labels.md`.
- Обсуждение дописывайте в конец под заголовком `## Comments`.
- Сохраняйте историю обсуждения при обновлении задачи.
- Коммитьте спецификации, карты и тикеты вместе с реализацией и отправляйте
  в удалённую ветку. Пути из `Ticket:` должны существовать в её checkout.

## Wayfinder

Для wayfinder используется отдельный жизненный цикл задач.

- Карта: `.scratch/<effort>/map.md`; содержит Notes,
  Decisions-so-far и Fog.
- Дочерние задачи: `.scratch/<effort>/issues/NN-<slug>.md`.
- `Type:` — `research`, `prototype`, `grilling` или `task`.
- `Status:` — `open`, `claimed` или `resolved`.
- Зависимости: `Blocked by: NN, NN`.
  Задача разблокирована, когда все зависимости имеют статус `resolved`.
- Следующая задача — первая по номеру открытая, свободная
  и разблокированная задача.
- Перед началом работы сохраните `Status: claimed`.
- При завершении добавьте `## Answer`, установите `Status: resolved`
  и внесите краткий результат со ссылкой в Decisions-so-far карты.
