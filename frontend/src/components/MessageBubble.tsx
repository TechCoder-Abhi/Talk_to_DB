'use client';

import { Message } from './types';
import { DataTable } from './DataTable';
import { ResultChart } from './ResultChart';
import { SqlBlock } from './SqlBlock';
import { ThinkingIndicator } from './ThinkingIndicator';

interface MessageBubbleProps {
  message: Message;
}

function renderMarkdownLite(text: string) {
  const html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br />')}</p>`)
    .join('');

  return { __html: html };
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const assistant = message.role === 'assistant';
  const showChart =
    assistant &&
    message.chartType &&
    message.chartType !== 'none' &&
    message.rows &&
    message.rows.length > 0;

  return (
    <div className={`message-row ${message.role}`}>
      <div className="message-bubble">
        {assistant ? (
          <ThinkingIndicator
            steps={message.steps ?? []}
            isStreaming={message.isStreaming}
          />
        ) : null}
        {message.content ? (
          <div
            className="message-content"
            dangerouslySetInnerHTML={renderMarkdownLite(message.content)}
          />
        ) : null}
        {assistant && message.sql ? (
          <SqlBlock sql={message.sql} defaultOpen={false} />
        ) : null}
        {assistant && message.rows && message.columns ? (
          <DataTable
            rows={message.rows}
            columns={message.columns}
            rowCount={message.rows.length}
          />
        ) : null}
        {showChart ? (
          <ResultChart
            rows={message.rows ?? []}
            columns={message.columns}
            chartType={message.chartType as 'bar' | 'line'}
            xKey={message.chartXKey}
            yKey={message.chartYKey}
          />
        ) : null}
      </div>
    </div>
  );
}
