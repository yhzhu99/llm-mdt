<div align="center">
  <img src="public/banner.svg" alt="LLM MDT Banner" width="100%" />

  <h1>LLM MDT (Multi-Disciplinary Team)</h1>

  <p><b>A frontend-only MDT app for comparing, reviewing, and synthesizing LLM answers directly in the browser.</b></p>

  <p>
    <a href="https://github.com/yhzhu99/llm-mdt/stargazers"><img src="https://img.shields.io/github/stars/yhzhu99/llm-mdt?style=flat-square&color=blue" alt="Stars"></a>
    <a href="https://github.com/yhzhu99/llm-mdt/network/members"><img src="https://img.shields.io/github/forks/yhzhu99/llm-mdt?style=flat-square&color=blue" alt="Forks"></a>
    <img src="https://img.shields.io/badge/Frontend-React%20%2B%20Vite-61dafb?style=flat-square&logo=react&logoColor=black" alt="React">
    <img src="https://img.shields.io/badge/Deploy-Cloudflare%20Pages-f38020?style=flat-square&logo=cloudflare&logoColor=white" alt="Cloudflare Pages">
  </p>
</div>

---

## What Changed

`llm-mdt` is now a **browser-only** application:

- No Python backend
- No server-side storage
- No environment-variable setup for provider secrets
- No deployment dependency beyond serving static files

The full MDT pipeline now runs in the frontend:

1. **Stage 1:** each council model answers independently
2. **Stage 2:** models rank anonymized responses
3. **Stage 3:** the chairman synthesizes the final answer

Conversations and provider settings are stored locally in the browser using IndexedDB, so the app can be deployed as a static site on Cloudflare Pages.

## Features

- **Frontend-only MDT orchestration** with no runtime backend
- **Anonymized peer review** to reduce model-name bias
- **Streaming stage updates** for Stage 1, Stage 2, and Stage 3
- **Local persistence** for chats, rankings, and trace metadata
- **Provider configuration in the browser** for base URL, API key, council models, chairman model, and optional headers
- **Cloudflare Pages friendly** static deployment

## Important Security Note

This version intentionally stores provider settings **only in the local browser** because it is designed for personal/self-hosted usage.

That means:

- your API key is **not** sent to a project backend
- your API key **is still accessible in the browser** to anyone with access to that device/session
- your provider endpoint must allow **direct browser CORS requests**

This is convenient, but it is **not a secure secret-management model for shared or public-trust deployments**.

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Start the app

```bash
./start.sh
```

Or run Vite directly:

```bash
npm run dev
```

Open `http://localhost:5173`.

### 3. Configure your provider in the UI

Click **Settings** and enter:

- an OpenAI-compatible chat completions URL
- your API key
- one model per line for the council
- the chairman model
- optionally a separate title model
- optionally extra headers such as `HTTP-Referer` or `X-Title`

Example base URLs:

- `https://openrouter.ai/api/v1/chat/completions`
- any other browser-capable OpenAI-compatible endpoint you control

## Local Storage Model

The browser stores:

- provider settings
- conversations
- stage traces and ranking metadata

Nothing is persisted on a project backend.

## Scripts

From the repo root:

- `npm run dev` — local development
- `npm run build` — production build
- `npm run preview` — preview the built app
- `npm run lint` — ESLint
- `npm run test` — Vitest

## Deploy to Cloudflare Pages

Use the repo root as the build root:

- **Build command:** `npm run build`
- **Build output directory:** `dist`

No server functions or backend services are required.

## Background

The core idea—LLM-driven multi-agent collaboration for “team-style” reasoning—was explored in our published work:

- **Paper:** *ColaCare: Enhancing Electronic Health Record Modeling through Large Language Model-Driven Multi-Agent Collaboration* (**WWW 2025**)
- **arXiv:** `https://arxiv.org/abs/2410.02551`

This project keeps the MDT idea while shifting the entire runtime into a static frontend for simpler deployment.
