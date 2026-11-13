# Muse AI Studio — Frontend

Frontend scaffold built with React, TypeScript, and Vite. The current setup includes the core configuration and a placeholder page. The application UI and backend integration will be implemented in later steps.

## Development

Requires Node.js 22.12 or later and npm. Run the following commands from the `frontend/` directory:

```bash
npm ci
npm run dev
```

Open the URL printed by Vite in the terminal (defaults to `http://localhost:5173`).

## Type Checking and Production Build

```bash
npm run typecheck
npm run build
```

The production build is written to `dist/`. Run `npm run preview` to preview it locally. The planned deployment will serve these files through FastAPI in the same application container.

## Libraries

- React + TypeScript, Vite.
- Tailwind CSS and shadcn/ui configuration.
- React Router, TanStack Query.
- React Hook Form, Zod, and `@hookform/resolvers`.
- Lucide React.

`src/app/providers.tsx` configures the router and `QueryClientProvider`. The `@/` import alias resolves to `src/` in both Vite and TypeScript.

Add shadcn components as needed when implementing the UI:

```bash
npx shadcn@latest add button
```

## Documentation

- [Vite](https://vite.dev/guide/).
- [Tailwind CSS with Vite](https://tailwindcss.com/docs/installation/using-vite).
- [shadcn/ui with Vite](https://ui.shadcn.com/docs/installation/vite).
