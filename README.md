# Notebook

A modern, responsive, and PWA-ready notebook application built with React, TypeScript, and Vite.

## Features

- **Responsive Design**: Mobile-friendly interface optimized for various screen sizes.
- **PWA Support**: Installable as a progressive web application for offline access.
- **Modern Stack**: Built using the latest React 19 and TypeScript.
- **Interactive UI**: Rich interactions powered by `motion`.
- **Keyboard Shortcuts**: Efficient navigation and note management.
- **Dark Mode**: Support for system-based and manual dark mode toggling.

## Tech Stack

- **Framework**: React 19
- **Build Tool**: Vite
- **Styling**: Tailwind CSS 4
- **Language**: TypeScript
- **State/Hooks**: Custom hooks for note management, auth, and synchronization.
- **UI Components**: Radix UI (Tooltip), Lucide React (Icons).

## Prerequisites

- Node.js (v24+ recommended)
- npm or pnpm

## Getting Started

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd notebook
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```

4. **Build for production**:
   ```bash
   npm run build
   ```

## Backend (Docker)

The project includes a backend service that can be run using Docker:

```bash
docker-compose up -d
```

## Scripts

- `npm run dev`: Starts the Vite development server.
- `npm run build`: Compiles the project using TypeScript and builds with Vite.
- `npm run lint`: Runs ESLint to check code quality.
- `npm run preview`: Previews the production build.
- `npm run check`: Runs diagnostic checks.
