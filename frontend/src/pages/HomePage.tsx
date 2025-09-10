import { Box, Container, Typography, Button, Paper } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { Chat } from '@mui/icons-material';

export const HomePage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <Container maxWidth="md">
      <Box sx={{ mt: 8, textAlign: 'center' }}>
        <Typography variant="h2" component="h1" gutterBottom>
          Welcome to Validis Agent
        </Typography>
        <Typography variant="h5" color="text.secondary" paragraph>
          Your AI-powered audit assistant
        </Typography>

        <Paper elevation={3} sx={{ p: 4, mt: 4 }}>
          <Typography variant="body1" paragraph>
            Validis Agent helps streamline your audit workflow with intelligent automation,
            risk assessment, and real-time collaboration features.
          </Typography>

          <Button
            variant="contained"
            size="large"
            startIcon={<Chat />}
            onClick={() => navigate('/chat')}
            sx={{ mt: 2 }}
          >
            Start Chat
          </Button>
        </Paper>
      </Box>
    </Container>
  );
};
