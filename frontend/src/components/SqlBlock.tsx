'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, Database } from 'lucide-react';
import SyntaxHighlighter from 'react-syntax-highlighter';
import { atomOneDark } from 'react-syntax-highlighter/dist/esm/styles/hljs';

interface SqlBlockProps {
  sql: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
}

export function SqlBlock({
  sql,
  collapsible = true,
  defaultOpen = true,
}: SqlBlockProps) {
  const [open, setOpen] = useState(defaultOpen || !collapsible);

  return (
    <div className="sql-block">
      {collapsible ? (
        <button
          className="sql-toggle"
          type="button"
          onClick={() => setOpen((current) => !current)}
          title={open ? 'Hide SQL' : 'Show SQL'}
        >
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          <Database size={16} />
          SQL
        </button>
      ) : null}
      {open ? (
        <SyntaxHighlighter
          language="sql"
          style={atomOneDark}
          customStyle={{ margin: 0, padding: '13px', background: 'transparent' }}
        >
          {sql}
        </SyntaxHighlighter>
      ) : null}
    </div>
  );
}
