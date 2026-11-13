# Muse AI Studio — Frontend

React, TypeScript, and Vite frontend for Muse AI Studio. The first implementation step provides a shared application shell matching the design: dark theme, amber accent, bundled typography, English and Vietnamese translations, responsive navigation, page routing, and a navigation search dialog. Feature pages are placeholders; product workflows and backend integration come next.

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
- i18next and react-i18next.

`src/app/providers.tsx` configures the router and `QueryClientProvider`. The `@/` import alias resolves to `src/` in both Vite and TypeScript.

Add shadcn components as needed when implementing the UI:

```bash
npx shadcn@latest add button
```

## Application Shell

- `/` redirects to `/projects` (Video Studio).
- Route paths are defined in `src/constants/routes.ts`. Navigation groups, page IDs, and icons live in `src/app/navigation.ts`; translated text lives in `src/i18n/locales/`.
- `src/components/layout/app-layout.tsx` hosts the shared sidebar, header, and route outlet.
- Layout follows the design breakpoints (`tablet` = 820px, `desktop` = 1180px in `src/index.css`, mirrored in `src/constants/breakpoints.ts`): a 232px sidebar at desktop width, a 64px icon rail on tablets, and a bottom tab bar with a "More" sheet on phones.
- Desktop navigation can be collapsed to the rail; `useLocalStorage` persists the preference and subscribes to updates in the same page and other tabs.
- Each page sets its document title with `useDocumentTitle`.
- Press `Ctrl+K` or `Cmd+K` to find a page. Search is case- and accent-insensitive. Press Enter to open the first match or Tab to select another result.
- `src/components/shared/page-header.tsx` provides the shared page heading.
- `src/pages/workspace-page.tsx` holds temporary route content until feature pages are built. Unknown URLs show a 404 page.
- Theme tokens in `src/index.css` mirror `design/design-system/muse.css`: surfaces, `muted-foreground` (secondary text), `faint` (labels and placeholders), primary hover/press, and the `running`, `success`, `warning`, `destructive`, and `danger` status colors. Be Vietnam Pro and JetBrains Mono are bundled.
- `src/components/ui/button.tsx` uses the design button sizes (36px default, 44px on phones) and variants, including `danger` for solid destructive actions in dialogs.

The shell currently makes no API requests and shows no simulated task or account counts.

## Code Conventions

- Write documentation, comments, and identifiers in English. Keep user-facing copy in the English and Vietnamese locale files rather than in components or navigation configuration.
- Use `ROUTES` from `src/constants/routes.ts` instead of repeating route strings in components or navigation configuration.
- Keep reusable, framework-independent helpers in `src/lib/`, such as `normalizeSearchText` in `src/lib/string.ts` and browser storage helpers in `src/lib/storage.ts`.
- Keep shared constants in `src/constants/`. Storage keys live in `src/constants/storage.ts`.
- Keep handlers that depend on component state inside the component; extract reusable React behavior into hooks when needed.
- Access local storage through `useLocalStorage` from `src/hooks/use-local-storage.ts` in React components. Use JSON-serializable values and functional updates when the next value depends on the current value. Storage utilities handle serialization and browser access; preferences fall back to memory when persistence is unavailable.

```tsx
const [collapsed, setCollapsed] = useLocalStorage(
  STORAGE_KEYS.SIDEBAR_COLLAPSED,
  false,
);

setCollapsed((previous) => !previous);
```

## React Compiler

React Compiler is enabled in development and production through `reactCompilerPreset` and `@rolldown/plugin-babel` in `vite.config.ts`. Prefer ordinary components and hooks; let the compiler manage memoization rather than adding `useMemo`, `useCallback`, or `React.memo` by default.

See the [official installation guide](https://react.dev/learn/react-compiler/installation) for the Vite integration.

## Internationalization

- `src/i18n/index.ts` initializes i18next before React renders. Both language resources are bundled locally.
- `src/i18n/locales/en.json` contains English translations; `src/i18n/locales/vi.json` contains Vietnamese translations. Keep their keys aligned.
- English is the default and fallback language. Use the language selector in the header to switch languages without changing the current route.
- `src/hooks/use-language.ts` persists the preference through `useLocalStorage`, synchronizes it across tabs, and updates the document language. Page titles and accessible labels are translated too.
- `src/i18n/i18next.d.ts` provides TypeScript checks for translation keys based on the English resources.
- Add new text to both locale files, then read it with `useTranslation`:

```tsx
const { t } = useTranslation();

return <h1>{t("pages.projects.title")}</h1>;
```

## Documentation

- [Vite](https://vite.dev/guide/).
- [Tailwind CSS with Vite](https://tailwindcss.com/docs/installation/using-vite).
- [shadcn/ui with Vite](https://ui.shadcn.com/docs/installation/vite).
