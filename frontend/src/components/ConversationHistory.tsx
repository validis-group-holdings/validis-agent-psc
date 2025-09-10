import React, { useEffect, useState } from "react";
import {
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Typography,
  IconButton,
  Box,
  Divider,
  TextField,
  InputAdornment,
  Chip,
  Menu,
  MenuItem,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
} from "@mui/material";
import {
  ChatBubbleOutline,
  Search,
  Delete,
  MoreVert,
  Add,
  Download,
  Archive,
} from "@mui/icons-material";
import type { Conversation } from "../types";

interface ConversationHistoryProps {
  open: boolean;
  onClose: () => void;
  conversations: Conversation[];
  currentConversationId?: string;
  onSelectConversation: (conversationId: string) => void;
  onNewConversation: () => void;
  onDeleteConversation: (conversationId: string) => void;
}

export const ConversationHistory: React.FC<ConversationHistoryProps> = ({
  open,
  onClose,
  conversations,
  currentConversationId,
  onSelectConversation,
  onNewConversation,
  onDeleteConversation,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filteredConversations, setFilteredConversations] = useState<
    Conversation[]
  >([]);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [selectedConversation, setSelectedConversation] =
    useState<Conversation | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [conversationToDelete, setConversationToDelete] = useState<
    string | null
  >(null);

  useEffect(() => {
    const filtered = conversations.filter((conv) => {
      const searchLower = searchQuery.toLowerCase();
      return (
        conv.title.toLowerCase().includes(searchLower) ||
        conv.messages.some((msg) =>
          msg.content.toLowerCase().includes(searchLower),
        )
      );
    });
    setFilteredConversations(filtered);
  }, [conversations, searchQuery]);

  const handleMenuOpen = (
    event: React.MouseEvent<HTMLElement>,
    conversation: Conversation,
  ) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
    setSelectedConversation(conversation);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
    setSelectedConversation(null);
  };

  const handleDeleteClick = (conversationId: string) => {
    setConversationToDelete(conversationId);
    setDeleteDialogOpen(true);
    handleMenuClose();
  };

  const handleDeleteConfirm = () => {
    if (conversationToDelete) {
      onDeleteConversation(conversationToDelete);
    }
    setDeleteDialogOpen(false);
    setConversationToDelete(null);
  };

  const handleExport = (conversation: Conversation) => {
    const dataStr = JSON.stringify(conversation, null, 2);
    const dataUri =
      "data:application/json;charset=utf-8," + encodeURIComponent(dataStr);
    const exportFileDefaultName = `conversation-${conversation.id}.json`;

    const linkElement = document.createElement("a");
    linkElement.setAttribute("href", dataUri);
    linkElement.setAttribute("download", exportFileDefaultName);
    linkElement.click();
    handleMenuClose();
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const conversationDate = new Date(date);
    const diffInHours =
      (now.getTime() - conversationDate.getTime()) / (1000 * 60 * 60);

    if (diffInHours < 1) {
      return "Just now";
    } else if (diffInHours < 24) {
      return `${Math.floor(diffInHours)} hours ago`;
    } else if (diffInHours < 168) {
      return `${Math.floor(diffInHours / 24)} days ago`;
    } else {
      return conversationDate.toLocaleDateString();
    }
  };

  const getConversationSummary = (conversation: Conversation) => {
    const lastMessage = conversation.messages[conversation.messages.length - 1];
    if (!lastMessage) return "No messages";

    const content = lastMessage.content;
    return content.length > 100 ? content.substring(0, 100) + "..." : content;
  };

  return (
    <>
      <Drawer
        anchor="left"
        open={open}
        onClose={onClose}
        sx={{
          "& .MuiDrawer-paper": {
            width: 320,
            boxSizing: "border-box",
          },
        }}
      >
        <Box sx={{ p: 2 }}>
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              mb: 2,
            }}
          >
            <Typography variant="h6">Conversations</Typography>
            <IconButton color="primary" onClick={onNewConversation}>
              <Add />
            </IconButton>
          </Box>

          <TextField
            fullWidth
            size="small"
            placeholder="Search conversations..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Search />
                </InputAdornment>
              ),
            }}
            sx={{ mb: 2 }}
          />

          <Box sx={{ display: "flex", gap: 1, mb: 2, flexWrap: "wrap" }}>
            <Chip size="small" label="All" variant="filled" color="primary" />
            <Chip size="small" label="Recent" variant="outlined" />
            <Chip size="small" label="Archived" variant="outlined" />
          </Box>
        </Box>

        <Divider />

        <List sx={{ flex: 1, overflowY: "auto" }}>
          {filteredConversations.length === 0 ? (
            <Box sx={{ p: 3, textAlign: "center" }}>
              <Typography variant="body2" color="text.secondary">
                {searchQuery
                  ? "No conversations found"
                  : "No conversations yet"}
              </Typography>
            </Box>
          ) : (
            filteredConversations.map((conversation) => (
              <ListItem
                key={conversation.id}
                disablePadding
                secondaryAction={
                  <IconButton
                    edge="end"
                    onClick={(e) => handleMenuOpen(e, conversation)}
                  >
                    <MoreVert />
                  </IconButton>
                }
                sx={{
                  backgroundColor:
                    currentConversationId === conversation.id
                      ? "action.selected"
                      : "transparent",
                }}
              >
                <ListItemButton
                  onClick={() => onSelectConversation(conversation.id)}
                >
                  <ListItemIcon>
                    <ChatBubbleOutline />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Typography variant="subtitle2" noWrap>
                        {conversation.title}
                      </Typography>
                    }
                    secondary={
                      <Box>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            display: "-webkit-box",
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: "vertical",
                          }}
                        >
                          {getConversationSummary(conversation)}
                        </Typography>
                        <Typography variant="caption" color="text.disabled">
                          {formatDate(conversation.updatedAt)}
                        </Typography>
                      </Box>
                    }
                  />
                </ListItemButton>
              </ListItem>
            ))
          )}
        </List>

        <Divider />

        <Box sx={{ p: 2 }}>
          <Typography variant="caption" color="text.secondary">
            {filteredConversations.length} conversation
            {filteredConversations.length !== 1 ? "s" : ""}
          </Typography>
        </Box>
      </Drawer>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleMenuClose}
      >
        <MenuItem
          onClick={() =>
            selectedConversation && handleExport(selectedConversation)
          }
        >
          <Download fontSize="small" sx={{ mr: 1 }} />
          Export
        </MenuItem>
        <MenuItem onClick={handleMenuClose}>
          <Archive fontSize="small" sx={{ mr: 1 }} />
          Archive
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() =>
            selectedConversation && handleDeleteClick(selectedConversation.id)
          }
          sx={{ color: "error.main" }}
        >
          <Delete fontSize="small" sx={{ mr: 1 }} />
          Delete
        </MenuItem>
      </Menu>

      <Dialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
      >
        <DialogTitle>Delete Conversation?</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete this conversation? This action
            cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
          <Button
            onClick={handleDeleteConfirm}
            color="error"
            variant="contained"
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};
