'use client';

import {
  Bar,
  BarChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

interface ResultChartProps {
  rows: Record<string, unknown>[];
  columns?: string[];
  chartType: 'bar' | 'line';
  xKey?: string;
  yKey?: string;
}

function findNumericColumn(rows: Record<string, unknown>[], columns: string[]): string | undefined {
  return columns.find((column) => rows.some((row) => typeof row[column] === 'number'));
}

function normalizeRows(rows: Record<string, unknown>[]): Record<string, string | number>[] {
  return rows.map((row) => {
    const normalized: Record<string, string | number> = {};
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === 'number') {
        normalized[key] = value;
      } else if (typeof value === 'bigint') {
        normalized[key] = Number(value);
      } else {
        normalized[key] = value === null || value === undefined ? '' : String(value);
      }
    }
    return normalized;
  });
}

export function ResultChart({
  rows,
  columns,
  chartType,
  xKey,
  yKey,
}: ResultChartProps) {
  const chartRows = normalizeRows(rows);
  const chartColumns = columns?.length ? columns : Object.keys(chartRows[0] ?? {});
  const resolvedYKey = yKey && chartColumns.includes(yKey) ? yKey : findNumericColumn(chartRows, chartColumns);
  const resolvedXKey =
    xKey && chartColumns.includes(xKey)
      ? xKey
      : chartColumns.find((column) => column !== resolvedYKey);

  if (!resolvedXKey || !resolvedYKey || chartRows.length === 0) {
    return null;
  }

  return (
    <div className="chart-panel">
      <ResponsiveContainer width="100%" height={280}>
        {chartType === 'bar' ? (
          <BarChart data={chartRows}>
            <XAxis dataKey={resolvedXKey} tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={52} />
            <Tooltip />
            <Bar dataKey={resolvedYKey} fill="#2563eb" radius={[4, 4, 0, 0]} />
          </BarChart>
        ) : (
          <LineChart data={chartRows}>
            <XAxis dataKey={resolvedXKey} tickLine={false} axisLine={false} />
            <YAxis tickLine={false} axisLine={false} width={52} />
            <Tooltip />
            <Line
              type="monotone"
              dataKey={resolvedYKey}
              stroke="#0f766e"
              strokeWidth={2}
              dot={{ r: 3 }}
            />
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
