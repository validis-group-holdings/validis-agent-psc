import { useState } from 'react';
import { ChatInterface } from '../components/ChatInterface';
import { Message } from '../types';
import { useChat } from '../hooks/useChat';

export const ChatPage: React.FC = () => {
  const { messages, sendMessage, isLoading } = useChat();

  return (
    <ChatInterface
      messages={messages}
      onSendMessage={sendMessage}
      isLoading={isLoading}
    />
  );
};
