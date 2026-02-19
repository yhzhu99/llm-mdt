# llm-mdt

`llm-mdt` is a lightweight local web app that treats multiple large language models as a **multidisciplinary team (MDT)**: models first answer independently, then **anonymously** peer-review and rank each other, and finally a designated **Chairman** model synthesizes a single best-possible response.

At a high level, the pipeline is:

1. **Stage 1 — First opinions.** Query all council models in parallel and display each response in a tab view.
2. **Stage 2 — Anonymous peer review.** Re-label responses as *Response A/B/C...* so reviewers cannot play favorites; collect critiques and rankings in a strict, parseable format.
3. **Stage 3 — Final synthesis.** A Chairman model produces the final answer using the Stage 1 responses plus Stage 2 evaluations.

## Background

The core idea—LLM-driven multi-agent collaboration for “team-style” reasoning—was explored earlier in our work **ColaCare** (published at **WWW 2025**):

- Paper: *ColaCare: Enhancing Electronic Health Record Modeling through Large Language Model-Driven Multi-Agent Collaboration*
- arXiv: `https://arxiv.org/abs/2410.02551`

## Features

- **Local, ChatGPT-like UI** with transparent inspection of all intermediate outputs
- **Anonymized peer review** in Stage 2 to reduce identity bias
- **Graceful degradation:** continues even if some model calls fail
- **JSON conversation storage** in `data/conversations/`

## Setup

### 1. Install Dependencies

The project uses [uv](https://docs.astral.sh/uv/) for project management.

**Backend:**
```bash
cd backend
uv sync
```

**Frontend:**
```bash
cd frontend
npm install
cd ..
```

### 2. Configure API Key

Create a `.env` file in the project root:

```bash
OPENROUTER_API_KEY=sk-or-v1-...
```

Get your API key at [openrouter.ai](https://openrouter.ai/). Make sure to purchase the credits you need, or sign up for automatic top up.

### 2.1 Configure API Base URL (OpenRouter / ZenMax)

This project uses an **OpenAI-compatible** Chat Completions endpoint. By default you can use **OpenRouter** directly, or route requests via **ZenMax** (as an API relay).

- OpenRouter base URL (recommended default):
  - `https://openrouter.ai/api/v1/chat/completions`
- ZenMax base URL (relay):
  - `https://zenmux.ai/api/v1/chat/completions`

If your deployment supports it, set the base URL via environment variable or update `backend/config.py` (`OPENROUTER_API_URL`) to point to the endpoint you want.

### 3. Configure Models (Optional)

Edit `backend/config.py` to customize the council:

```python
COUNCIL_MODELS = [
    "openai/gpt-5.1",
    "google/gemini-3-pro-preview",
    "anthropic/claude-sonnet-4.5",
    "x-ai/grok-4",
]

CHAIRMAN_MODEL = "google/gemini-3-pro-preview"
```

## Running the Application

**Option 1: Use the start script**
```bash
./start.sh
```

**Option 2: Run manually**

Terminal 1 (Backend):
```bash
uv run python -m backend.main
```

Terminal 2 (Frontend):
```bash
cd frontend
npm run dev
```

Then open http://localhost:5173 in your browser.

## Tech Stack

- **Backend:** FastAPI (Python 3.10+), async httpx, OpenRouter API
- **Frontend:** React + Vite, react-markdown for rendering
- **Storage:** JSON files in `data/conversations/`
- **Package Management:** uv for Python, npm for JavaScript

## Acknowledgements

This project is based on and adapted from Andrej Karpathy's open-source project `llm-council`:

- `https://github.com/karpathy/llm-council`
