# EMBER — Spacecraft Fire Evidence Lab

Единственная активная версия проекта — **[`ember-final/`](ember-final/)**.

Интерактивная рабочая среда для поиска, ранжирования и интерпретации исследований горения NASA. Gemini Decision 1 и Gemini Embedding 2 работают через OpenRouter; GPT-6 Luna генерирует обзоры через OpenAI API.

```sh
cd ember-final
npm install
npm run dev
```

Открыть адрес, который напечатает Vite. Серверный `.env` создаётся по `.env.example`; секреты и embedding artifact исключены из Git. Сохранённые локальные обзоры находятся в `ember-final/data/reviews_store.json`.

- [Настройка и описание проекта](ember-final/README.md)
- [Текущий статус и следующие задачи](ember-final/docs/IMPLEMENTATION_STATUS.md)
- [OpenRouter и индекс](ember-final/docs/OPENROUTER.md)
- [Журнал разработки](ember-final/docs/ACTION_LOG.md)

Проверки из `ember-final`: `npm test`, `npm run lint`, `npm run build`, `python -m pytest pipeline`.

Старые `web`, `ember-win` и корневые legacy-папки убраны из активного дерева. Они доступны в Git-истории и в отдельном локальном архиве; продолжать разработку следует только в `ember-final`.

CI проверяет `ember-final`. Предыдущий workflow для деплоя `web` удалён: публикация новой Node/API-версии требует отдельной настройки, статический frontend не заменяет её backend.

Рабочая реализация не означает завершённую научную валидацию: оставшиеся задачи по planner, predictor, независимому evaluation и подаче перечислены в статусе проекта.
