/**
 * Небольшой набор интерфейсных компонентов «АвтоЖурнала».
 * Никаких внешних UI-библиотек: только React + CSS-переменные темы.
 */

import React, { useEffect } from 'react';
import type { RuleStatus } from '../../shared/types.ts';
import { useApp } from './store.tsx';

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
  padded = true,
}: {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={`card ${padded ? 'card--padded' : ''} ${className}`}>
      {(title || actions) && (
        <header className="card__head">
          <div>
            {title && <h2 className="card__title">{title}</h2>}
            {subtitle && <p className="card__subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="card__actions">{actions}</div>}
        </header>
      )}
      <div className="card__body">{children}</div>
    </section>
  );
}

export function Kpi({
  label,
  value,
  hint,
  tone = 'default',
  icon,
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: 'default' | 'accent' | 'good' | 'warn' | 'bad';
  icon?: React.ReactNode;
}) {
  return (
    <article className={`kpi kpi--${tone}`}>
      <div className="kpi__top">
        <span className="kpi__label">{label}</span>
        {icon && <span className="kpi__icon">{icon}</span>}
      </div>
      <div className="kpi__value">{value}</div>
      {hint && <div className="kpi__hint">{hint}</div>}
    </article>
  );
}

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
}) {
  return (
    <button type="button" className={`btn btn--${variant} btn--${size}`} {...rest}>
      {children}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`field ${className}`}>
      <span className="field__label">{label}</span>
      {children}
      {hint && <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function NumberInput({
  step = 'any',
  inputRef,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { step?: string | number; inputRef?: React.Ref<HTMLInputElement> }) {
  return <input ref={inputRef} className="input input--number" type="number" step={step} inputMode="decimal" {...props} />;
}

export function Select({ children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className="input input--select" {...props}>
      {children}
    </select>
  );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="input input--area" rows={3} {...props} />;
}

export function Checkbox({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label className="checkbox">
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return undefined;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    document.body.classList.add('modal-open');
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.classList.remove('modal-open');
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal__backdrop" onClick={onClose} />
      <div className={`modal__panel ${wide ? 'modal__panel--wide' : ''}`}>
        <header className="modal__head">
          <h2>{title}</h2>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Закрыть">
            ×
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__foot">{footer}</footer>}
      </div>
    </div>
  );
}

export interface Column<T> {
  key: string;
  title: string;
  align?: 'left' | 'right';
  render: (row: T) => React.ReactNode;
}

export function DataTable<T extends { id: string }>({
  columns,
  rows,
  empty,
  onDelete,
  deleteLabel = 'Удалить',
}: {
  columns: Array<Column<T>>;
  rows: T[];
  empty?: React.ReactNode;
  onDelete?: (row: T) => void;
  deleteLabel?: string;
}) {
  if (!rows.length) {
    return <div className="table-empty">{empty ?? 'Записей пока нет.'}</div>;
  }
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column.key} className={column.align === 'right' ? 'is-right' : undefined}>
                {column.title}
              </th>
            ))}
            {onDelete && <th className="is-right">Действия</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((column) => (
                <td
                  key={column.key}
                  // data-label превращает строку таблицы в карточку на узких экранах
                  data-label={column.title}
                  className={column.align === 'right' ? 'is-right' : undefined}
                >
                  {column.render(row)}
                </td>
              ))}
              {onDelete && (
                <td className="is-right" data-label="Действия">
                  <Button size="sm" variant="ghost" onClick={() => onDelete(row)}>
                    {deleteLabel}
                  </Button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const STATUS_LABEL: Record<RuleStatus, string> = {
  ok: 'В норме',
  soon: 'Скоро',
  overdue: 'Просрочено',
};

export function StatusBadge({ status }: { status: RuleStatus }) {
  return <span className={`badge badge--${status}`}>{STATUS_LABEL[status]}</span>;
}

export function Badge({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'accent' | 'good' | 'warn' | 'bad' }) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}

export function EmptyState({
  title,
  text,
  action,
}: {
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <h3 className="empty__title">{title}</h3>
      <p className="empty__text">{text}</p>
      {action && <div className="empty__action">{action}</div>}
    </div>
  );
}

export function Loader({ label = 'Загружаем данные…' }: { label?: string }) {
  return (
    <div className="loader" role="status">
      <span className="loader__dot" />
      <span className="loader__dot" />
      <span className="loader__dot" />
      <span className="loader__label">{label}</span>
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="note note--error" role="alert">
      {message}
    </div>
  );
}

export function InfoNote({ children }: { children: React.ReactNode }) {
  return <div className="note note--info">{children}</div>;
}

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  if (!toasts.length) return null;
  return (
    <div className="toasts">
      {toasts.map((toast) => (
        <button key={toast.id} type="button" className={`toast toast--${toast.kind}`} onClick={() => dismissToast(toast.id)}>
          {toast.message}
        </button>
      ))}
    </div>
  );
}

export function ProgressBar({ percent, tone = 'accent' }: { percent: number; tone?: 'accent' | 'warn' | 'bad' }) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(clamped)} aria-valuemin={0} aria-valuemax={100}>
      <span className={`progress__fill progress__fill--${tone}`} style={{ width: `${clamped}%` }} />
    </div>
  );
}
