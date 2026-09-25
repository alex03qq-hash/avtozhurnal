# API

Полный список методов REST API «АвтоЖурнала».

---

Все ответы — JSON; ошибки — `{"error": "текст на русском"}`.

| Метод | Адрес | Назначение |
|---|---|---|
| GET | `/api/health` | Состояние сервера, путь к файлу базы |
| GET/PATCH | `/api/settings` | Тема, единицы измерения, активный автомобиль |
| GET/POST | `/api/vehicles`, `/api/fuel`, `/api/expenses`, `/api/incomes`, `/api/trips`, `/api/parts`, `/api/rules`, `/api/checklist` | Список (с фильтром `?vehicleId=`) и создание записи |
| GET/PATCH/DELETE | `/api/<коллекция>/:id` | Чтение, изменение, удаление записи |
| POST | `/api/rules/:id/complete` | Отметить регламент выполненным (проставить текущий пробег и дату) |
| GET | `/api/stats/overview?vehicleId=` | Сводка: расход, ₽/км, траты за месяц и год, прибыль, пробег |
| GET | `/api/stats/consumption?vehicleId=` | Отрезки метода полного бака и точки для графика |
| GET | `/api/stats/monthly?vehicleId=&months=12` | Траты по месяцам |
| GET | `/api/stats/categories?vehicleId=&from=&to=` | Структура расходов по категориям |
| GET | `/api/stats/trips?vehicleId=` | Поездки с расчётной себестоимостью и прибылью |
| GET | `/api/reminders?vehicleId=` | Регламенты ТО со статусами износа |
| GET | `/api/reports/dossier?vehicleId=` | Данные авто-досье |
| GET | `/api/export/csv?vehicleId=&type=fuel\|expenses\|incomes\|all` | Экспорт CSV (BOM + `;`) |
| GET | `/api/export/json?vehicleId=` | Полный бэкап JSON |
| POST | `/api/import/json` | Восстановление: `{"mode":"replace"\|"merge","data":{…}}` |
| POST/DELETE | `/api/demo` | Загрузить демонстрационные данные / удалить все данные |

Примеры:

```bash
curl -X POST http://localhost:4000/api/demo
curl "http://localhost:4000/api/stats/overview"
curl -o zapravki.csv "http://localhost:4000/api/export/csv?type=fuel"
```
