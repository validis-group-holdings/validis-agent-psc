# Validis Agent Frontend

React 18 + TypeScript frontend for the Validis Agent chat interface.

## Tech Stack

- **React 18** - UI framework
- **TypeScript** - Type safety
- **Vite** - Build tool
- **Material-UI** - Component library
- **React Router** - Routing

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
npm install
```

### Development

```bash
# Start development server on port 3000
npm run start

# Or use default Vite dev server
npm run dev
```

### Build

```bash
npm run build
```

### Scripts

- `npm run dev` - Start Vite dev server
- `npm run start` - Start dev server on port 3000
- `npm run build` - Build for production
- `npm run preview` - Preview production build
- `npm run lint` - Run ESLint
- `npm run type-check` - TypeScript type checking
- `npm run clean` - Clean build and dependencies

## Project Structure

```
src/
├── components/     # Reusable UI components
├── pages/         # Page components
├── services/      # API services
├── hooks/         # Custom React hooks
├── types/         # TypeScript type definitions
├── App.tsx        # Main app component
└── index.tsx      # Entry point
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

- `VITE_API_BASE_URL` - Backend API URL
- `VITE_WS_URL` - WebSocket server URL
- `VITE_ENABLE_DEBUG` - Enable debug mode