import {
  Box,
  Paper,
  Typography,
  Avatar,
  Chip,
  IconButton,
  Tooltip,
} from "@mui/material";
import {
  SmartToy,
  Person,
  ContentCopy,
  Check,
  Code,
} from "@mui/icons-material";
import type { Message } from "../types";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useState, useMemo } from "react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

interface ChatMessageProps {
  message: Message;
}

export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
  const isUser = message.role === "user";
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Custom components for markdown rendering
  const markdownComponents = useMemo(
    () => ({
      code({ node, inline, className, children, ...props }: any) {
        const match = /language-(\w+)/.exec(className || "");
        const language = match ? match[1] : "";

        if (!inline && language) {
          return (
            <Box sx={{ position: "relative", my: 2 }}>
              <Box
                sx={{
                  backgroundColor: "#1e1e1e",
                  borderRadius: 1,
                  overflow: "hidden",
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    px: 2,
                    py: 1,
                    backgroundColor: "#2d2d2d",
                    borderBottom: "1px solid #3e3e3e",
                  }}
                >
                  <Chip
                    label={language}
                    size="small"
                    icon={<Code />}
                    sx={{ height: 20 }}
                  />
                  <IconButton
                    size="small"
                    onClick={() => {
                      navigator.clipboard.writeText(
                        String(children).replace(/\n$/, ""),
                      );
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    sx={{ color: "grey.400" }}
                  >
                    {copied ? (
                      <Check fontSize="small" />
                    ) : (
                      <ContentCopy fontSize="small" />
                    )}
                  </IconButton>
                </Box>
                <SyntaxHighlighter
                  language={language}
                  style={vscDarkPlus}
                  customStyle={{
                    margin: 0,
                    padding: "1rem",
                    backgroundColor: "transparent",
                  }}
                  {...props}
                >
                  {String(children).replace(/\n$/, "")}
                </SyntaxHighlighter>
              </Box>
            </Box>
          );
        }

        return (
          <Box
            component="code"
            sx={{
              backgroundColor: "grey.100",
              px: 0.5,
              py: 0.25,
              borderRadius: 0.5,
              fontFamily: "monospace",
              fontSize: "0.875em",
            }}
            {...props}
          >
            {children}
          </Box>
        );
      },
      table({ children }: any) {
        return (
          <Box sx={{ overflowX: "auto", my: 2 }}>
            <Box
              component="table"
              sx={{
                minWidth: "100%",
                borderCollapse: "collapse",
                "& th, & td": {
                  border: "1px solid",
                  borderColor: "divider",
                  padding: 1,
                },
                "& th": {
                  backgroundColor: "grey.100",
                  fontWeight: "bold",
                },
              }}
            >
              {children}
            </Box>
          </Box>
        );
      },
      blockquote({ children }: any) {
        return (
          <Box
            component="blockquote"
            sx={{
              borderLeft: 4,
              borderColor: "primary.main",
              pl: 2,
              ml: 0,
              my: 2,
              color: "text.secondary",
              fontStyle: "italic",
            }}
          >
            {children}
          </Box>
        );
      },
      a({ href, children }: any) {
        return (
          <Box
            component="a"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            sx={{
              color: "primary.main",
              textDecoration: "underline",
              "&:hover": {
                textDecoration: "none",
              },
            }}
          >
            {children}
          </Box>
        );
      },
      ul({ children }: any) {
        return (
          <Box component="ul" sx={{ pl: 3, my: 1 }}>
            {children}
          </Box>
        );
      },
      ol({ children }: any) {
        return (
          <Box component="ol" sx={{ pl: 3, my: 1 }}>
            {children}
          </Box>
        );
      },
      li({ children }: any) {
        return (
          <Box component="li" sx={{ my: 0.5 }}>
            {children}
          </Box>
        );
      },
    }),
    [copied],
  );

  return (
    <Box
      sx={{
        display: "flex",
        gap: 2,
        mb: 2,
        flexDirection: isUser ? "row-reverse" : "row",
      }}
    >
      <Avatar
        sx={{
          bgcolor: isUser ? "primary.main" : "secondary.main",
          width: 36,
          height: 36,
        }}
      >
        {isUser ? <Person /> : <SmartToy />}
      </Avatar>

      <Paper
        elevation={1}
        sx={{
          p: 2,
          maxWidth: "70%",
          backgroundColor: isUser ? "primary.light" : "background.paper",
          color: isUser ? "primary.contrastText" : "text.primary",
          position: "relative",
          "& .markdown-content": {
            "& > *:first-of-type": {
              mt: 0,
            },
            "& > *:last-child": {
              mb: 0,
            },
          },
        }}
      >
        {!isUser && (
          <Tooltip title={copied ? "Copied!" : "Copy message"}>
            <IconButton
              size="small"
              onClick={handleCopy}
              sx={{
                position: "absolute",
                top: 8,
                right: 8,
                opacity: 0.6,
                "&:hover": {
                  opacity: 1,
                },
              }}
            >
              {copied ? (
                <Check fontSize="small" />
              ) : (
                <ContentCopy fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        )}

        {isUser ? (
          <Typography variant="body1" sx={{ whiteSpace: "pre-wrap" }}>
            {message.content}
          </Typography>
        ) : (
          <Box className="markdown-content">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={markdownComponents}
            >
              {message.content}
            </ReactMarkdown>
          </Box>
        )}

        <Typography
          variant="caption"
          sx={{
            display: "block",
            mt: 1,
            opacity: 0.7,
          }}
        >
          {new Date(message.timestamp).toLocaleTimeString()}
        </Typography>
      </Paper>
    </Box>
  );
};
