# Rzutnik RPG – Frontend (React + Vite + Tailwind)

Współdzielone rzuty w czasie rzeczywistym, panel + okno dialogowe wyników (1/5 szerokości) oraz siatka do rysowania.

## Szybki start lokalnie
```bash
npm i
npm run dev
```
Domyślnie łączy się z `VITE_SOCKET_URL` (ustaw w `.env`, np. `http://localhost:3001`).

## Deploy na GitHub Pages
1. Ustaw secret **SOCKET_URL** na URL backendu (np. `https://twoj-serwer.onrender.com`).
2. Push do gałęzi `main`. Action zbuduje i opublikuje stronę.
3. `vite.config.js` ustawia `base` automatycznie na nazwę repo (przez `REPO_NAME`).

## Zmienne środowiskowe
- `VITE_SOCKET_URL` – URL Socket.IO serwera.
