import React from 'react';
import {
  Box,
  CircularProgress,
  Typography,
  LinearProgress,
  Fade,
  Paper,
} from '@mui/material';
import { keyframes } from '@mui/system';

interface LoadingIndicatorProps {
  message?: string;
  variant?: 'circular' | 'linear' | 'dots' | 'typing';
  size?: 'small' | 'medium' | 'large';
  showProgress?: boolean;
  progress?: number;
}

const dotPulse = keyframes`
  0%, 60%, 100% {
    opacity: 0.3;
    transform: scale(1);
  }
  30% {
    opacity: 1;
    transform: scale(1.2);
  }
`;

const typingDot = keyframes`
  0%, 60%, 100% {
    transform: translateY(0);
  }
  30% {
    transform: translateY(-10px);
  }
`;

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  message = 'Processing...',
  variant = 'circular',
  size = 'medium',
  showProgress = false,
  progress = 0,
}) => {
  const sizeMap = {
    small: 24,
    medium: 40,
    large: 56,
  };

  const renderCircular = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
      <CircularProgress size={sizeMap[size]} />
      {message && (
        <Typography variant="body2" color="text.secondary">
          {message}
        </Typography>
      )}
    </Box>
  );

  const renderLinear = () => (
    <Box sx={{ width: '100%', maxWidth: 400 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {message}
        </Typography>
      </Box>
      {showProgress && progress > 0 ? (
        <LinearProgress variant="determinate" value={progress} />
      ) : (
        <LinearProgress />
      )}
    </Box>
  );

  const renderDots = () => (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {[0, 1, 2].map((index) => (
        <Box
          key={index}
          sx={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            backgroundColor: 'primary.main',
            animation: `${dotPulse} 1.4s ease-in-out infinite`,
            animationDelay: `${index * 0.2}s`,
          }}
        />
      ))}
      {message && (
        <Typography variant="body2" color="text.secondary" sx={{ ml: 1 }}>
          {message}
        </Typography>
      )}
    </Box>
  );

  const renderTyping = () => (
    <Paper
      elevation={1}
      sx={{
        p: 2,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        backgroundColor: 'grey.100',
      }}
    >
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        {[0, 1, 2].map((index) => (
          <Box
            key={index}
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: 'text.secondary',
              animation: `${typingDot} 1.4s ease-in-out infinite`,
              animationDelay: `${index * 0.15}s`,
            }}
          />
        ))}
      </Box>
    </Paper>
  );

  const renderIndicator = () => {
    switch (variant) {
      case 'linear':
        return renderLinear();
      case 'dots':
        return renderDots();
      case 'typing':
        return renderTyping();
      default:
        return renderCircular();
    }
  };

  return (
    <Fade in timeout={300}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          p: 2,
        }}
      >
        {renderIndicator()}
      </Box>
    </Fade>
  );
};
