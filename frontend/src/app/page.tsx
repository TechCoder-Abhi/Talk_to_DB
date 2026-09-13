'use client';

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Menu, SendHorizonal } from 'lucide-react';
import { io, Socket } from 'socket.io-client';
import { AgentResponse, AgentStep, DbConnectionInfo, Message, SchemaInfo } from '@/components/types';
import { MessageBubble } from '@/components/MessageBubble';
import { SchemaPanel } from '@/components/SchemaPanel';
import { DbSelector } from '@/components/DbSelector';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

const EXAMPLES = [
  'How many users signed up this month?',
  'Show me the top 10 most active users',
  "What's the average order value by country?",
  'List tables with the most rows',
];

function createId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function Page() {
  const [schema, setSchema] = useState<SchemaInfo>();
  const [schemaLoading, setSchemaLoading] = useState(true);
  const [schemaOpen, setSchemaOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [question, setQuestion] = useState('');
  const [connected, setConnected] = useState(false);
  const [connections, setConnections] = useState<DbConnectionInfo[]>([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [activeConnectionId, setActiveConnectionId] = useState<string | undefined>(undefined);
  const socketRef = useRef<Socket | null>(null);
  const activeAssistantId = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const schemaAbortRef = useRef<AbortController | null>(null);

  const loadSchema = useCallback(async (connectionId?: string, signal?: AbortSignal) => {
    const controller = signal ? undefined : new AbortController();
    if (controller) {
      schemaAbortRef.current?.abort();
      schemaAbortRef.current = controller;
    }
    const requestSignal = signal ?? controller!.signal;
    setSchemaLoading(true);
    try {
      const url = connectionId
        ? `${API_URL}/schema?connectionId=${encodeURIComponent(connectionId)}`
        : `${API_URL}/schema`;
      const response = await fetch(url, { signal: requestSignal });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data = (await response.json()) as SchemaInfo;
      if (!requestSignal.aborted) {
        setSchema(data);
      }
    } catch {
      if (!requestSignal.aborted) {
        setSchema({ tables: [], generatedAt: new Date().toISOString() });
      }
    } finally {
      if (!requestSignal.aborted) {
        setSchemaLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function load() {
      try {
        const [connRes] = await Promise.all([
          fetch(`${API_URL}/connections`, { signal: controller.signal }),
        ]);
        if (!cancelled) {
          if (connRes.ok) {
            const connData = (await connRes.json()) as DbConnectionInfo[];
            setConnections(connData);
            const defaultConn = connData[0];
            const connId = defaultConn?.id;
            setActiveConnectionId(connId);
            setConnectionsLoading(false);
            await loadSchema(connId, controller.signal);
          } else {
            setConnectionsLoading(false);
            await loadSchema(undefined, controller.signal);
          }
        }
      } catch {
        if (!cancelled && !controller.signal.aborted) {
          setConnectionsLoading(false);
          await loadSchema(undefined, controller.signal);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [loadSchema]);

  useEffect(() => {
    const socket = io(`${API_URL}/chat`, {
      transports: ['websocket', 'polling'],
    });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));
    socket.on('agent:step', (step: AgentStep) => {
      const id = activeAssistantId.current;
      if (!id) {
        return;
      }
      setMessages((current) =>
        current.map((message) =>
          message.id === id
            ? { ...message, steps: [...(message.steps ?? []), step] }
            : message,
        ),
      );
    });
    socket.on('agent:complete', (result: AgentResponse) => {
      const id = activeAssistantId.current;
      if (!id) {
        return;
      }
      setMessages((current) =>
        current.map((message) =>
          message.id === id
            ? {
                ...message,
                content: result.finalAnswer,
                steps: result.steps,
                rows: result.lastRows,
                columns: result.lastColumns,
                sql: result.lastSql,
                chartType: result.chartType,
                chartXKey: result.chartXKey,
                chartYKey: result.chartYKey,
                isStreaming: false,
              }
            : message,
        ),
      );
      activeAssistantId.current = null;
    });
    socket.on('agent:error', (error: { message?: string }) => {
      const id = activeAssistantId.current;
      if (!id) {
        return;
      }
      setMessages((current) =>
        current.map((message) =>
          message.id === id
            ? {
                ...message,
                content: error.message ?? 'Agent error.',
                isStreaming: false,
              }
            : message,
        ),
      );
      activeAssistantId.current = null;
    });

    return () => {
      socket.removeAllListeners();
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages]);

  const busy = useMemo(
    () => messages.some((message) => message.role === 'assistant' && message.isStreaming),
    [messages],
  );

  function sendPrompt(prompt: string) {
    const trimmed = prompt.trim();
    if (!trimmed || busy) {
      return;
    }

    const userMessage: Message = {
      id: createId(),
      role: 'user',
      content: trimmed,
    };
    const assistantId = createId();
    const assistantMessage: Message = {
      id: assistantId,
      role: 'assistant',
      content: '',
      steps: [],
      chartType: 'none',
      isStreaming: true,
    };

    activeAssistantId.current = assistantId;
    setMessages((current) => [...current, userMessage, assistantMessage]);
    setQuestion('');

    const socket = socketRef.current;
    if (socket?.connected) {
      socket.emit('query', {
        question: trimmed,
        sessionId: createId(),
        connectionId: activeConnectionId,
      });
      return;
    }

    void sendViaRest(trimmed, assistantId);
  }

  async function sendViaRest(prompt: string, assistantId: string) {
    try {
      const response = await fetch(`${API_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: prompt, connectionId: activeConnectionId }),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const result = (await response.json()) as AgentResponse;
      setMessages((current) =>
        current.map((message) =>
          message.id === assistantId
            ? {
                ...message,
                content: result.finalAnswer,
                steps: result.steps,
                rows: result.lastRows,
                columns: result.lastColumns,
                sql: result.lastSql,
                chartType: result.chartType,
                chartXKey: result.chartXKey,
                chartYKey: result.chartYKey,
                isStreaming: false,
              }
            : message,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Request failed.';
      setMessages((current) =>
        current.map((item) =>
          item.id === assistantId
            ? { ...item, content: message, isStreaming: false }
            : item,
        ),
      );
    } finally {
      activeAssistantId.current = null;
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    sendPrompt(question);
  }

  return (
    <main className="app-shell">
      <SchemaPanel schema={schema} loading={schemaLoading} open={schemaOpen} />
      <section className="chat-area">
        <header className="chat-header">
          <button
            className="icon-button"
            type="button"
            onClick={() => setSchemaOpen((current) => !current)}
            title="Toggle schema"
            aria-label="Toggle schema panel"
          >
            <Menu size={18} />
          </button>
          <h2 className="chat-title">Ask the database</h2>
          <DbSelector
            connections={connections}
            activeId={activeConnectionId}
            loading={connectionsLoading}
            onSelect={(id) => {
              setActiveConnectionId(id);
              setMessages([]);
              void loadSchema(id);
            }}
          />
          <span className="provider-pill">
            {connected ? 'streaming' : 'REST fallback'}
          </span>
        </header>

        <div className="messages">
          {messages.length === 0 ? (
            <div className="empty-state">
              <h2 className="empty-title">Query PostgreSQL in plain English</h2>
              <p className="empty-copy">
                Ask a question. Talk_to_DB will inspect the schema, write SQL, execute it,
                and correct failures before answering.
              </p>
              <div className="example-grid">
                {EXAMPLES.map((example) => (
                  <button
                    className="example-chip"
                    key={example}
                    type="button"
                    onClick={() => sendPrompt(example)}
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((message) => (
              <MessageBubble message={message} key={message.id} />
            ))
          )}
          <div ref={messagesEndRef} />
        </div>

        <form className="input-bar" onSubmit={handleSubmit}>
          <textarea
            value={question}
            aria-label="Ask a database question"
            placeholder="Ask a database question..."
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendPrompt(question);
              }
            }}
          />
          <button
            className="send-button"
            type="submit"
            disabled={busy || !question.trim()}
            title="Send"
            aria-label="Send question"
          >
            <SendHorizonal size={19} />
          </button>
        </form>
      </section>
    </main>
  );
}
