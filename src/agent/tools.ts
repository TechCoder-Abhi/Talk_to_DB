export type ToolName = 'execute_sql' | 'execute_query' | 'answer';

export interface ExecuteSqlInput {
  sql: string;
  reasoning: string;
}

export interface ExecuteQueryInput {
  query: string;
  reasoning: string;
}

export interface AnswerInput {
  summary: string;
  chartType: 'bar' | 'line' | 'none';
  chartXKey?: string;
  chartYKey?: string;
}

export type ToolInput = ExecuteSqlInput | ExecuteQueryInput | AnswerInput;

export interface QuerybotToolCall {
  id: string;
  name: ToolName;
  input: ToolInput;
}

export interface ToolDeclaration {
  name: ToolName;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, unknown>;
    required: string[];
  };
}

export function getTools(queryLanguage: 'sql' | 'mongodb'): ToolDeclaration[] {
  if (queryLanguage === 'mongodb') {
    return [
      {
        name: 'execute_query',
        description:
          'Execute a read-only MongoDB query against the database. Use this to retrieve data needed to answer the user question. If the query fails, inspect the error and try a corrected query. Provide the query as JSON: { "collection": "...", "type": "find|aggregate", "filter": {...}, "projection": {...}, "sort": {...}, "limit": N }',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'A MongoDB query in JSON format (find or aggregate).',
            },
            reasoning: {
              type: 'string',
              description: 'Brief explanation of what this query is trying to find out.',
            },
          },
          required: ['query', 'reasoning'],
        },
      },
      {
        name: 'answer',
        description:
          'Provide the final answer to the user question when enough data has been gathered, or explain why the answer cannot be produced from the available schema.',
        parameters: {
          type: 'object',
          properties: {
            summary: {
              type: 'string',
              description: 'Human-readable answer to the question in 1-3 sentences.',
            },
            chartType: {
              type: 'string',
              enum: ['bar', 'line', 'none'],
              description: 'Use none for single values or non-visual results.',
            },
            chartXKey: {
              type: 'string',
              description: 'Column name for the X axis when charting.',
            },
            chartYKey: {
              type: 'string',
              description: 'Column name for the Y axis when charting.',
            },
          },
          required: ['summary', 'chartType'],
        },
      },
    ];
  }

  return [
    {
      name: 'execute_sql',
      description:
        'Execute a read-only SQL SELECT query against the database. Use this to retrieve data needed to answer the user question. If the query fails, inspect the error and try a corrected query.',
      parameters: {
        type: 'object',
        properties: {
          sql: {
            type: 'string',
            description: 'A read-only SELECT query.',
          },
          reasoning: {
            type: 'string',
            description: 'Brief explanation of what this query is trying to find out.',
          },
        },
        required: ['sql', 'reasoning'],
      },
    },
    {
      name: 'answer',
      description:
        'Provide the final answer to the user question when enough data has been gathered, or explain why the answer cannot be produced from the available schema.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'Human-readable answer to the question in 1-3 sentences.',
          },
          chartType: {
            type: 'string',
            enum: ['bar', 'line', 'none'],
            description: 'Use none for single values or non-visual results.',
          },
          chartXKey: {
            type: 'string',
            description: 'Column name for the X axis when charting.',
          },
          chartYKey: {
            type: 'string',
            description: 'Column name for the Y axis when charting.',
          },
        },
        required: ['summary', 'chartType'],
      },
    },
  ];
}

export function isExecuteSqlInput(input: ToolInput): input is ExecuteSqlInput {
  return (
    'sql' in input &&
    typeof input.sql === 'string' &&
    'reasoning' in input &&
    typeof input.reasoning === 'string'
  );
}

export function isExecuteQueryInput(input: ToolInput): input is ExecuteQueryInput {
  return (
    'query' in input &&
    typeof input.query === 'string' &&
    'reasoning' in input &&
    typeof input.reasoning === 'string'
  );
}

export function isAnswerInput(input: ToolInput): input is AnswerInput {
  return (
    'summary' in input &&
    typeof input.summary === 'string' &&
    'chartType' in input &&
    (input.chartType === 'bar' || input.chartType === 'line' || input.chartType === 'none')
  );
}
