/** Настройки: автомобили, оформление, единицы измерения, бэкап, демо-данные. */

import React, { useRef, useState } from 'react';
import { api, calendarUrl, csvUrl, jsonUrl, qrUrl } from '../api.ts';
import { useApp } from '../store.tsx';
import { useLoad } from '../hooks/useLoad.ts';
import { Badge, Button, Card, EmptyState, ErrorNote, Field, InfoNote, Loader, Modal, NumberInput, Select, TextInput } from '../ui.tsx';
import { useInstallPrompt } from '../hooks/useInstallPrompt.ts';
import { useMaintenanceAlerts } from '../hooks/useMaintenanceAlerts.ts';
import { formatDate } from '../../../shared/format.ts';
import { FUEL_TYPE_LABELS, UNIT_SYSTEM_LABELS } from '../../../shared/constants.ts';
import type { Database, ThemeName, UnitSystem, Vehicle } from '../../../shared/types.ts';

const EMPTY_VEHICLE = {
  name: '',
  make: '',
  model: '',
  year: '',
  plateNumber: '',
  vin: '',
  fuelType: 'petrol',
  tankCapacity: '50',
  initialOdometer: '0',
  purchaseDate: '',
  color: '#2F6F6B',
  notes: '',
};

export default function SettingsPage() {
  const { vehicles, activeVehicle, selectVehicle, settings, updateSettings, reload, notify } = useApp();
  const [form, setForm] = useState({ ...EMPTY_VEHICLE });
  const [editing, setEditing] = useState<Vehicle | null>(null);
  const [busy, setBusy] = useState(false);
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('replace');
  const fileInput = useRef<HTMLInputElement>(null);
  const { signOut } = useApp();
  const install = useInstallPrompt();
  const alerts = useMaintenanceAlerts(activeVehicle?.id);
  const network = useLoad(() => api.network(), [], null);

  const addVehicle = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    try {
      const created = await api.create<Vehicle>('vehicles', {
        name: form.name,
        make: form.make,
        model: form.model,
        year: form.year ? Number(form.year) : null,
        plateNumber: form.plateNumber,
        vin: form.vin,
        fuelType: form.fuelType,
        tankCapacity: Number(form.tankCapacity.replace(',', '.')) || 0,
        initialOdometer: Number(form.initialOdometer.replace(',', '.')) || 0,
        purchaseDate: form.purchaseDate || null,
        color: form.color,
        notes: form.notes,
      });
      setForm({ ...EMPTY_VEHICLE });
      await reload();
      await selectVehicle(created.id);
      notify('Автомобиль добавлен.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось добавить автомобиль.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveVehicle = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      await api.update<Vehicle>('vehicles', editing.id, editing as unknown as Record<string, unknown>);
      setEditing(null);
      await reload();
      notify('Данные автомобиля обновлены.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось сохранить автомобиль.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeVehicle = async (vehicle: Vehicle) => {
    const confirmed = window.confirm(
      `Удалить «${vehicle.name}» вместе со всеми заправками, расходами, доходами, поездками, запчастями и регламентами? Действие необратимо.`,
    );
    if (!confirmed) return;
    try {
      const result = await api.remove('vehicles', vehicle.id);
      await reload();
      const removed = result.removed ?? {};
      notify(`Автомобиль удалён. Вместе с ним удалено записей: ${Object.values(removed).reduce((a, b) => a + b, 0)}.`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось удалить автомобиль.', 'error');
    }
  };

  const importFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<Database>;
      const result = await api.importJson(importMode, parsed);
      await reload();
      notify(result.message, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось восстановить данные из файла.', 'error');
    }
  };

  const loadDemo = async () => {
    if (!window.confirm('Загрузить демонстрационные данные? Текущие записи будут заменены.')) return;
    try {
      const result = await api.loadDemo();
      await reload();
      notify(`Демо-данные загружены: ${result.summary.vehicles} авто, ${result.summary.fuel} заправок.`, 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось загрузить демо-данные.', 'error');
    }
  };

  const clearAll = async () => {
    if (!window.confirm('Удалить ВСЕ данные приложения? Файл базы будет очищен, действие необратимо.')) return;
    try {
      await api.clearAll();
      await reload();
      notify('Все данные удалены.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Не удалось очистить данные.', 'error');
    }
  };

  return (
    <div className="stack">
      <Card title="Автомобили" subtitle="Можно вести несколько машин: переключение — в верхней панели">
        {vehicles.length === 0 ? (
          <EmptyState title="Автомобилей нет" text="Добавьте первый автомобиль — он станет активным автоматически." />
        ) : (
          <ul className="vehicle-list">
            {vehicles.map((vehicle) => (
              <li key={vehicle.id} className={`vehicle-card ${activeVehicle?.id === vehicle.id ? 'is-active' : ''}`}>
                <span className="vehicle-card__dot" style={{ background: vehicle.color }} />
                <div className="vehicle-card__info">
                  <span className="vehicle-card__name">{vehicle.name}</span>
                  <span className="vehicle-card__meta">
                    {vehicle.make} {vehicle.model} {vehicle.year ?? ''} · {vehicle.plateNumber || 'без номера'} ·{' '}
                    {FUEL_TYPE_LABELS[vehicle.fuelType]} · пробег {Math.round(vehicle.initialOdometer)} км на начало учёта
                  </span>
                </div>
                <div className="vehicle-card__actions">
                  {activeVehicle?.id === vehicle.id ? <Badge tone="good">активный</Badge> : <Button size="sm" onClick={() => void selectVehicle(vehicle.id)}>Сделать активным</Button>}
                  <Button size="sm" variant="ghost" onClick={() => setEditing(vehicle)}>
                    Изменить
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void removeVehicle(vehicle)}>
                    Удалить
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Новый автомобиль">
        <form className="form-grid" onSubmit={addVehicle}>
          <Field label="Название" hint="как удобно называть: «Веста — рабочая»">
            <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Марка">
            <TextInput value={form.make} onChange={(e) => setForm({ ...form, make: e.target.value })} />
          </Field>
          <Field label="Модель">
            <TextInput value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          </Field>
          <Field label="Год выпуска">
            <NumberInput value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} step="1" />
          </Field>
          <Field label="Госномер">
            <TextInput value={form.plateNumber} onChange={(e) => setForm({ ...form, plateNumber: e.target.value })} />
          </Field>
          <Field label="VIN" hint="необязательно">
            <TextInput value={form.vin} onChange={(e) => setForm({ ...form, vin: e.target.value })} />
          </Field>
          <Field label="Тип привода">
            <Select value={form.fuelType} onChange={(e) => setForm({ ...form, fuelType: e.target.value })}>
              {Object.entries(FUEL_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Объём бака" hint="литры или кВт·ч">
            <NumberInput value={form.tankCapacity} onChange={(e) => setForm({ ...form, tankCapacity: e.target.value })} />
          </Field>
          <Field label="Пробег на начало учёта, км">
            <NumberInput value={form.initialOdometer} onChange={(e) => setForm({ ...form, initialOdometer: e.target.value })} />
          </Field>
          <Field label="Дата покупки" hint="для расчёта срока владения в авто-досье">
            <TextInput type="date" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} />
          </Field>
          <Field label="Цвет метки">
            <input className="input input--color" type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
          </Field>
          <div className="form-grid__wide form-actions">
            <span className="hint-line">Автомобиль сразу станет активным</span>
            <Button variant="primary" type="submit" disabled={busy}>
              Добавить автомобиль
            </Button>
          </div>
        </form>
      </Card>

      <div className="grid grid--2">
        <Card title="Оформление и единицы">
          <div className="form-grid form-grid--single">
            <Field label="Тема">
              <Select
                value={settings?.theme ?? 'system'}
                onChange={(e) => void updateSettings({ theme: e.target.value as ThemeName })}
              >
                <option value="system">Как в системе</option>
                <option value="light">Светлая</option>
                <option value="dark">Тёмная</option>
              </Select>
            </Field>
            <Field label="Единицы измерения" hint="в базе данные всё равно хранятся в км и литрах">
              <Select
                value={settings?.unitSystem ?? 'metric'}
                onChange={(e) => void updateSettings({ unitSystem: e.target.value as UnitSystem })}
              >
                {Object.entries(UNIT_SYSTEM_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <InfoNote>
              Данные хранятся в одном файле <code>data/db.json</code> на этом компьютере. Интернет не используется, аккаунт не требуется.
            </InfoNote>
          </div>
        </Card>

        <Card title="Экспорт и бэкап" subtitle="CSV для Excel, JSON для полного сохранения и переноса">
          <div className="button-row">
            <a className="btn btn--secondary btn--md" href={csvUrl(activeVehicle?.id, 'fuel')} download>
              CSV: заправки
            </a>
            <a className="btn btn--secondary btn--md" href={csvUrl(activeVehicle?.id, 'expenses')} download>
              CSV: расходы
            </a>
            <a className="btn btn--secondary btn--md" href={csvUrl(activeVehicle?.id, 'incomes')} download>
              CSV: доходы
            </a>
            <a className="btn btn--secondary btn--md" href={csvUrl(activeVehicle?.id, 'all')} download>
              CSV: всё одним файлом
            </a>
            <a className="btn btn--primary btn--md" href={jsonUrl()} download>
              Скачать бэкап JSON
            </a>
          </div>

          <div className="restore">
            <Field label="Режим восстановления">
              <Select value={importMode} onChange={(e) => setImportMode(e.target.value as 'replace' | 'merge')}>
                <option value="replace">Заменить все данные</option>
                <option value="merge">Добавить к текущим</option>
              </Select>
            </Field>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void importFile(file);
                e.target.value = '';
              }}
            />
          </div>
        </Card>
      </div>

      <Card
        title="Напоминания на телефон"
        subtitle="Чтобы не пропустить замену масла, колодок или продление страховки"
      >
        <div className="reminder-grid">
          <div className="reminder-grid__col">
            <h3 className="settings-subtitle">Календарь телефона — основной путь</h3>
            <ol className="install-steps">
              <li>Скачайте файл напоминаний на телефон (кнопка ниже).</li>
              <li>Откройте его — календарь предложит добавить события.</li>
              <li>
                Готово: телефон напомнит о каждом сроке заранее. Даты для регламентов «по пробегу»
                рассчитаны по вашему среднему пробегу в день.
              </li>
            </ol>
            <div className="button-row">
              <a className="btn btn--primary btn--md" href={calendarUrl(activeVehicle?.id)} download>
                Скачать напоминания (.ics)
              </a>
              {alerts.supported && alerts.permission !== 'granted' && (
                <Button
                  variant="secondary"
                  onClick={async () => {
                    const result = await alerts.request();
                    notify(
                      result === 'granted'
                        ? 'Уведомления включены: при открытом приложении срочные замены будут показываться сразу.'
                        : result === 'unsupported'
                          ? 'Этот браузер не умеет показывать уведомления — пользуйтесь календарём.'
                          : 'Разрешение на уведомления не выдано.',
                      result === 'granted' ? 'success' : 'info',
                    );
                  }}
                >
                  Включить уведомления
                </Button>
              )}
            </div>
            <p className="hint-line">
              Состояние уведомлений:{' '}
              {!alerts.supported
                ? 'браузер их не поддерживает'
                : alerts.permission === 'granted'
                  ? 'включены'
                  : alerts.permission === 'denied'
                    ? 'запрещены в настройках браузера'
                    : 'ещё не запрашивались'}
              .
            </p>
          </div>
          <div className="reminder-grid__col">
            <h3 className="settings-subtitle">Честно о push-уведомлениях</h3>
            <InfoNote>
              Уведомление при <strong>закрытом</strong> приложении требует внешнего push-сервиса и
              постоянного интернета — для локального журнала это лишняя зависимость. Поэтому основной путь —
              календарь: он даёт ровно те же системные напоминания, но без сторонних сервисов.
              Уведомление в приложении работает, когда журнал открыт.
            </InfoNote>
          </div>
        </div>
      </Card>

      <Card
        title="Доступ к журналу"
        subtitle="Пока компьютер и телефон в одной сети Wi-Fi, журнал по умолчанию открыт всем в этой сети"
        actions={
          network.data?.authEnabled ? (
            <Button size="sm" variant="ghost" onClick={signOut}>
              Выйти из журнала
            </Button>
          ) : undefined
        }
      >
        {network.data?.authEnabled ? (
          <>
            <p className="hint-line">
              Код доступа включён: без него данные не отдаются, а на телефоне показывается экран входа.
              Код хранится только в браузере телефона и в переменной окружения на компьютере.
            </p>
            <InfoNote>
              Чтобы сменить код — измените <code>ACCESS_TOKEN</code> в файле <code>.env</code> и перезапустите
              приложение; чтобы снять защиту — удалите эту переменную. Если код забыт, отключите его на компьютере,
              а затем войдите заново на телефоне.
            </InfoNote>
          </>
        ) : (
          <InfoNote>
            Код доступа не задан: журнал открыт любому, кто подключён к вашему Wi-Fi. Чтобы включить защиту,
            добавьте в файл <code>.env</code> строку <code>ACCESS_TOKEN=ваш-код</code> и перезапустите приложение
            (<code>npm start</code>). После этого на телефоне появится экран входа.
          </InfoNote>
        )}
      </Card>

      <Card
        title="Установка на телефон"
        subtitle="Телефон открывает журнал по Wi-Fi, а приложение ставится на домашний экран и работает как обычное"
      >
        {network.loading ? (
          <Loader label="Определяем адрес в сети…" />
        ) : network.error ? (
          <ErrorNote message={network.error} />
        ) : !network.data?.lanUrls.length ? (
          <InfoNote>
            Компьютер не подключён к локальной сети, поэтому телефон его пока не видит. Подключите компьютер к тому же
            Wi-Fi, что и телефон, и перезапустите приложение.
          </InfoNote>
        ) : (
          <div className="install-grid">
            <div className="install-grid__info">
              <ol className="install-steps">
                <li>Подключите телефон к той же сети Wi-Fi, что и этот компьютер.</li>
                <li>
                  Откройте с телефона адрес <code>{network.data.lanUrls[0]}</code> — проще всего навести камеру на
                  QR-код справа.
                </li>
                <li>
                  {install.canInstall
                    ? 'Нажмите кнопку установки ниже — система сама предложит поставить приложение на домашний экран.'
                    : install.isIos
                      ? 'В Safari нажмите «Поделиться» → «На экран „Домой“» — приложение встанет как обычное.'
                      : 'В меню браузера выберите «Установить приложение» или «Добавить на главный экран».'}
                </li>
              </ol>

              <div className="button-row">
                {install.isStandalone ? (
                  <Badge tone="good">Приложение уже установлено</Badge>
                ) : install.canInstall ? (
                  <Button
                    variant="primary"
                    onClick={async () => {
                      const outcome = await install.install();
                      notify(
                        outcome === 'accepted' ? 'Устанавливаем приложение…' : 'Установка отменена.',
                        outcome === 'accepted' ? 'success' : 'info',
                      );
                    }}
                  >
                    Установить приложение
                  </Button>
                ) : (
                  <Badge tone="neutral">
                    {install.isIos ? 'Установка вручную — см. шаг 3' : 'Откройте адрес на телефоне'}
                  </Badge>
                )}
              </div>

              <InfoNote>
                Android ставит приложение на домашний экран только по защищённому адресу. Если браузер не показывает
                установку, выполните на компьютере <code>npm run cert</code>, затем <code>npm run start:https</code> —
                и открывайте адрес с <code>https://</code>. Телефон один раз попросит подтвердить самоподписанный
                сертификат.
              </InfoNote>

              <p className="hint-line">
                Все адреса компьютера в сети: {network.data.lanUrls.join(', ')}. Данные не покидают вашу домашнюю
                сеть, но помните: доступ по Wi-Fi не защищён паролем — гости в той же сети тоже смогут открыть журнал.
              </p>
            </div>

            <div className="install-grid__qr">
              <img
                className="install-qr"
                src={qrUrl(network.data.lanUrls[0])}
                alt={`QR-код со ссылкой ${network.data.lanUrls[0]}`}
                width={220}
                height={220}
              />
              <span className="install-qr__caption">Наведите камеру телефона</span>
            </div>
          </div>
        )}
      </Card>

      <Card title="Демонстрационные данные" subtitle="Быстрый способ посмотреть приложение в деле: два авто, год истории, разные статусы ТО">
        <div className="button-row">
          <Button variant="secondary" onClick={() => void loadDemo()}>
            Загрузить демо-данные
          </Button>
          <Button variant="danger" onClick={() => void clearAll()}>
            Удалить все данные
          </Button>
        </div>
      </Card>

      {activeVehicle && (
        <p className="hint-line">
          Активный автомобиль: {activeVehicle.name} · создан {formatDate(activeVehicle.createdAt.slice(0, 10))}
        </p>
      )}

      <Modal
        open={Boolean(editing)}
        title="Изменить автомобиль"
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button onClick={() => setEditing(null)}>Отмена</Button>
            <Button variant="primary" onClick={() => void saveVehicle()} disabled={busy}>
              Сохранить
            </Button>
          </>
        }
      >
        {editing && (
          <div className="form-grid">
            <Field label="Название">
              <TextInput value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <Field label="Марка">
              <TextInput value={editing.make} onChange={(e) => setEditing({ ...editing, make: e.target.value })} />
            </Field>
            <Field label="Модель">
              <TextInput value={editing.model} onChange={(e) => setEditing({ ...editing, model: e.target.value })} />
            </Field>
            <Field label="Год выпуска">
              <NumberInput value={editing.year ?? ''} onChange={(e) => setEditing({ ...editing, year: e.target.value ? Number(e.target.value) : null })} step="1" />
            </Field>
            <Field label="Госномер">
              <TextInput value={editing.plateNumber} onChange={(e) => setEditing({ ...editing, plateNumber: e.target.value })} />
            </Field>
            <Field label="Тип привода">
              <Select value={editing.fuelType} onChange={(e) => setEditing({ ...editing, fuelType: e.target.value as Vehicle['fuelType'] })}>
                {Object.entries(FUEL_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Объём бака">
              <NumberInput value={editing.tankCapacity} onChange={(e) => setEditing({ ...editing, tankCapacity: Number(e.target.value) })} />
            </Field>
            <Field label="Пробег на начало учёта, км">
              <NumberInput value={editing.initialOdometer} onChange={(e) => setEditing({ ...editing, initialOdometer: Number(e.target.value) })} />
            </Field>
            <Field label="Дата покупки">
              <TextInput type="date" value={editing.purchaseDate ?? ''} onChange={(e) => setEditing({ ...editing, purchaseDate: e.target.value || null })} />
            </Field>
            <Field label="Цвет метки">
              <input className="input input--color" type="color" value={editing.color} onChange={(e) => setEditing({ ...editing, color: e.target.value })} />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
