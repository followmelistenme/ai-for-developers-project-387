# Triage Labels

В локальном трекере triage-роли записываются в поле `Status:`.

| Роль | Значение в трекере | Значение |
| --- | --- | --- |
| needs-triage | needs-triage | Требуется первичный разбор |
| needs-info | needs-info | Требуется дополнительная информация |
| ready-for-agent | ready-for-agent | Задача определена и готова для агента |
| ready-for-human | ready-for-human | Требуется реализация человеком |
| wontfix | wontfix | Задача не будет реализована |

Когда skill ссылается на triage-роль, используйте соответствующее
значение из таблицы. Например: `Status: ready-for-agent`.

Жизненный цикл задач wayfinder описан отдельно в `issue-tracker.md`.
