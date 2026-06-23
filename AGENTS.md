# Repository Guidelines

## Project Structure & Module Organization

This repository is a Vite-powered React/TypeScript single-page chat app. The entry points are `index.tsx` and `App.tsx`. Reusable UI lives in `components/`, with larger app shells under `components/app/`, chat-specific pieces under `components/chat/`, settings under `components/settings/`, and shared wrappers in `components/common/`. State and localization providers are in `contexts/`, custom hooks in `hooks/`, API/storage/business logic in `services/`, shared helpers in `utils/`, and seed data in `data/`. Static assets, icons, screenshots, and the PWA manifest are in `public/`.

## Build, Run, and Deployment Commands

- `npm install`: install dependencies from `package-lock.json`.
- `npm run dev`: start the local Vite development server.
- `npm run build`: create a production build in `dist/`.
- `npm run preview`: serve the production build locally for final checks.
- `docker compose up --build`: build and run the containerized app with the included Nginx config.

## Coding Style & Naming Conventions

Use TypeScript and React functional components. Match the surrounding file style: single quotes, semicolons, and 2-space indentation in TSX components. Name components in PascalCase (`MessageBubble.tsx`), hooks with the `use` prefix (`useChatData.ts`), and services with descriptive camelCase module names (`storageService.ts`). Prefer the `@/*` alias from `tsconfig.json` when it keeps imports clearer. Keep comments short and useful, especially around non-obvious UI state or persistence logic.

## Testing Guidelines

There is no automated test script or test framework configured yet. Before submitting changes, run `npm run build` and manually verify core flows with `npm run dev` or `npm run preview`: login/password handling, chat creation, message sending, settings, imports/exports, and PWA update behavior when relevant. If adding tests, colocate them near the code as `*.test.ts` or `*.test.tsx` and document the new test command in `package.json`.

## Commit & Pull Request Guidelines

Recent history uses concise Chinese-language summaries and occasional prefixes such as `fix:` and `refactor:`. Keep commits short, imperative, and scoped to one change, for example `fix: use fallback API config` or `refactor: simplify settings UI`. Pull requests should include a clear description, linked issue when available, screenshots or screen recordings for UI changes, environment/config notes, and the commands used for verification.

## Security & Configuration Tips

Copy `.env.example` for local configuration and never commit real API keys or passwords. Treat `VITE_*` values as client-visible because they are bundled into the browser app. Keep provider-specific API handling inside `services/llm/` and storage/privacy changes inside the existing service boundaries.
