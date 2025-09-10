import { useState, useCallback, useEffect } from "react";
import type { Message, Conversation } from "../types";
import { chatService } from "../services/chatService";
import { websocketService } from "../services/websocketService";
import type { WebSocketMessage } from "../services/websocketService";

const STORAGE_KEY = "validis_chat_conversations";
const CURRENT_CONVERSATION_KEY = "validis_current_conversation";

export const useChatWithPersistence = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<
    string | null
  >(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [typingUsers, setTypingUsers] = useState<Set<string>>(new Set());

  // Load conversations from localStorage on mount
  useEffect(() => {
    const loadedConversations = loadConversationsFromStorage();
    setConversations(loadedConversations);

    const savedCurrentId = localStorage.getItem(CURRENT_CONVERSATION_KEY);
    if (
      savedCurrentId &&
      loadedConversations.find((c) => c.id === savedCurrentId)
    ) {
      selectConversation(savedCurrentId);
    }
  }, []);

  // Save conversations to localStorage whenever they change
  useEffect(() => {
    saveConversationsToStorage(conversations);
  }, [conversations]);

  // Save current conversation ID to localStorage
  useEffect(() => {
    if (currentConversationId) {
      localStorage.setItem(CURRENT_CONVERSATION_KEY, currentConversationId);
    } else {
      localStorage.removeItem(CURRENT_CONVERSATION_KEY);
    }
  }, [currentConversationId]);

  // Setup WebSocket connection and handlers
  useEffect(() => {
    // Connect to WebSocket
    websocketService.connect();

    // Handle WebSocket messages
    const unsubscribeMessage = websocketService.onMessage(
      (message: WebSocketMessage) => {
        switch (message.type) {
          case "message":
            if (
              message.payload &&
              message.conversationId === currentConversationId
            ) {
              const newMessage: Message = {
                ...message.payload,
                timestamp: message.timestamp || new Date(),
              };
              addMessageToCurrentConversation(newMessage);
            }
            break;

          case "typing":
            if (message.payload?.isTyping) {
              setTypingUsers((prev) =>
                new Set(prev).add(message.payload.userId || "agent"),
              );
            } else {
              setTypingUsers((prev) => {
                const newSet = new Set(prev);
                newSet.delete(message.payload.userId || "agent");
                return newSet;
              });
            }
            break;

          case "status":
            if (message.payload?.status === "processing") {
              setIsLoading(true);
            } else if (message.payload?.status === "complete") {
              setIsLoading(false);
            }
            break;

          case "error":
            setError(message.payload?.message || "An error occurred");
            setIsLoading(false);
            break;
        }
      },
    );

    // Handle connection status
    const unsubscribeStatus = websocketService.onStatusChange((status) => {
      setIsConnected(status.isConnected);
      if (status.lastError) {
        console.error("WebSocket error:", status.lastError);
      }
    });

    // Cleanup
    return () => {
      unsubscribeMessage();
      unsubscribeStatus();
    };
  }, [currentConversationId]);

  const loadConversationsFromStorage = (): Conversation[] => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        // Convert date strings back to Date objects
        return parsed.map((conv: any) => ({
          ...conv,
          createdAt: new Date(conv.createdAt),
          updatedAt: new Date(conv.updatedAt),
          messages: conv.messages.map((msg: any) => ({
            ...msg,
            timestamp: new Date(msg.timestamp),
          })),
        }));
      }
    } catch (error) {
      console.error("Failed to load conversations from storage:", error);
    }
    return [];
  };

  const saveConversationsToStorage = (convs: Conversation[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(convs));
    } catch (error) {
      console.error("Failed to save conversations to storage:", error);
    }
  };

  const addMessageToCurrentConversation = (message: Message) => {
    setMessages((prev) => [...prev, message]);

    // Update conversation in list
    setConversations((prev) =>
      prev.map((conv) => {
        if (conv.id === currentConversationId) {
          return {
            ...conv,
            messages: [...conv.messages, message],
            updatedAt: new Date(),
          };
        }
        return conv;
      }),
    );
  };

  const sendMessage = useCallback(
    async (content: string) => {
      if (!content.trim()) return;

      setIsLoading(true);
      setError(null);

      const userMessage: Message = {
        id: `msg-${Date.now()}`,
        content,
        role: "user",
        timestamp: new Date(),
      };

      // If no current conversation, create a new one
      let conversationId = currentConversationId;
      if (!conversationId) {
        conversationId = `conv-${Date.now()}`;
        const newConversation: Conversation = {
          id: conversationId,
          title: content.substring(0, 50) + (content.length > 50 ? "..." : ""),
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        setConversations((prev) => [newConversation, ...prev]);
        setCurrentConversationId(conversationId);
      }

      // Add user message optimistically
      addMessageToCurrentConversation(userMessage);

      // Send via WebSocket if connected, otherwise use HTTP
      if (isConnected) {
        websocketService.sendMessage(userMessage);
        // Send conversation ID separately if needed
        websocketService.send({
          type: "conversation",
          conversationId,
        });
      } else {
        try {
          const response = await chatService.sendMessage({
            content,
            conversationId,
          });

          // Add assistant response
          addMessageToCurrentConversation(response.response);

          // Update conversation title if it was the first message
          if (messages.length === 0) {
            setConversations((prev) =>
              prev.map((conv) => {
                if (conv.id === conversationId) {
                  return {
                    ...conv,
                    title:
                      content.substring(0, 50) +
                      (content.length > 50 ? "..." : ""),
                  };
                }
                return conv;
              }),
            );
          }
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Failed to send message",
          );
          // Remove optimistic message on error
          setMessages((prev) => prev.filter((m) => m.id !== userMessage.id));
        } finally {
          setIsLoading(false);
        }
      }
    },
    [currentConversationId, isConnected, messages.length],
  );

  const selectConversation = useCallback(
    (conversationId: string) => {
      const conversation = conversations.find((c) => c.id === conversationId);
      if (conversation) {
        setCurrentConversationId(conversationId);
        setMessages(conversation.messages);
      }
    },
    [conversations],
  );

  const createNewConversation = useCallback(() => {
    setCurrentConversationId(null);
    setMessages([]);
    setError(null);
  }, []);

  const deleteConversation = useCallback(
    (conversationId: string) => {
      setConversations((prev) => prev.filter((c) => c.id !== conversationId));

      // If deleting current conversation, clear it
      if (conversationId === currentConversationId) {
        createNewConversation();
      }
    },
    [currentConversationId, createNewConversation],
  );

  const clearAllConversations = useCallback(() => {
    setConversations([]);
    setMessages([]);
    setCurrentConversationId(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(CURRENT_CONVERSATION_KEY);
  }, []);

  return {
    messages,
    conversations,
    currentConversationId,
    sendMessage,
    selectConversation,
    createNewConversation,
    deleteConversation,
    clearAllConversations,
    isLoading,
    error,
    isConnected,
    typingUsers,
  };
};
