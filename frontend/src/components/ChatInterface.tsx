import {
  Box,
  Container,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Badge,
  Fab,
  Zoom,
  useTheme,
  useMediaQuery,
  Drawer,
} from "@mui/material";
import { Menu, History, Lightbulb, KeyboardArrowUp } from "@mui/icons-material";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { LoadingIndicator } from "./LoadingIndicator";
import { TemplateSelector } from "./TemplateSelector";
import { ConversationHistory } from "./ConversationHistory";
import type { Message, Conversation } from "../types";
import { useEffect, useRef, useState, useCallback } from "react";

interface ChatInterfaceProps {
  messages: Message[];
  onSendMessage: (message: string) => void;
  isLoading?: boolean;
  conversations?: Conversation[];
  currentConversationId?: string;
  onSelectConversation?: (conversationId: string) => void;
  onNewConversation?: () => void;
  onDeleteConversation?: (conversationId: string) => void;
}

export const ChatInterface: React.FC<ChatInterfaceProps> = ({
  messages,
  onSendMessage,
  isLoading = false,
  conversations = [],
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const [historyOpen, setHistoryOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const scrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleScroll = useCallback(() => {
    if (scrollContainerRef.current) {
      const { scrollTop } = scrollContainerRef.current;
      setShowScrollTop(scrollTop > 300);
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container) {
      container.addEventListener("scroll", handleScroll);
      return () => container.removeEventListener("scroll", handleScroll);
    }
  }, [handleScroll]);

  const handleTemplateSelect = (template: { query: string }) => {
    onSendMessage(template.query);
    setTemplatesOpen(false);
  };

  const handleHistoryToggle = () => {
    setHistoryOpen(!historyOpen);
  };

  const handleTemplatesToggle = () => {
    setTemplatesOpen(!templatesOpen);
  };

  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <AppBar position="static" elevation={1}>
        <Toolbar>
          <IconButton
            edge="start"
            color="inherit"
            aria-label="menu"
            onClick={handleHistoryToggle}
            sx={{ mr: 2 }}
          >
            <Badge badgeContent={conversations.length} color="error">
              <Menu />
            </Badge>
          </IconButton>

          <Typography variant="h6" component="div" sx={{ flexGrow: 1 }}>
            Validis Agent
          </Typography>

          <IconButton color="inherit" onClick={handleTemplatesToggle}>
            <Lightbulb />
          </IconButton>

          <IconButton color="inherit" onClick={handleHistoryToggle}>
            <History />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Container
        ref={scrollContainerRef}
        maxWidth="lg"
        sx={{
          flex: 1,
          overflowY: "auto",
          py: 3,
          display: "flex",
          flexDirection: "column",
          position: "relative",
        }}
      >
        {messages.length === 0 && !templatesOpen ? (
          <Box
            sx={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              gap: 3,
            }}
          >
            <Typography variant="h5" color="text.secondary" gutterBottom>
              Welcome to Validis Agent
            </Typography>
            <Typography
              variant="body1"
              color="text.secondary"
              align="center"
              sx={{ maxWidth: 600 }}
            >
              I can help you with lending portfolio analysis, audit procedures,
              and financial data validation. Start by typing a question or
              select a template to begin.
            </Typography>
            <Box
              sx={{
                display: "flex",
                gap: 2,
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <IconButton
                onClick={handleTemplatesToggle}
                sx={{
                  border: 2,
                  borderColor: "primary.main",
                  p: 2,
                }}
              >
                <Lightbulb color="primary" />
              </IconButton>
            </Box>
          </Box>
        ) : (
          <>
            {messages.map((message) => (
              <ChatMessage key={message.id} message={message} />
            ))}
            {isLoading && (
              <LoadingIndicator
                variant="typing"
                message="Validis Agent is thinking..."
              />
            )}
          </>
        )}
        <div ref={messagesEndRef} />
      </Container>

      <Zoom in={showScrollTop}>
        <Fab
          color="primary"
          size="small"
          aria-label="scroll to top"
          onClick={scrollToTop}
          sx={{
            position: "absolute",
            bottom: 100,
            right: 16,
          }}
        >
          <KeyboardArrowUp />
        </Fab>
      </Zoom>

      <ChatInput onSendMessage={onSendMessage} disabled={isLoading} />

      {/* Conversation History Drawer */}
      <ConversationHistory
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        conversations={conversations}
        currentConversationId={currentConversationId}
        onSelectConversation={(id) => {
          onSelectConversation?.(id);
          setHistoryOpen(false);
        }}
        onNewConversation={() => {
          onNewConversation?.();
          setHistoryOpen(false);
        }}
        onDeleteConversation={(id) => {
          onDeleteConversation?.(id);
        }}
      />

      {/* Templates Drawer */}
      <Drawer
        anchor={isMobile ? "bottom" : "right"}
        open={templatesOpen}
        onClose={() => setTemplatesOpen(false)}
        sx={{
          "& .MuiDrawer-paper": {
            width: isMobile ? "100%" : 600,
            maxHeight: isMobile ? "80vh" : "100vh",
          },
        }}
      >
        <TemplateSelector onSelectTemplate={handleTemplateSelect} />
      </Drawer>
    </Box>
  );
};
