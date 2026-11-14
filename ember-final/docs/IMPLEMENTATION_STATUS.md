# EMBER 2.0.1 — передача разработчику

Рабочая основа — `ember-final`; продуктовая концепция сохраняется. Текущая версия научного движка и корпуса: `2.0.1-scientific-fixes`. Ниже статус реализации, а не заявление о победе или независимой научной валидации.

## Что сделано в текущем этапе

| Область | Изменение | Чем подтверждено |
|---|---|---|
| Идентичность материалов | Polyethylene/ethylene и другие разные материалы больше не совпадают из-за подстроки; известные алиасы сохранены | Поведенческие regressions публичного parser/matcher |
| Неизвестные исходы | Неизвестные BASS/BASS-II records не создают reported ignition/burning; выведенное ignition помечается derived | Python reconstruction tests, включая 16 legacy unknown records |
| Протокол | Проверяются принадлежность событий тесту/сегменту, повторяющиеся ID, относительный порядок и известные времена; hot extinction отделён от cool continuation | Mutation-style TS regressions на реальных record structures |
| Защита выводов | Усилены проверки safety/certification guarantees, чисел с единицами, загрязнения между источниками и неподдержанного добавленного текста | Adversarial verifier regressions |
| OpenRouter | Реальные server-only adapters: `google/gemini-decision-1` и `google/gemini-embedding-2`; строгая проверка внешних ответов, явные ошибки | Mock tests и последующий живой smoke check; см. дополнение ниже |
| Embedding pipeline | Отдельная сборка artifact с chunk IDs, hashes, model/dim/format/corpus metadata и атомарной записью | Тесты валидации, порядка, concurrency, ошибок и замены файла |
| Provenance/runtime | Компоненты подключаются через async callbacks; API сохраняет различие deterministic/live и сообщает fallback | Интеграционные проверки и versioned snapshots |

Исходная база сохранена: 15 investigations, 1 678 records, 145 claims, 68 source records. Records включают агрегаты серий и реконструированные представления протоколов; это не столько же независимых запусков. Quote matching с cached text не доказывает научную корректность каждого claim.

У специальных инструментов `crapper`, `dryer`, `mutator` нет доступной установки в этой сессии. Их метрики не заявляются; использованы поведенческие tests и изолированные mutation probes. Точные команды/результаты отдельных изменений перечислены в [журналах protocol/data](./actions-protocol-data.md), [verifier](./actions-verifier.md), [OpenRouter](./actions-openrouter.md).

## Запуск разработчика

1. Установить Node dependencies и запустить `npm run dev`. Без ключа доступен deterministic review.
2. Настроить `OPENROUTER_API_KEY` только на сервере, используя `.env.example`; секреты не помещать в frontend/VITE variables.
3. Явно выполнить `npm run embeddings:openrouter`. Это платная операция: корпусные векторы не строятся автоматически. Artifact `data/openrouter_embeddings.json` исключён из Git.
4. Включить live option либо передать `useLiveAi: true`. Только OpenRouter key означает live retrieval/decision и deterministic prose. Отдельный generative path требует отдельной настройки; Decision не пишет текст.
5. Проверить health, warnings и component metadata. Успешный review с fallback нельзя записывать как результат Gemini.
6. После изменения корпуса пересобрать corpus и embeddings, затем запускать checks. Старые snapshots и отчёты не считать новым измерением.

Подробные ограничения API, task prefixes, batching и artifact compatibility — [OPENROUTER.md](./OPENROUTER.md). Модели выбраны пользователем; их превосходство на нашем домене пока не измерено. Google native confidence — `p_max`; legacy `concentrationConfidence` содержит среднее native confidences, а не вероятность пожарной безопасности или независимое доказательство правильности.

## Следующий порядок работ

**1. Закончить один полноценный NASA-сценарий.** Реальные источники и точные условия → вопрос → ранжирование → summary → сравнение протоколов → изменение конфигурации → пересмотр выводов → обоснованный test programme → сохраняемый отчёт. Проверить весь путь в браузере. Неизвестные исходы и отсутствие времени показывать прямо; доступные наблюдения должны давать полезный результат, а не только отказ.

**2. Доработать planner и predictor по смыслу.** В planner отличать недостающий ввод пользователя, незавершённое извлечение из источника и настоящую потребность в новом эксперименте. Для блока нужны цель, intervention/control, fixed variables, измерения, обоснование повторов и оборудование. Бюджетный оптимум не подтверждает научную выполнимость. Для predictor зафиксировать один совместимый endpoint и family, baseline, grouped split, uncertainty/error и domain gate. Не выдавать универсальный burn/safety percentage. Эти модули пока не прошли независимую научную проверку.

**3. Собрать независимый gold и корректное evaluation.** Источники разметить до просмотра ответов; второй reviewer проверяет спорные случаи, желательно с предметной экспертизой. Grouping должен учитывать связанные source/series/sample records, а не только разные case IDs. Dev/validation/test не должны делить одну зависимую экспериментальную историю. Усилить статический baseline, фиксировать полезную coverage и false refusal вместе с critical errors. Старый 100-case harness — development/regression suite, не закрытый независимый test. Отдельно измерить пользу Gemini decision и embeddings; не переносить offline heuristic/SVD метрики на новые модели.

**4. Выполнить настоящий competitor benchmark.** Для FlameBound и MicroFire Atlas — совместимые solid-combustion вопросы; Fotia/HEARTH — только подходящие области. Отдельно native-product и common-data track; зафиксировать версии, источники, eligibility и невыполненные случаи до просмотра результатов. Собственные baseline adapters не называть запущенными конкурентами. Полного head-to-head пока нет.

## Критерии следующего готового этапа

- Один source-backed сценарий воспроизводимо проходит полный UI/API/export путь.
- Старые scientific regressions не возвращаются; provider failures видимы и не маскируются под live success.
- Каждый существенный вывод имеет проверяемую опору, ограничения и корректный endpoint; lexical verifier pass не трактуется как entailment proof.
- Planner выдаёт подходящий следующий шаг: уточнение, изучение источника либо обоснованный опыт.
- У evaluation есть честные denominators, grouping, зафиксированные версии и ограничения; преимущества заявляются только по измеренным результатам.

Flow/PhysX не входят в этот этап: они не устраняют пробелы научного ядра и evaluation. Интерпретация NASA evidence остаётся главным механизмом продукта.

## Проверки этого изменения

- `npm test`: **115/115** tests, 11 файлов; HTTP-тесты используют локальный порт и mock провайдера.
- `python -m pytest pipeline -q -p no:cacheprovider`: **16 passed, 16 subtests passed**.
- `npm run lint` и `npm run build`: проходят. Vite предупреждает о будущем native config loader и extensionless imports; текущая production-сборка успешна.
- SQLite: `integrity_check=ok`, `foreign_key_check` без нарушений.
- Проверены также различение deterministic/live кеша, конфликт idempotency key (409), повтор после fallback и границы архивных review. Все вызовы провайдера в проверках — подставные; `OPENROUTER_API_KEY` в рабочем окружении отсутствует.

Эти проверки подтверждают перечисленные программные контракты и регрессии. Они не измеряют реальную точность Gemini и не заменяют независимую научную разметку или браузерный приёмочный прогон полного сценария.


## Подключение живого провайдера — 2026-11-14

Ключ настроен только в локальном ignored `.env` с правами 0600. Построен `data/openrouter_embeddings.json`: 2 463 document vectors × 768 dimensions. OpenRouter фактически возвращает native embedding ID без `google/`; добавлен точный совместимый alias, regression сначала воспроизвёл отказ и затем прошёл. Проходят 36 targeted adapter/runtime/review tests и lint.

Живой запрос `/api/reviews` вернул HTTP201, warnings=[], 2 decisions с evaluatorMode=live_openrouter, decisionModel=google/gemini-decision-1-20261111, embeddingModel=google/gemini-embedding-2. Prose остаётся deterministic: генеративная модель отдельно не подключалась. Это проверка интеграции, не измерение научного качества. Предыдущие записи об отсутствии ключа описывают состояние до этого подключения. Секрет и embedding artifact в Git не добавлялись.
