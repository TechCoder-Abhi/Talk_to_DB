'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, KeyRound, Link2 } from 'lucide-react';
import { SchemaInfo } from './types';

interface SchemaPanelProps {
  schema?: SchemaInfo;
  loading?: boolean;
  open?: boolean;
}

export function SchemaPanel({ schema, loading, open = true }: SchemaPanelProps) {
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const tables = useMemo(() => {
    const filter = query.trim().toLowerCase();
    return (schema?.tables ?? []).filter((table) =>
      table.name.toLowerCase().includes(filter),
    );
  }, [query, schema]);

  return (
    <aside className={`schema-panel ${open ? 'open' : ''}`}>
      <div className="schema-header">
        <h1 className="schema-title">Talk_to_DB</h1>
        <span className="badge">{schema?.tables.length ?? 0} tables</span>
      </div>
      <input
        className="schema-search"
        aria-label="Search tables"
        placeholder="Search tables"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="schema-list">
        {loading ? <div className="row-count">Loading schema...</div> : null}
        {!loading && tables.length === 0 ? (
          <div className="row-count">No tables found.</div>
        ) : null}
        {tables.map((table) => {
          const isOpen = expanded[table.name] ?? false;
          return (
            <div className="table-item" key={table.name}>
              <button
                className="table-button"
                type="button"
                onClick={() =>
                  setExpanded((current) => ({
                    ...current,
                    [table.name]: !isOpen,
                  }))
                }
              >
                <span>
                  <span className="table-name">{table.name}</span>
                  <br />
                  <span className="row-count">
                    approx. {table.rowCount.toLocaleString()} rows
                  </span>
                </span>
                {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
              </button>
              {isOpen ? (
                <div className="column-list">
                  {table.columns.map((column) => (
                    <div className="column-row" key={column.name}>
                      <span title={column.name}>{column.name}</span>
                      <span className="badge">{column.type.toUpperCase()}</span>
                      <span>
                        {column.isPrimaryKey ? (
                          <KeyRound size={14} aria-label="Primary key" />
                        ) : null}
                        {column.isForeignKey ? (
                          <Link2 size={14} aria-label="Foreign key" />
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
