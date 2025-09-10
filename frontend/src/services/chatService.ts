import { api } from './api';
import { Message, Conversation } from '../types';

interface SendMessageRequest {
  content: string;
  conversationId?: string;
}

interface SendMessageResponse {
  message: Message;
  response: Message;
}

export const chatService = {
  async sendMessage(request: SendMessageRequest): Promise<SendMessageResponse> {
    return api.post<SendMessageResponse>('/api/chat/message', request);
  },

  async getConversation(conversationId: string): Promise<Conversation> {
    return api.get<Conversation>(`/api/chat/conversations/${conversationId}`);
  },

  async listConversations(): Promise<Conversation[]> {
    return api.get<Conversation[]>('/api/chat/conversations');
  },

  async createConversation(title: string): Promise<Conversation> {
    return api.post<Conversation>('/api/chat/conversations', { title });
  },

  async deleteConversation(conversationId: string): Promise<void> {
    return api.delete<void>(`/api/chat/conversations/${conversationId}`);
  },
};
