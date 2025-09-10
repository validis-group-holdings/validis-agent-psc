import type { Message } from "../types";

export interface WebSocketMessage {
  type:
    | "message"
    | "status"
    | "error"
    | "typing"
    | "connected"
    | "disconnected";
  payload?: any;
  conversationId?: string;
  timestamp?: Date;
}

export interface WebSocketStatus {
  isConnected: boolean;
  reconnectAttempts: number;
  lastError?: string;
}

type MessageHandler = (message: WebSocketMessage) => void;
type StatusHandler = (status: WebSocketStatus) => void;

class WebSocketService {
  private ws: WebSocket | null = null;
  private url: string;
  private messageHandlers: Set<MessageHandler> = new Set();
  private statusHandlers: Set<StatusHandler> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatInterval = 30000; // 30 seconds
  private status: WebSocketStatus = {
    isConnected: false,
    reconnectAttempts: 0,
  };

  constructor(url?: string) {
    // Use environment variable or default to localhost
    this.url =
      url ||
      (import.meta.env.VITE_WS_URL as string) ||
      "ws://localhost:8001/ws";
  }

  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log("WebSocket already connected");
      return;
    }

    try {
      this.ws = new WebSocket(this.url);
      this.setupEventListeners();
    } catch (error) {
      console.error("Failed to create WebSocket connection:", error);
      this.handleError(error as Error);
    }
  }

  private setupEventListeners(): void {
    if (!this.ws) return;

    this.ws.onopen = () => {
      console.log("WebSocket connected");
      this.reconnectAttempts = 0;
      this.updateStatus({ isConnected: true, reconnectAttempts: 0 });
      this.startHeartbeat();
      this.notifyHandlers({ type: "connected", timestamp: new Date() });
    };

    this.ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data) as WebSocketMessage;
        console.log("WebSocket message received:", message);
        this.notifyHandlers(message);
      } catch (error) {
        console.error("Failed to parse WebSocket message:", error);
      }
    };

    this.ws.onerror = (error) => {
      console.error("WebSocket error:", error);
      this.handleError(new Error("WebSocket error occurred"));
    };

    this.ws.onclose = (event) => {
      console.log("WebSocket disconnected:", event.code, event.reason);
      this.updateStatus({
        isConnected: false,
        reconnectAttempts: this.reconnectAttempts,
      });
      this.stopHeartbeat();
      this.notifyHandlers({ type: "disconnected", timestamp: new Date() });

      if (
        !event.wasClean &&
        this.reconnectAttempts < this.maxReconnectAttempts
      ) {
        this.attemptReconnect();
      }
    };
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.send({ type: "ping" });
      }
    }, this.heartbeatInterval);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private attemptReconnect(): void {
    if (this.reconnectTimer) return;

    this.reconnectAttempts++;
    const delay = Math.min(
      this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
      30000,
    );

    console.log(
      `Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  disconnect(): void {
    this.stopHeartbeat();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, "Client disconnect");
      this.ws = null;
    }

    this.updateStatus({ isConnected: false, reconnectAttempts: 0 });
  }

  send(data: any): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    } else {
      console.warn("WebSocket is not connected. Message not sent:", data);
    }
  }

  sendMessage(message: Partial<Message>): void {
    this.send({
      type: "message",
      payload: message,
      timestamp: new Date(),
    });
  }

  sendTypingIndicator(conversationId: string, isTyping: boolean): void {
    this.send({
      type: "typing",
      conversationId,
      payload: { isTyping },
      timestamp: new Date(),
    });
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.add(handler);
    // Immediately notify the handler of current status
    handler(this.status);
    return () => this.statusHandlers.delete(handler);
  }

  private notifyHandlers(message: WebSocketMessage): void {
    this.messageHandlers.forEach((handler) => {
      try {
        handler(message);
      } catch (error) {
        console.error("Error in message handler:", error);
      }
    });
  }

  private updateStatus(status: WebSocketStatus): void {
    this.status = status;
    this.statusHandlers.forEach((handler) => {
      try {
        handler(status);
      } catch (error) {
        console.error("Error in status handler:", error);
      }
    });
  }

  private handleError(error: Error): void {
    const errorStatus: WebSocketStatus = {
      isConnected: false,
      reconnectAttempts: this.reconnectAttempts,
      lastError: error.message,
    };
    this.updateStatus(errorStatus);
  }

  getStatus(): WebSocketStatus {
    return this.status;
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

// Export singleton instance
export const websocketService = new WebSocketService();

// Hook for React components
export const useWebSocket = () => {
  return websocketService;
};
