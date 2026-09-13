'use client';

import { Database, Loader2 } from 'lucide-react';
import { DbConnectionInfo } from './types';

interface DbSelectorProps {
  connections: DbConnectionInfo[];
  activeId: string | undefined;
  loading: boolean;
  onSelect: (id: string) => void;
}

export function DbSelector({ connections, activeId, loading, onSelect }: DbSelectorProps) {
  if (loading) {
    return (
      <div className="db-selector">
        <Database size={14} />
        <Loader2 size={14} className="spin" />
      </div>
    );
  }

  if (connections.length <= 1) {
    return null;
  }

  const resolvedActiveId = connections.some((connection) => connection.id === activeId)
    ? activeId
    : connections[0]?.id ?? '';

  return (
    <div className="db-selector">
      <Database size={14} />
      <select
        value={resolvedActiveId}
        onChange={(event) => onSelect(event.target.value)}
        className="db-select"
        aria-label="Database connection"
      >
        {connections.map((conn) => (
          <option key={conn.id} value={conn.id}>
            {conn.name} ({conn.type})
          </option>
        ))}
      </select>
    </div>
  );
}
