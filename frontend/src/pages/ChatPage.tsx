import React, { useEffect } from "react";
import { ChatInterface } from "../components/ChatInterface";
import { useChatWithPersistence } from "../hooks/useChatWithPersistence";
import { Snackbar, Alert } from "@mui/material";

export const ChatPage: React.FC = () => {
  const {
    messages,
    conversations,
    currentConversationId,
    sendMessage,
    selectConversation,
    createNewConversation,
    deleteConversation,
    isLoading,
    error,
    isConnected,
  } = useChatWithPersistence();

  const [showConnectionStatus, setShowConnectionStatus] = React.useState(false);

  useEffect(() => {
    // Show connection status briefly when it changes
    setShowConnectionStatus(true);
    const timer = setTimeout(() => setShowConnectionStatus(false), 3000);
    return () => clearTimeout(timer);
  }, [isConnected]);

  return (
    <>
      <ChatInterface
        messages={messages}
        conversations={conversations}
        currentConversationId={currentConversationId || undefined}
        onSendMessage={sendMessage}
        onSelectConversation={selectConversation}
        onNewConversation={createNewConversation}
        onDeleteConversation={deleteConversation}
        isLoading={isLoading}
      />

      {/* Connection Status Notification */}
      <Snackbar
        open={showConnectionStatus}
        autoHideDuration={3000}
        onClose={() => setShowConnectionStatus(false)}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      >
        <Alert
          severity={isConnected ? "success" : "warning"}
          onClose={() => setShowConnectionStatus(false)}
        >
          {isConnected
            ? "Connected to Validis Agent"
            : "Working in offline mode"}
        </Alert>
      </Snackbar>

      {/* Error Notification */}
      {error && (
        <Snackbar
          open={!!error}
          autoHideDuration={6000}
          onClose={() => {}}
          anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        >
          <Alert severity="error" onClose={() => {}}>
            {error}
          </Alert>
        </Snackbar>
      )}
    </>
  );
};
