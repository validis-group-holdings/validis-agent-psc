import { useState, KeyboardEvent } from 'react';
import { Box, TextField, IconButton, Paper } from '@mui/material';
import { Send, AttachFile } from '@mui/icons-material';

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
}

export const ChatInput: React.FC<ChatInputProps> = ({ onSendMessage, disabled = false }) => {
  const [message, setMessage] = useState('');

  const handleSend = () => {
    if (message.trim() && !disabled) {
      onSendMessage(message.trim());
      setMessage('');
    }
  };

  const handleKeyPress = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Paper
      elevation={3}
      sx={{
        p: 2,
        position: 'sticky',
        bottom: 0,
        backgroundColor: 'background.paper',
        borderTop: 1,
        borderColor: 'divider',
      }}
    >
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
        <IconButton size="small" disabled={disabled}>
          <AttachFile />
        </IconButton>

        <TextField
          fullWidth
          multiline
          maxRows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder="Type your message..."
          disabled={disabled}
          variant="outlined"
          size="small"
        />

        <IconButton
          color="primary"
          onClick={handleSend}
          disabled={disabled || !message.trim()}
        >
          <Send />
        </IconButton>
      </Box>
    </Paper>
  );
};
