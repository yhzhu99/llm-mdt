"""3-stage LLM Council orchestration."""

from typing import List, Dict, Any, Tuple, AsyncIterator
from .openrouter import query_models_parallel, query_model, query_model_stream
from .config import COUNCIL_MODELS, CHAIRMAN_MODEL


def _build_user_message(user_query: str) -> Dict[str, Any]:
    return {"role": "user", "content": user_query}


async def stage1_collect_responses(
    user_query: str,
) -> List[Dict[str, Any]]:
    """
    Stage 1: Collect individual responses from all council models.

    Args:
        user_query: The user's question

    Returns:
        List of dicts with 'model' and 'response' keys
    """
    messages: List[Dict[str, Any]] = [_build_user_message(user_query)]

    # Query all models in parallel
    responses = await query_models_parallel(COUNCIL_MODELS, messages)

    # Format results
    stage1_results = []
    for model, response in responses.items():
        if response is not None:  # Only include successful responses
            stage1_results.append({
                "model": model,
                "response": response.get('content', '')
            })

    return stage1_results


async def stage1_collect_responses_stream(
    user_query: str,
) -> AsyncIterator[Dict[str, Any]]:
    messages: List[Dict[str, Any]] = [_build_user_message(user_query)]

    yield {"type": "stage1_start"}

    import asyncio

    async def run_one(model: str) -> Dict[str, Any]:
        content_acc = ""
        reasoning_details = None
        yield_queue: asyncio.Queue = asyncio.Queue()

        async def produce():
            nonlocal content_acc, reasoning_details
            try:
                await yield_queue.put({"type": "stage1_model_start", "model": model})
                async for ev in query_model_stream(model, messages):
                    if ev.get("delta_type") == "content":
                        txt = ev.get("text", "")
                        content_acc += txt
                        await yield_queue.put({
                            "type": "stage1_model_delta",
                            "model": model,
                            "delta_type": "content",
                            "text": txt,
                        })
                    elif ev.get("delta_type") == "reasoning":
                        await yield_queue.put({
                            "type": "stage1_model_delta",
                            "model": model,
                            "delta_type": "reasoning",
                            "text": ev.get("text", ""),
                        })
                    elif ev.get("delta_type") == "final":
                        reasoning_details = ev.get("reasoning_details")
                    elif ev.get("delta_type") == "error":
                        await yield_queue.put({
                            "type": "stage1_model_error",
                            "model": model,
                            "message": ev.get("message", "unknown error"),
                        })
                        break
            finally:
                await yield_queue.put({
                    "type": "stage1_model_complete",
                    "model": model,
                    "content": content_acc,
                    "reasoning_details": reasoning_details,
                })
                await yield_queue.put(None)

        task = asyncio.create_task(produce())

        # Drain queue as a mini-iterator; the caller will multiplex these.
        out = {
            "model": model,
            "task": task,
            "queue": yield_queue,
        }
        return out

    runners = [await run_one(m) for m in COUNCIL_MODELS]

    stage1_results: List[Dict[str, Any]] = []

    async def pump_one(runner: Dict[str, Any]):
        q: asyncio.Queue = runner["queue"]
        while True:
            item = await q.get()
            if item is None:
                break
            yield item

    # Multiplex all model event streams
    pumps = [pump_one(r) for r in runners]
    pending = {asyncio.create_task(p.__anext__()): p for p in pumps}

    while pending:
        done, _ = await asyncio.wait(pending.keys(), return_when=asyncio.FIRST_COMPLETED)
        for t in done:
            p = pending.pop(t)
            try:
                ev = t.result()
            except StopAsyncIteration:
                continue
            # schedule next
            pending[asyncio.create_task(p.__anext__())] = p

            yield ev

            if ev.get("type") == "stage1_model_complete":
                stage1_results.append({
                    "model": ev.get("model"),
                    "response": ev.get("content", ""),
                    "reasoning_details": ev.get("reasoning_details"),
                })

    yield {"type": "stage1_complete", "data": stage1_results}


async def stage2_collect_rankings(
    user_query: str,
    stage1_results: List[Dict[str, Any]]
) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    """
    Stage 2: Each model ranks the anonymized responses.

    Args:
        user_query: The original user query
        stage1_results: Results from Stage 1

    Returns:
        Tuple of (rankings list, label_to_model mapping)
    """
    # Create anonymized labels for responses (Response A, Response B, etc.)
    labels = [chr(65 + i) for i in range(len(stage1_results))]  # A, B, C, ...

    # Create mapping from label to model name
    label_to_model = {
        f"Response {label}": result['model']
        for label, result in zip(labels, stage1_results)
    }

    # Build the ranking prompt
    responses_text = "\n\n".join([
        f"Response {label}:\n{result['response']}"
        for label, result in zip(labels, stage1_results)
    ])

    ranking_prompt = f"""You are evaluating different responses to the following question:

Question: {user_query}

Here are the responses from different models (anonymized):

{responses_text}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:"""

    messages = [{"role": "user", "content": ranking_prompt}]

    # Get rankings from all council models in parallel
    responses = await query_models_parallel(COUNCIL_MODELS, messages)

    # Format results
    stage2_results = []
    for model, response in responses.items():
        if response is not None:
            full_text = response.get('content', '')
            parsed = parse_ranking_from_text(full_text)
            stage2_results.append({
                "model": model,
                "ranking": full_text,
                "parsed_ranking": parsed
            })

    return stage2_results, label_to_model


async def stage2_collect_rankings_stream(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
) -> AsyncIterator[Dict[str, Any]]:
    labels = [chr(65 + i) for i in range(len(stage1_results))]

    label_to_model = {
        f"Response {label}": result["model"]
        for label, result in zip(labels, stage1_results)
    }

    responses_text = "\n\n".join([
        f"Response {label}:\n{result.get('response', '')}"
        for label, result in zip(labels, stage1_results)
    ])

    ranking_prompt = f"""You are evaluating different responses to the following question:

Question: {user_query}

Here are the responses from different models (anonymized):

{responses_text}

Your task:
1. First, evaluate each response individually. For each response, explain what it does well and what it does poorly.
2. Then, at the very end of your response, provide a final ranking.

IMPORTANT: Your final ranking MUST be formatted EXACTLY as follows:
- Start with the line "FINAL RANKING:" (all caps, with colon)
- Then list the responses from best to worst as a numbered list
- Each line should be: number, period, space, then ONLY the response label (e.g., "1. Response A")
- Do not add any other text or explanations in the ranking section

Example of the correct format for your ENTIRE response:

Response A provides good detail on X but misses Y...
Response B is accurate but lacks depth on Z...
Response C offers the most comprehensive answer...

FINAL RANKING:
1. Response C
2. Response A
3. Response B

Now provide your evaluation and ranking:"""

    messages = [{"role": "user", "content": ranking_prompt}]

    yield {"type": "stage2_start"}

    import asyncio

    async def run_one(model: str) -> Dict[str, Any]:
        text_acc = ""
        reasoning_details = None
        q: asyncio.Queue = asyncio.Queue()

        async def produce():
            nonlocal text_acc, reasoning_details
            try:
                await q.put({"type": "stage2_model_start", "model": model})
                async for ev in query_model_stream(model, messages):
                    if ev.get("delta_type") == "content":
                        txt = ev.get("text", "")
                        text_acc += txt
                        await q.put({
                            "type": "stage2_model_delta",
                            "model": model,
                            "delta_type": "content",
                            "text": txt,
                        })
                    elif ev.get("delta_type") == "reasoning":
                        await q.put({
                            "type": "stage2_model_delta",
                            "model": model,
                            "delta_type": "reasoning",
                            "text": ev.get("text", ""),
                        })
                    elif ev.get("delta_type") == "final":
                        reasoning_details = ev.get("reasoning_details")
                    elif ev.get("delta_type") == "error":
                        await q.put({
                            "type": "stage2_model_error",
                            "model": model,
                            "message": ev.get("message", "unknown error"),
                        })
                        break
            finally:
                parsed = parse_ranking_from_text(text_acc)
                await q.put({
                    "type": "stage2_model_complete",
                    "model": model,
                    "ranking": text_acc,
                    "reasoning_details": reasoning_details,
                    "parsed_ranking": parsed,
                })
                await q.put(None)

        task = asyncio.create_task(produce())
        return {"model": model, "task": task, "queue": q}

    runners = [await run_one(m) for m in COUNCIL_MODELS]
    stage2_results: List[Dict[str, Any]] = []

    async def pump_one(runner: Dict[str, Any]):
        q: asyncio.Queue = runner["queue"]
        while True:
            item = await q.get()
            if item is None:
                break
            yield item

    pumps = [pump_one(r) for r in runners]
    pending = {asyncio.create_task(p.__anext__()): p for p in pumps}

    while pending:
        done, _ = await asyncio.wait(pending.keys(), return_when=asyncio.FIRST_COMPLETED)
        for t in done:
            p = pending.pop(t)
            try:
                ev = t.result()
            except StopAsyncIteration:
                continue
            pending[asyncio.create_task(p.__anext__())] = p

            yield ev

            if ev.get("type") == "stage2_model_complete":
                stage2_results.append({
                    "model": ev.get("model"),
                    "ranking": ev.get("ranking", ""),
                    "parsed_ranking": ev.get("parsed_ranking", []),
                    "reasoning_details": ev.get("reasoning_details"),
                })

    ranking_details = calculate_ranking_details(stage2_results, label_to_model)
    stage2_metadata = {
        "label_to_model": label_to_model,
        "aggregate_rankings": ranking_details["aggregate_rankings"],
        "positions_by_model": ranking_details["positions_by_model"],
        "stage2_parsed_rankings": ranking_details["stage2_parsed_rankings"],
    }

    yield {"type": "stage2_complete", "data": stage2_results, "metadata": stage2_metadata}


async def stage3_synthesize_final(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Stage 3: Chairman synthesizes final response.

    Args:
        user_query: The original user query
        stage1_results: Individual model responses from Stage 1
        stage2_results: Rankings from Stage 2

    Returns:
        Dict with 'model' and 'response' keys
    """
    # Build comprehensive context for chairman
    stage1_text = "\n\n".join([
        f"Model: {result['model']}\nResponse: {result['response']}"
        for result in stage1_results
    ])

    stage2_text = "\n\n".join([
        f"Model: {result['model']}\nRanking: {result['ranking']}"
        for result in stage2_results
    ])

    chairman_prompt = f"""You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.

Original Question: {user_query}

STAGE 1 - Individual Responses:
{stage1_text}

STAGE 2 - Peer Rankings:
{stage2_text}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:"""

    messages = [{"role": "user", "content": chairman_prompt}]

    # Query the chairman model
    response = await query_model(CHAIRMAN_MODEL, messages)

    if response is None:
        # Fallback if chairman fails
        return {
            "model": CHAIRMAN_MODEL,
            "response": "Error: Unable to generate final synthesis."
        }

    return {
        "model": CHAIRMAN_MODEL,
        "response": response.get('content', '')
    }


async def stage3_synthesize_final_stream(
    user_query: str,
    stage1_results: List[Dict[str, Any]],
    stage2_results: List[Dict[str, Any]],
) -> AsyncIterator[Dict[str, Any]]:
    stage1_text = "\n\n".join([
        f"Model: {result['model']}\nResponse: {result.get('response', '')}"
        for result in stage1_results
    ])

    stage2_text = "\n\n".join([
        f"Model: {result['model']}\nRanking: {result.get('ranking', '')}"
        for result in stage2_results
    ])

    chairman_prompt = f"""You are the Chairman of an LLM Council. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.

Original Question: {user_query}

STAGE 1 - Individual Responses:
{stage1_text}

STAGE 2 - Peer Rankings:
{stage2_text}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:"""

    messages = [{"role": "user", "content": chairman_prompt}]

    yield {"type": "stage3_start"}

    content_acc = ""
    reasoning_details = None

    async for ev in query_model_stream(CHAIRMAN_MODEL, messages):
        if ev.get("delta_type") == "content":
            txt = ev.get("text", "")
            content_acc += txt
            yield {"type": "stage3_delta", "delta_type": "content", "text": txt}
        elif ev.get("delta_type") == "reasoning":
            yield {"type": "stage3_delta", "delta_type": "reasoning", "text": ev.get("text", "")}
        elif ev.get("delta_type") == "final":
            reasoning_details = ev.get("reasoning_details")
        elif ev.get("delta_type") == "error":
            yield {"type": "stage3_error", "message": ev.get("message", "unknown error")}
            break

    yield {"type": "stage3_complete", "data": {"model": CHAIRMAN_MODEL, "response": content_acc, "reasoning_details": reasoning_details}}


def parse_ranking_from_text(ranking_text: str) -> List[str]:
    """
    Parse the FINAL RANKING section from the model's response.

    Args:
        ranking_text: The full text response from the model

    Returns:
        List of response labels in ranked order
    """
    import re

    # Look for "FINAL RANKING:" section
    if "FINAL RANKING:" in ranking_text:
        # Extract everything after "FINAL RANKING:"
        parts = ranking_text.split("FINAL RANKING:")
        if len(parts) >= 2:
            ranking_section = parts[1]
            # Try to extract numbered list format (e.g., "1. Response A")
            # This pattern looks for: number, period, optional space, "Response X"
            numbered_matches = re.findall(r'\d+\.\s*Response [A-Z]', ranking_section)
            if numbered_matches:
                # Extract just the "Response X" part
                return [re.search(r'Response [A-Z]', m).group() for m in numbered_matches]

            # Fallback: Extract all "Response X" patterns in order
            matches = re.findall(r'Response [A-Z]', ranking_section)
            return matches

    # Fallback: try to find any "Response X" patterns in order
    matches = re.findall(r'Response [A-Z]', ranking_text)
    return matches


def calculate_aggregate_rankings(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str]
) -> List[Dict[str, Any]]:
    """
    Calculate aggregate rankings across all models.

    Args:
        stage2_results: Rankings from each model
        label_to_model: Mapping from anonymous labels to model names

    Returns:
        List of dicts with model name and average rank, sorted best to worst
    """
    from collections import defaultdict

    # Track positions for each model
    model_positions = defaultdict(list)

    for ranking in stage2_results:
        ranking_text = ranking['ranking']

        # Parse the ranking from the structured format
        parsed_ranking = parse_ranking_from_text(ranking_text)

        for position, label in enumerate(parsed_ranking, start=1):
            if label in label_to_model:
                model_name = label_to_model[label]
                model_positions[model_name].append(position)

    # Calculate average position for each model
    aggregate = []
    for model, positions in model_positions.items():
        if positions:
            avg_rank = sum(positions) / len(positions)
            aggregate.append({
                "model": model,
                "average_rank": round(avg_rank, 2),
                "rankings_count": len(positions)
            })

    # Sort by average rank (lower is better)
    aggregate.sort(key=lambda x: x['average_rank'])

    return aggregate


def calculate_ranking_details(
    stage2_results: List[Dict[str, Any]],
    label_to_model: Dict[str, str],
) -> Dict[str, Any]:
    """
    Calculate aggregate rankings and store per-model position lists for traceability.

    Returns:
        Dict with:
          - aggregate_rankings: list[{model, average_rank, rankings_count}]
          - positions_by_model: dict[model -> list[int]]
          - stage2_parsed_rankings: list[{voter_model, parsed_ranking}]
    """
    from collections import defaultdict

    positions_by_model = defaultdict(list)
    stage2_parsed_rankings: List[Dict[str, Any]] = []

    for ranking in stage2_results:
        voter_model = ranking.get("model", "")
        parsed_ranking = ranking.get("parsed_ranking") or parse_ranking_from_text(ranking.get("ranking", ""))
        stage2_parsed_rankings.append({
            "voter_model": voter_model,
            "parsed_ranking": parsed_ranking,
        })

        for position, label in enumerate(parsed_ranking, start=1):
            if label in label_to_model:
                model_name = label_to_model[label]
                positions_by_model[model_name].append(position)

    aggregate_rankings = []
    for model, positions in positions_by_model.items():
        if positions:
            avg_rank = sum(positions) / len(positions)
            aggregate_rankings.append({
                "model": model,
                "average_rank": round(avg_rank, 2),
                "rankings_count": len(positions),
            })

    aggregate_rankings.sort(key=lambda x: x["average_rank"])

    return {
        "aggregate_rankings": aggregate_rankings,
        "positions_by_model": dict(positions_by_model),
        "stage2_parsed_rankings": stage2_parsed_rankings,
    }


async def generate_conversation_title(user_query: str) -> str:
    """
    Generate a short title for a conversation based on the first user message.

    Args:
        user_query: The first user message

    Returns:
        A short title (3-5 words)
    """
    title_prompt = f"""Generate a very short title (3-5 words maximum) that summarizes the following question.
The title should be concise and descriptive. Do not use quotes or punctuation in the title.

Question: {user_query}

Title:"""

    messages = [{"role": "user", "content": title_prompt}]

    # Use gemini-2.5-flash for title generation (fast and cheap)
    response = await query_model("google/gemini-2.5-flash", messages, timeout=30.0)

    if response is None:
        # Fallback to a generic title
        return "New Conversation"

    title = response.get('content', 'New Conversation').strip()

    # Clean up the title - remove quotes, limit length
    title = title.strip('"\'')

    # Truncate if too long
    if len(title) > 50:
        title = title[:47] + "..."

    return title


async def run_full_council(user_query: str) -> Tuple[List, List, Dict, Dict]:
    """
    Run the complete 3-stage council process.

    Args:
        user_query: The user's question

    Returns:
        Tuple of (stage1_results, stage2_results, stage3_result, metadata)
    """
    # Stage 1: Collect individual responses
    stage1_results = await stage1_collect_responses(user_query, image_data_urls=None)

    # If no models responded successfully, return error
    if not stage1_results:
        return [], [], {
            "model": "error",
            "response": "All models failed to respond. Please try again."
        }, {}

    # Stage 2: Collect rankings
    stage2_results, label_to_model = await stage2_collect_rankings(user_query, stage1_results)

    # Calculate aggregate rankings + traceable details
    ranking_details = calculate_ranking_details(stage2_results, label_to_model)

    # Stage 3: Synthesize final answer
    stage3_result = await stage3_synthesize_final(
        user_query,
        stage1_results,
        stage2_results
    )

    # Prepare metadata
    metadata = {
        "label_to_model": label_to_model,
        "aggregate_rankings": ranking_details["aggregate_rankings"],
        "positions_by_model": ranking_details["positions_by_model"],
        "stage2_parsed_rankings": ranking_details["stage2_parsed_rankings"],
    }

    return stage1_results, stage2_results, stage3_result, metadata
