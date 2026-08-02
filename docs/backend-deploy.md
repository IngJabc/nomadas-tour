# Backend deploy

The backend runs compiled JavaScript from `backend/dist/`, built from `backend/src/`.

## Production start

```bash
cd backend
npm install
npm start
```

`npm start` runs **`prestart` → `npm run build` → `node dist/index.js`**, so `dist/` is always regenerated from current source before the server starts.

Development uses `npm run dev` (`tsx watch src/index.ts`) and does not require a manual build.

## Artifacts

- **`backend/dist/`** is listed in `.gitignore` and must **not** be committed.
- Deploy platforms must run `npm start` (or `npm run build` explicitly) — never ship a stale checked-in `dist/`.

## Environment

Configure `backend/.env` (see project docs). Required variables are validated at startup via `backend/src/config/env.ts`.
