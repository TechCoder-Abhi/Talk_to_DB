'use client';

import { Brain, CheckCircle2, CircleAlert, Database, Loader2 } from 'lucide-react';
import { AgentStep } from './types';
import { DataTable } from './DataTable';
import { SqlBlock } from './SqlBlock';

interface ThinkingIndicatorProps {
  steps: AgentStep[];
  isStreaming?: boolean;
}

export function ThinkingIndicator({ steps, isStreaming }: ThinkingIndicatorProps) {
  const visibleSteps = steps.filter((step) => step.type !== 'answer');
  if (!visibleSteps.length && !isStreaming) {
    return null;
  }

  return (
    <div className="thinking">
      {visibleSteps.map((step, index) => (
        <div className="step" key={`${step.type}-${index}`}>
          <div className="step-header">
            {step.type === 'thinking' ? <Brain size={15} /> : null}
            {step.type === 'sql' ? <Database size={15} /> : null}
            {step.type === 'result' ? <CheckCircle2 size={15} /> : null}
            {step.type === 'error' ? <CircleAlert size={15} /> : null}
            <span>{step.type}</span>
            {step.provider ? <span className="badge">{step.provider}</span> : null}
          </div>
          {step.type === 'thinking' ? <div className="step-text">{step.content}</div> : null}
          {step.type === 'sql' && step.sql ? (
            <>
              <div className="step-text">{step.content}</div>
              <SqlBlock sql={step.sql} collapsible={false} />
            </>
          ) : null}
          {step.type === 'result' ? (
            <>
              <span className="badge success">{step.content}</span>
              {step.rows && step.columns ? (
                <DataTable
                  rows={step.rows}
                  columns={step.columns}
                  rowCount={step.rowCount}
                  previewLimit={3}
                />
              ) : null}
            </>
          ) : null}
          {step.type === 'error' ? <span className="badge danger">{step.content}</span> : null}
        </div>
      ))}
      {isStreaming ? (
        <div className="step-header">
          <Loader2 size={15} />
          <span className="pulse" aria-label="Waiting">
            <span />
            <span />
            <span />
          </span>
        </div>
      ) : null}
    </div>
  );
}
