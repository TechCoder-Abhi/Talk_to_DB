import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { AgentService } from '../agent/agent.service';

interface QueryPayload {
  question?: string;
  sessionId?: string;
  connectionId?: string;
}

@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:3000' },
  namespace: '/chat',
})
export class ChatGateway {
  @WebSocketServer()
  server!: Server;

  constructor(private readonly agentService: AgentService) {}

  @SubscribeMessage('query')
  async handleQuery(
    @MessageBody() data: QueryPayload,
    @ConnectedSocket() client: Socket,
  ): Promise<void> {
    try {
      const question = data.question?.trim();
      if (!question) {
        client.emit('agent:error', { message: 'question is required' });
        return;
      }
      if (question.length > 4_000) {
        client.emit('agent:error', { message: 'question must be 4,000 characters or fewer' });
        return;
      }

      client.emit('agent:start', {
        sessionId: data.sessionId,
        timestamp: new Date().toISOString(),
      });

      const result = await this.agentService.runAgent(question, data.connectionId, (step) => {
        client.emit('agent:step', step);
      });

      client.emit('agent:complete', result);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      client.emit('agent:error', { message });
    }
  }
}
