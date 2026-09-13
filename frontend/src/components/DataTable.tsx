'use client';

interface DataTableProps {
  rows: Record<string, unknown>[];
  columns?: string[];
  rowCount?: number;
  previewLimit?: number;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function isNumeric(value: unknown): boolean {
  return typeof value === 'number' || (typeof value === 'bigint');
}

export function DataTable({
  rows,
  columns,
  rowCount,
  previewLimit,
}: DataTableProps) {
  const tableColumns = columns?.length
    ? columns
    : Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const visibleRows = previewLimit ? rows.slice(0, previewLimit) : rows;

  if (tableColumns.length === 0) {
    return (
      <div className="data-table-wrap">
        <div className="table-footer">No columns returned.</div>
      </div>
    );
  }

  return (
    <div className="data-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            {tableColumns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.length === 0 ? (
            <tr>
              <td colSpan={tableColumns.length}>No results found.</td>
            </tr>
          ) : (
            visibleRows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {tableColumns.map((column) => (
                  <td
                    key={column}
                    className={isNumeric(row[column]) ? 'numeric' : undefined}
                    title={formatValue(row[column])}
                  >
                    {formatValue(row[column])}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {typeof rowCount === 'number' && rowCount > visibleRows.length ? (
        <div className="table-footer">
          Showing {visibleRows.length} of {rowCount} rows
        </div>
      ) : null}
    </div>
  );
}
