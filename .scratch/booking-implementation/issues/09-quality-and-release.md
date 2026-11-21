# 09: Генерируемый SDK, итоговое ревью и выпуск

Status: ready-for-agent
State: closed

**Source:** запрос пользователя от 2026-11-16 по результатам проверки MVP,
пункты 9–16; [спецификация MVP](../../booking-mvp/spec.md).

**What to build:** завершить проверяемость реализации, хранить спецификацию
и тикеты в удалённом Git, генерировать используемый фронтендом SDK
из текущего OpenAPI, настроить проверки PR и release-please.
TypeSpec в этот срез не входит.

**Blocked by:** 08: [«Запуск в Docker»](08-run-in-docker.md).

- [x] AGENTS.md содержит пути контракта, серверных и клиентских результатов генерации, команды и запрет ручных изменений.
- [x] Фронтенд использует генерируемые SDK-функции; версии генераторов закреплены, проверка генерации входит в общий набор и CI.
- [x] Quality gates и Container acceptance настроены для PR; workflow Хекслета сохранён.
- [x] Спецификация, тикеты и правило ссылок на них закоммичены и доступны в удалённой ветке.
- [x] Вся интеграционная ветка прошла независимые Standards и Spec ревью; результат и исправления записаны.
- [x] Один существующий тест проходит, падает при временном нарушении правила и снова проходит после восстановления; результат записан ниже.
- [x] release-please настроен для main; документированы первый выпуск, права и условия создания release-PR.
- [x] `mise run check` проходит; результаты локальных и доступных удалённых проверок зафиксированы без подмены незапущенных проверок успехом.

## Comments

### 2026-11-16 — согласованный объём

Пользователь подтвердил переход с openapi-fetch на генерируемый SDK Hey API,
а также Quality gates, Container acceptance на pull_request и release-please
для main. Сохраняется OpenAPI-first источник: api/openapi.yaml.
Изменение клиентского генератора заменяет соответствующую часть ADR-0001.
Общее ревью охватывает реализацию с 7f1105a и текущий срез.
Проверка намеренного нарушения выполняется в отдельной временной копии,
без оставления нарушенного правила в рабочей ветке.

### 2026-11-16 — проверка теста временным нарушением правила

Проверен существующий HTTP-тест
`TestAllTypesShareHalfOpenIntervalsAndConflictIncludesFreshSelectedDate/partial_from_after`.
Первая встреча другого типа занимает 09:30–10:15 (45 минут),
вторая запрашивает 10:00–10:30 (30 минут); ожидается HTTP 409.
Время теста фиксировано, окно записи не зависит от даты запуска.

Команда из backend/:

```bash
mise exec -- go test -count=1 ./internal/server \
  -run '^TestAllTypesShareHalfOpenIntervalsAndConflictIncludesFreshSelectedDate/partial_from_after$' -v
```

| Состояние правила Meeting.Overlaps | Результат | Код выхода |
| --- | --- | --- |
| Исходное: `m.Start.Before(end) && start.Before(m.End)` | PASS | 0 |
| Временно нарушенное: `m.Start.Equal(start)` | FAIL: `meetings_test.go:263: partial from after: 201` вместо ожидаемого 409 | 1 |
| Исходное правило восстановлено | PASS | 0 |

Эксперимент выполнен в `/private/tmp/booking-overlap-audit-z8o_aleh/backend`:
отдельная копия сохраняет рабочую ветку и параллельные проверки неизменными.
Логи baseline.log, mutated.log, restored.log находятся в родительском каталоге.
После восстановления содержимое файла побайтно равно исходнику и файлу
рабочей ветки; SHA-256:
`be258f365e1a1138b2fccaf88911f51dc8de88b0b692d1ec2ca947687b34ee68`.
В коммит попадает только результат эксперимента, исходное правило сохранено.

### 2026-11-16 — SDK и локальная приёмка

Hey API 0.99.0 генерирует DTO, функции всех operationId и Fetch runtime;
все вызовы приложения переведены на SDK. openapi-fetch удалён.
Обработаны сетевые отказы без HTTP response: состояния неизвестного результата
и повтор исходной попытки сохранены. Форматирование результатов входит
в генерацию (Prettier 3.10.1), js-yaml закреплена на исправленной 4.3.2.
`npm audit` для api/ и frontend/: 0 уязвимостей.

Выполнены:

- `mise run api-check`: PASS, включая сравнение всего дерева SDK.
- `mise exec -- npm --prefix frontend test`: 41 passed (26.9s), настоящий Go API.
- `mise run docker-check`: 3 passed (13.9s), проект
  `booking-check-91874-1794813214`; собственные контейнеры, образы и сеть удалены.
- `mise exec -- jactionlint --strict-exit`: PASS после ограничения push веткой main.
- `mise exec -- agnix --strict .`: 0 errors, 0 warnings.
- `git diff --check`: PASS.

На этом этапе ESLint стороннего Fetch runtime ещё не проходил: было
запрошено решение человека для восьми правил только в generated/client/**
и generated/core/**. До ответа исключения не применялись; решение и итоговый
успешный прогон записаны ниже.

Release workflow закреплён SHA, работает только для main с ограниченными
job permissions и manifest/simple-стратегией. Создание release-PR требует
попадания конфигурации в main и разрешения Actions создавать PR; ограничения
GITHUB_TOKEN и опциональный RELEASE_PLEASE_TOKEN описаны в workflow README.

### 2026-11-16 — общее ревью

Выполнено общее независимое ревью всех срезов от 7f1105a, включая текущие
изменения SDK/CI/release. Standards: 0 оставшихся замечаний;
Spec: 0 существенных замечаний. Исправлена и перепроверена неточность README
о триггерах Quality. Полный отчёт: [review.md](../review.md).

### 2026-11-16 — одобренные исключения ESLint

Пользователь явно разрешил перечисленные восемь исключений только для
`frontend/src/api/generated/client/**` и `frontend/src/api/generated/core/**`.
Общая причина: неизменяемый сторонний Fetch runtime Hey API 0.99.0.
SDK-функции, DTO и прикладной код проверяются всеми прежними правилами.

| Правило @typescript-eslint | Путь (от frontend/) | Причина |
| --- | --- | --- |
| no-explicit-any | src/api/generated/{client,core}/** | Универсальные типы payload стороннего runtime |
| no-unsafe-return | src/api/generated/{client,core}/** | Возврат разобранных JSON-ответов в универсальном runtime |
| no-unsafe-assignment | src/api/generated/{client,core}/** | Присваивания после JSON-разбора в стороннем runtime |
| no-unsafe-argument | src/api/generated/{client,core}/** | Универсальные аргументы сериализатора путей |
| only-throw-error | src/api/generated/{client,core}/** | Runtime поддерживает неоднородные ошибки API |
| no-floating-promises | src/api/generated/{client,core}/** | Поставляемая генератором реализация SSE |
| no-unnecessary-type-assertion | src/api/generated/{client,core}/** | Универсальные assertions генератора |
| no-redundant-type-constituents | src/api/generated/{client,core}/** | Универсальные union-типы стороннего runtime |

Принудительный срок окончания всех исключений — 2026-12-16 00:00 UTC.
После него загрузка ESLint-конфигурации завершается ошибкой до нового решения
человека; срок не продлевается автоматически. Конфигурация остаётся проверяемой
и не исключает эти файлы целиком из ESLint.

### 2026-11-16 — финальные проверки

После одобрения исключений `mise run check` завершился с кодом 0:
41 браузерный сценарий (27.0s), Go `-race`, линтеры, форматирование,
генерация, модули, проверка достижимых уязвимостей, инструкции, workflow
и секреты. Лог: `/private/tmp/booking-quality-release-check.log`.
Принудительное истечение срока проверено загрузкой конфигурации при
2026-12-16 00:00 UTC: она завершается ожидаемой ошибкой. ESLint API
подтвердил 8 отключённых правил в runtime и 0 из них отключённых
в sdk.gen.ts, types.gen.ts и SlotPicker.tsx.

Оба независимых ревьюера повторно проверили финальные исключения:
Standards — 0 замечаний, Spec — 0 существенных замечаний.
Коммит и отправка в remote выполнены после этих проверок, результат ниже.

## Answer

Реализация, спецификация, все тикеты, AGENTS.md и отчёт общего ревью
опубликованы в `origin/codex/booking-draft-integration`:
коммит `6ad7c3b8357ae6de1dbf3173b181553d997cc17a`
(`feat: Generate SDK and automate release checks`). В теле коммита есть
ссылка `Ticket:` на этот файл. История не переписывалась, main не изменялся.
Посторонние пользовательские изменения GLOSSARY.md сохранены вне коммита.

Штатные pre-commit и pre-push проверки прошли без отключения хуков;
pre-push повторно выполнил `mise run check`: 41 passed (30.3s).
Удалённый [hexlet-check](https://github.com/followmelistenme/ai-for-developers-project-386/actions/runs/43825933828)
для коммита 6ad7c3b завершился успешно.

Quality gates и Container acceptance проверены локально; удалённо они
запускаются при открытии PR или push в main. PR не создан: GitHub API
учётные данные через настроенный helper недоступны, доступ к браузеру
не разрешён. Сравнение готовой ветки:
https://github.com/followmelistenme/ai-for-developers-project-386/compare/main...codex/booking-draft-integration

release-please готов для main; после слияния конфигурации туда и при
разрешении Actions создавать PR он создаст release-PR. Сам выпуск
и слияние в main в рамках этого среза не выполнялись.
