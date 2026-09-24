/**
 * Графики «АвтоЖурнала» — собственные SVG-компоненты без внешних библиотек.
 * Стиль: спокойные линии, мягкая сетка, скруглённые столбцы.
 */

import React from 'react';

export interface SeriesPoint {
  label: string;
  value: number;
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1.2 ? 1.2 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

function linePath(points: Array<{ x: number; y: number }>): string {
  if (!points.length) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const current = points[i];
    const cx = (prev.x + current.x) / 2;
    path += ` C ${cx} ${prev.y}, ${cx} ${current.y}, ${current.x} ${current.y}`;
  }
  return path;
}

/** Линейный график: динамика расхода по заправкам. */
export function LineChart({
  data,
  height = 220,
  formatValue = (v: number) => v.toFixed(1),
  emptyText = 'Данных пока нет',
}: {
  data: SeriesPoint[];
  height?: number;
  formatValue?: (value: number) => string;
  emptyText?: string;
}) {
  // Одна точка тоже информативна: показываем её без линии и заливки.
  if (data.length === 0) return <div className="chart-empty">{emptyText}</div>;

  const width = 720;
  const padding = { top: 18, right: 18, bottom: 34, left: 44 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = niceMax(Math.max(...data.map((d) => d.value)));
  const rawMin = Math.min(...data.map((d) => d.value)) * 0.6;
  const min = Math.max(0, rawMin);

  const xFor = (index: number) =>
    data.length === 1 ? padding.left + innerW / 2 : padding.left + (innerW * index) / (data.length - 1);
  const yFor = (value: number) =>
    padding.top + innerH - ((value - min) / Math.max(0.0001, max - min)) * innerH;

  const points = data.map((point, index) => ({ x: xFor(index), y: yFor(point.value) }));
  const areaPath =
    points.length > 1
      ? `${linePath(points)} L ${points[points.length - 1].x} ${padding.top + innerH} L ${points[0].x} ${padding.top + innerH} Z`
      : '';
  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => min + (max - min) * ratio);

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Динамика расхода">
      {gridValues.map((value) => (
        <g key={value}>
          <line className="chart__grid" x1={padding.left} x2={width - padding.right} y1={yFor(value)} y2={yFor(value)} />
          <text className="chart__axis" x={padding.left - 8} y={yFor(value) + 4} textAnchor="end">
            {formatValue(value)}
          </text>
        </g>
      ))}
      {areaPath && <path className="chart__area" d={areaPath} />}
      {/* При единственной точке рисуем горизонтальную линию — так график читается сразу */}
      <path
        className="chart__line"
        d={points.length > 1 ? linePath(points) : `M ${padding.left} ${points[0].y} L ${width - padding.right} ${points[0].y}`}
      />
      {points.map((point, index) => (
        <circle key={data[index].label + index} className="chart__dot" cx={point.x} cy={point.y} r={3.5} />
      ))}
      {data.map((point, index) =>
        index % Math.max(1, Math.ceil(data.length / 6)) === 0 || index === data.length - 1 ? (
          <text key={`label-${index}`} className="chart__axis" x={xFor(index)} y={height - 12} textAnchor="middle">
            {point.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

/** Столбчатый график: траты по месяцам (топливо + прочее). */
export function StackedBarChart({
  data,
  height = 240,
  formatValue = (v: number) => v.toFixed(0),
  emptyText = 'Данных пока нет',
}: {
  data: Array<{ label: string; fuel: number; other: number }>;
  height?: number;
  formatValue?: (value: number) => string;
  emptyText?: string;
}) {
  if (!data.length) return <div className="chart-empty">{emptyText}</div>;

  const width = 720;
  const padding = { top: 18, right: 18, bottom: 38, left: 52 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;
  const max = niceMax(Math.max(...data.map((d) => d.fuel + d.other)));
  const slot = innerW / data.length;
  const barWidth = Math.min(38, slot * 0.55);

  return (
    <svg className="chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Траты по месяцам">
      {[0, 0.5, 1].map((ratio) => (
        <g key={ratio}>
          <line
            className="chart__grid"
            x1={padding.left}
            x2={width - padding.right}
            y1={padding.top + innerH * (1 - ratio)}
            y2={padding.top + innerH * (1 - ratio)}
          />
          <text className="chart__axis" x={padding.left - 10} y={padding.top + innerH * (1 - ratio) + 4} textAnchor="end">
            {formatValue(max * ratio)}
          </text>
        </g>
      ))}
      {data.map((item, index) => {
        const x = padding.left + slot * index + (slot - barWidth) / 2;
        const total = item.fuel + item.other;
        const totalHeight = (total / max) * innerH;
        const fuelHeight = (item.fuel / max) * innerH;
        const y = padding.top + innerH - totalHeight;
        return (
          <g key={item.label}>
            <rect className="chart__bar chart__bar--other" x={x} y={y} width={barWidth} height={Math.max(0, totalHeight - fuelHeight)} rx={6} />
            <rect
              className="chart__bar chart__bar--fuel"
              x={x}
              y={padding.top + innerH - fuelHeight}
              width={barWidth}
              height={Math.max(0, fuelHeight)}
              rx={6}
            />
            <text className="chart__axis" x={x + barWidth / 2} y={height - 14} textAnchor="middle">
              {item.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Кольцевая диаграмма структуры расходов. */
export function DonutChart({
  data,
  size = 220,
  thickness = 26,
  centerLabel,
  centerValue,
}: {
  data: Array<{ label: string; value: number }>;
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerValue?: string;
}) {
  const total = data.reduce((acc, item) => acc + item.value, 0);
  if (!total) return <div className="chart-empty">Данных пока нет</div>;

  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Структура расходов">
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle className="donut__track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={thickness} fill="none" />
          {data.map((item, index) => {
            const length = (item.value / total) * circumference;
            const dash = `${Math.max(0, length - 3)} ${circumference - Math.max(0, length - 3)}`;
            const element = (
              <circle
                key={item.label}
                className={`donut__slice donut__slice--${index % 6}`}
                cx={size / 2}
                cy={size / 2}
                r={radius}
                strokeWidth={thickness}
                fill="none"
                strokeDasharray={dash}
                strokeDashoffset={-offset}
                strokeLinecap="round"
              />
            );
            offset += length;
            return element;
          })}
        </g>
        {centerValue && (
          <text className="donut__value" x={size / 2} y={size / 2 - 2} textAnchor="middle">
            {centerValue}
          </text>
        )}
        {centerLabel && (
          <text className="donut__label" x={size / 2} y={size / 2 + 20} textAnchor="middle">
            {centerLabel}
          </text>
        )}
      </svg>
      <ul className="legend">
        {data.map((item, index) => (
          <li key={item.label} className="legend__item">
            <span className={`legend__swatch legend__swatch--${index % 6}`} />
            <span className="legend__label">{item.label}</span>
            <span className="legend__value">{((item.value / total) * 100).toFixed(1).replace('.', ',')} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
