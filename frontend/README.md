# Muse AI Studio — Frontend

React, TypeScript, and Vite frontend for Muse AI Studio. Includes the shared application shell, English and Vietnamese translations, and a Video Studio project list connected to the FastAPI backend and SQLite. Muse account management is also available; other feature pages remain placeholders.

## Development

Requires Node.js 22.12 or later and npm. Run the following commands from the `frontend/` directory:

```bash
npm ci
npm run dev
```

Start the backend in a second terminal (see [backend setup](../backend/README.md)), then open the URL printed by Vite (defaults to `http://localhost:5173`). Vite proxies `/api` to `http://127.0.0.1:18610`. To use a different backend, copy `.env.example` to `.env` and set `MUSE_API_TARGET`; restart Vite after changing it. This variable configures the development proxy and is not a client credential.

## Type Checking and Production Build

```bash
npm run typecheck
npm run build
```

The production build is written to `dist/`. `npm run preview` previews the static bundle; it does not provide the development API proxy. The planned deployment will serve these files through FastAPI in the same application container.

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

The project list uses the real local API. The global shell does not report simulated task or account counts.

## Video Studio Project List

- `/projects` loads the project-list feature on demand, using `GET /api/projects`. A fresh database starts empty.
- The list loads 24 projects per request from `GET /api/projects` and shows a "Load more" button with "Showing X of Y"; focus moves to the first newly loaded card. Search (debounced 250 ms), status filters, sorting, chip counts, and the featured project are computed by the server, so they cover every project, not only loaded pages. Search is case- and accent-insensitive. Sorting supports recent updates, name, and longest duration first.
- Search, status, sorting, and the selected project use the `q`, `status`, `sort`, and `project` query parameters, so the view can be refreshed or shared.
- Project cards and the featured project open a detail sheet with metadata, the story idea, and available scene prompts via `GET /api/projects/{id}`. Loading, connection failures, and missing projects have separate states with retry controls.
- **New project** uses React Hook Form and Zod, then saves with `POST /api/projects`. SQLite persists drafts across page reloads and backend restarts. A failed save preserves the form input. Submitting disables dismissal and duplicate submits; writes are never retried automatically.
- The script editor supports manual scene planning and AI-generated script proposals. Video rendering and playback are not implemented yet.
- The trash button on each card, or **Delete project** in the detail sheet, opens a confirmation naming the project. Confirming deletes its saved script and scenes. Running projects must be stopped first. Failed requests keep the dialog open for retry; successful deletion clears the selection and refreshes counts and pagination from the first page.
- Project names, ideas, and scene prompts are user content; switching interface language does not translate that content.

Feature structure:

```text
src/features/projects/
  components/            Cards, filters, featured project, draft dialog, detail sheet
  api/                  Typed API parsing and query keys
  hooks/                Server queries/mutation and view state
  lib/project-list.ts    Query-parameter parsing for filter and sort
  constants.ts          Statuses, filter/sort options, query keys, and cover styles
  schemas.ts            Zod schemas for drafts and API project responses
  types.ts              Shared project types
src/pages/projects-page.tsx
```

TanStack Query manages server data and cache updates; the project list uses `useInfiniteQuery` with the API's `nextCursor`. List items are summaries without `idea` and `scenes`; the detail sheet fetches the full project. Demo projects from earlier builds that remain in browser storage are neither read, imported into SQLite, nor deleted. Only UI preferences continue to use local storage. API paths live in `src/constants/api.ts`, separately from frontend routes.

## Script Editor

Open a project, then select **Write script** (or **Edit script** for a saved script).

- An empty outline divides the target duration into 10-second scenes and a final 5-second scene when needed. This creates fields to fill in; it does not generate AI content.
- Add, remove, and reorder up to 30 scenes. Each scene has a title, visual prompt, duration (5 or 10 seconds), and optional narration. Shared character and visual style descriptions are optional.
- Every scene needs a title and visual prompt. The total duration must match the project's target before saving.
- **Save script** persists the entire script through `PUT /api/projects/{id}/script`. The project becomes ready for review; rendering does not start.
- Only drafts and projects awaiting review can be edited. Concurrent saves use `scriptRevision` to prevent overwrites. A conflict refreshes the project data and keeps the current form; close and reopen the editor to load the latest saved version.
- Failed saves preserve form input. Closing a changed editor asks whether to discard the changes; submitting blocks dismissal and duplicate submits. Unsaved input is not persisted across a page reload.
- Successful saves refresh list summaries, scene counts, and featured scene titles while preserving the existing server pagination and filters.

`use-script-editor.ts` owns form and mutation behavior. `lib/project-script.ts` builds outlines and form values; UI text stays in the English and Vietnamese locale files.

## Muse Accounts

Open `/accounts` from the shared navigation.

- Import one account at a time with a label and session cookies. Supported formats are a Cookie header, a flat JSON cookie object, or a browser cookie JSON array. Include a nonempty `hatch_sess` cookie.
- Search labels without case or accents, filter enabled/disabled accounts, rename a label, enable/disable an account, or delete its stored session with confirmation. Deleting an account leaves video projects unchanged.
- New imports begin **Not verified**. Use **Test** to verify a session before selecting it for AI script generation. Enabling an account is an independent preference; the generator requires both an enabled account and a verified session.
- Cookie input exists only in the import form and request; it is cleared on close or success. It is never saved to browser storage, a TanStack query, or mutation variables. Failed imports keep input for correction or retry while the form remains open.
- Account responses contain public metadata only. No cookie reveal or export action is exposed.

`src/features/accounts/` keeps API parsing, list helpers, hooks, and UI components separate. API paths live in `src/constants/api.ts`; interface text lives in both locale files.

## AI Script Generation

1. Import a Muse session under **Muse accounts**, enable it, and use **Test** to verify it.
2. Open a project and choose **Generate with AI**. Enter its idea and select the verified account.
3. Start generation. The task runs in the background; close and reopen the dialog or reload the page to see its latest state.
4. Review the generated character description, visual style, and scene prompts. **Apply this script** saves the proposal using the original script revision. It never overwrites a newer manual edit.

The saved script remains intact until a proposal is applied. Stopping a task preserves the saved script; it cannot retract a message already submitted to Muse. A new generation request may consume additional quota. Interrupted or timed-out requests are not resent automatically.

Script generation hooks, API parsing and UI live within `src/features/projects/`. The interface uses English and Vietnamese locale resources. Live provider compatibility depends on the Muse browser UI; local integration checks use the committed Postman planner fixture without real account credentials.

## Code Conventions

- Use `ActionBar` from `src/components/ui/action-bar.tsx` for page and form actions. Align groups to the right, place secondary actions before the primary action, and preserve that order on narrow screens. Dialog and sheet footers follow the same rule.

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
