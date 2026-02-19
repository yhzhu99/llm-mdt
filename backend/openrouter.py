"""OpenRouter API client for making LLM requests."""

import httpx
from typing import List, Dict, Any, Optional, AsyncIterator
from .config import OPENROUTER_API_KEY, OPENROUTER_API_URL


async def query_model(
    model: str,
    messages: List[Dict[str, Any]],
    timeout: float = 120.0
) -> Optional[Dict[str, Any]]:
    """
    Query a single model via OpenRouter API.

    Args:
        model: OpenRouter model identifier (e.g., "openai/gpt-4o")
        messages: List of message dicts with 'role' and 'content'
        timeout: Request timeout in seconds

    Returns:
        Response dict with 'content' and optional 'reasoning_details', or None if failed
    """
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }

    payload = {
        "model": model,
        "messages": messages,
        "reasoning_effort": "high",
    }

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(
                OPENROUTER_API_URL,
                headers=headers,
                json=payload
            )
            response.raise_for_status()

            data = response.json()
            message = data['choices'][0]['message']

            return {
                'content': message.get('content'),
                'reasoning_details': message.get('reasoning_details')
            }

    except Exception as e:
        print(f"Error querying model {model}: {e}")
        return None


async def query_model_stream(
    model: str,
    messages: List[Dict[str, Any]],
    timeout: float = 120.0,
) -> AsyncIterator[Dict[str, Any]]:
    """
    Stream a single model via OpenRouter API (OpenAI-compatible SSE).

    Yields dict events:
      - {"delta_type": "content", "text": "..."}
      - {"delta_type": "reasoning", "text": "..."}
      - {"delta_type": "final", "content": "...", "reasoning_details": ...}
      - {"delta_type": "error", "message": "..."}
    """
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
    }

    payload: Dict[str, Any] = {
        "model": model,
        "messages": messages,
        "reasoning_effort": "high",
        "stream": True,
    }

    content_acc = ""
    reasoning_acc = ""
    reasoning_details: Any = None

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                "POST",
                OPENROUTER_API_URL,
                headers=headers,
                json=payload,
            ) as response:
                response.raise_for_status()

                async for line in response.aiter_lines():
                    if not line:
                        continue
                    if not line.startswith("data:"):
                        continue

                    data_str = line[len("data:"):].strip()
                    if data_str == "[DONE]":
                        break

                    try:
                        data = httpx.Response(200, content=data_str).json()
                    except Exception:
                        continue

                    choices = data.get("choices") or []
                    if not choices:
                        continue
                    choice = choices[0] or {}

                    delta = (choice.get("delta") or {})
                    message = (choice.get("message") or {})

                    content_delta = delta.get("content")
                    if isinstance(content_delta, str) and content_delta:
                        content_acc += content_delta
                        yield {"delta_type": "content", "text": content_delta}

                    reasoning_delta = (
                        delta.get("reasoning")
                        or delta.get("thinking")
                        or delta.get("reasoning_content")
                    )
                    if isinstance(reasoning_delta, str) and reasoning_delta:
                        reasoning_acc += reasoning_delta
                        yield {"delta_type": "reasoning", "text": reasoning_delta}

                    if "reasoning_details" in message:
                        reasoning_details = message.get("reasoning_details")

                    if choice.get("finish_reason") is not None:
                        break

    except Exception as e:
        yield {"delta_type": "error", "message": str(e)}
        return

    # Best-effort final event
    yield {
        "delta_type": "final",
        "content": content_acc,
        "reasoning_details": reasoning_details if reasoning_details is not None else (reasoning_acc or None),
    }


async def query_models_parallel(
    models: List[str],
    messages: List[Dict[str, Any]]
) -> Dict[str, Optional[Dict[str, Any]]]:
    """
    Query multiple models in parallel.

    Args:
        models: List of OpenRouter model identifiers
        messages: List of message dicts to send to each model

    Returns:
        Dict mapping model identifier to response dict (or None if failed)
    """
    import asyncio

    # Create tasks for all models
    tasks = [query_model(model, messages) for model in models]

    # Wait for all to complete
    responses = await asyncio.gather(*tasks)

    # Map models to their responses
    return {model: response for model, response in zip(models, responses)}
