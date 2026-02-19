"""Configuration for the LLM Council."""

import os
from dotenv import load_dotenv

load_dotenv()

# OpenRouter API key
OPENROUTER_API_KEY = os.getenv("ZENMUX_API_KEY")

# Council members - list of OpenRouter model identifiers
COUNCIL_MODELS = [
    "openai/gpt-5.2",
    "google/gemini-3.1-pro-preview",
    # "anthropic/claude-opus-4.6"
]

# Chairman model - synthesizes final response
CHAIRMAN_MODEL = "google/gemini-3.1-pro-preview"

# OpenRouter API endpoint
OPENROUTER_API_URL = "https://zenmux.ai/api/v1/chat/completions"

# Data directory for conversation storage
DATA_DIR = "data/conversations"
