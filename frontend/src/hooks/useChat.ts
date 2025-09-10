import { useState, useCallback } from 'react';
import { Message } from '../types';
import { chatService } from '../services/chatService';

export const useChat = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(null);

  const sendMessage = useCallback(async (content: string) => {
    setIsLoading(true);
    setError(null);

    const userMessage: Message = {
      id: `temp-${Date.now()}`,
      content,
      role: 'user',
      timestamp: new Date(),
    };

    // Optimistically add user message
    setMessages((prev) => [...prev, userMessage]);

    try {
      const response = await chatService.sendMessage({
        content,
        conversationId: conversationId || undefined,
      });

      // Update with actual message IDs from server
      setMessages((prev) => {
        const filtered = prev.filter((m) => m.id !== userMessage.id);
        return [...filtered, response.message, response.response];
      });

      // Set conversation ID if this is the first message
      if (!conversationId && response.message.id) {
        setConversationId(response.message.id.split('-')[0]); // Extract conversation ID
      }
    } catch (err) {
      // Remove optimistic message on error
      setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
      setError(err instanceof Error ? err.message : 'Failed to send message');
      console.error('Failed to send message:', err);
    } finally {
      setIsLoading(false);
    }
  }, [conversationId]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setError(null);
  }, []);

  return {
    messages,
    sendMessage,
    isLoading,
    error,
    clearMessages,
    conversationId,
  };
};
