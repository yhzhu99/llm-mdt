import { conversationStore } from './conversationStore';
import {
  chatCompletion,
  chatCompletionStream,
} from './llmClient';
import { isProviderConfigured } from './providerSettings';

function createId(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function buildUserMessage(userQuery) {
  return {
    role: 'user',
    content: userQuery,
  };
}

function buildRankingPrompt(userQuery, stage1Results) {
  const labels = stage1Results.map((_, index) => String.fromCharCode(65 + index));
  const responsesText = stage1Results
    .map((result, index) => `Response ${labels[index]}:\n${result.response}`)
    .join('\n\n');

  return `You are evaluating different responses to the following question:

Question: ${userQuery}

Here are the responses from different models (anonymized):

${responsesText}

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

Now provide your evaluation and ranking:`;
}

function buildChairmanPrompt(userQuery, stage1Results, stage2Results) {
  const stage1Text = stage1Results
    .map((result) => `Model: ${result.model}\nResponse: ${result.response}`)
    .join('\n\n');

  const stage2Text = stage2Results
    .map((result) => `Model: ${result.model}\nRanking: ${result.ranking}`)
    .join('\n\n');

  return `You are the Chairman of an LLM MDT. Multiple AI models have provided responses to a user's question, and then ranked each other's responses.

Original Question: ${userQuery}

STAGE 1 - Individual Responses:
${stage1Text}

STAGE 2 - Peer Rankings:
${stage2Text}

Your task as Chairman is to synthesize all of this information into a single, comprehensive, accurate answer to the user's original question. Consider:
- The individual responses and their insights
- The peer rankings and what they reveal about response quality
- Any patterns of agreement or disagreement

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:`;
}

function buildTitlePrompt(userQuery) {
  return `Generate a very short title (3-5 words maximum) that summarizes the following question.
The title should be concise and descriptive. Do not use quotes or punctuation in the title.

Question: ${userQuery}

Title:`;
}

export function parseRankingFromText(rankingText) {
  const source = String(rankingText || '');

  if (source.includes('FINAL RANKING:')) {
    const [, rankingSection = ''] = source.split('FINAL RANKING:');
    const numberedMatches = [...rankingSection.matchAll(/\d+\.\s*(Response [A-Z])/g)];
    if (numberedMatches.length > 0) {
      return numberedMatches.map((match) => match[1]);
    }

    return [...rankingSection.matchAll(/Response [A-Z]/g)].map((match) => match[0]);
  }

  return [...source.matchAll(/Response [A-Z]/g)].map((match) => match[0]);
}

export function calculateRankingDetails(stage2Results, labelToModel) {
  const positionsByModel = {};
  const stage2ParsedRankings = [];

  for (const ranking of stage2Results || []) {
    const voterModel = ranking?.model || '';
    const parsedRanking =
      ranking?.parsed_ranking?.length > 0
        ? ranking.parsed_ranking
        : parseRankingFromText(ranking?.ranking || '');

    stage2ParsedRankings.push({
      voter_model: voterModel,
      parsed_ranking: parsedRanking,
    });

    parsedRanking.forEach((label, index) => {
      const modelName = labelToModel?.[label];
      if (!modelName) return;
      if (!positionsByModel[modelName]) {
        positionsByModel[modelName] = [];
      }
      positionsByModel[modelName].push(index + 1);
    });
  }

  const aggregateRankings = Object.entries(positionsByModel)
    .map(([model, positions]) => ({
      model,
      average_rank: Number((positions.reduce((sum, value) => sum + value, 0) / positions.length).toFixed(2)),
      rankings_count: positions.length,
    }))
    .sort((left, right) => left.average_rank - right.average_rank);

  return {
    aggregate_rankings: aggregateRankings,
    positions_by_model: positionsByModel,
    stage2_parsed_rankings: stage2ParsedRankings,
  };
}

async function collectStageResponses({
  stagePrefix,
  models,
  messages,
  settings,
  client,
  emit,
  valueKey,
}) {
  emit({ type: `${stagePrefix}_start` });

  const resultsByModel = new Map();

  await Promise.all(
    models.map(async (model) => {
      emit({ type: `${stagePrefix}_model_start`, model });

      let contentAcc = '';
      let reasoningDetails = null;
      let failed = false;

      try {
        for await (const event of client.chatCompletionStream(settings, { model, messages })) {
          if (event?.delta_type === 'content') {
            const text = event.text || '';
            contentAcc += text;
            emit({
              type: `${stagePrefix}_model_delta`,
              model,
              delta_type: 'content',
              text,
            });
          } else if (event?.delta_type === 'reasoning') {
            emit({
              type: `${stagePrefix}_model_delta`,
              model,
              delta_type: 'reasoning',
              text: event.text || '',
            });
          } else if (event?.delta_type === 'final') {
            reasoningDetails = event.reasoning_details;
            if (!contentAcc && event.content) {
              contentAcc = event.content;
            }
          } else if (event?.delta_type === 'error') {
            failed = true;
            emit({
              type: `${stagePrefix}_model_error`,
              model,
              message: event.message || 'Unknown error',
            });
            break;
          }
        }
      } catch (error) {
        failed = true;
        emit({
          type: `${stagePrefix}_model_error`,
          model,
          message: error instanceof Error ? error.message : String(error),
        });
      }

      if (!failed && contentAcc.trim()) {
        resultsByModel.set(model, {
          model,
          [valueKey]: contentAcc,
          reasoning_details: reasoningDetails,
        });
      }
    })
  );

  return models.map((model) => resultsByModel.get(model)).filter(Boolean);
}

async function generateConversationTitle(userQuery, settings, client) {
  const titleModel = settings.titleModel || settings.chairmanModel;
  if (!titleModel) {
    return 'New Conversation';
  }

  try {
    const response = await client.chatCompletion(settings, {
      model: titleModel,
      messages: [{ role: 'user', content: buildTitlePrompt(userQuery) }],
      timeoutMs: 30000,
    });

    const title = String(response?.content || 'New Conversation')
      .trim()
      .replace(/^["']+|["']+$/g, '');

    if (!title) {
      return 'New Conversation';
    }

    return title.length > 50 ? `${title.slice(0, 47)}...` : title;
  } catch {
    return 'New Conversation';
  }
}

export async function runMdtConversationStream({
  conversationId,
  content,
  settings,
  onEvent,
  conversationRepo = conversationStore,
  client = { chatCompletion, chatCompletionStream },
}) {
  if (!isProviderConfigured(settings)) {
    throw new Error('Configure a browser-capable LLM provider before sending a message.');
  }

  const emit = (event) => {
    if (typeof onEvent === 'function' && event?.type) {
      onEvent(event.type, event);
    }
  };

  const conversation = await conversationRepo.getConversation(conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const isFirstMessage = (conversation.messages || []).length === 0;
  const titlePromise = isFirstMessage
    ? generateConversationTitle(content, settings, client)
    : Promise.resolve(null);

  await conversationRepo.addUserMessage(conversationId, content);

  let stage1Results = [];
  let stage2Results = [];
  let stage3Result = null;
  let metadata = null;

  try {
    stage1Results = await collectStageResponses({
      stagePrefix: 'stage1',
      models: settings.councilModels,
      messages: [buildUserMessage(content)],
      settings,
      client,
      emit,
      valueKey: 'response',
    });
    emit({ type: 'stage1_complete', data: stage1Results });

    if (stage1Results.length > 0) {
      const labels = stage1Results.map((_, index) => `Response ${String.fromCharCode(65 + index)}`);
      const labelToModel = Object.fromEntries(
        labels.map((label, index) => [label, stage1Results[index].model])
      );

      stage2Results = await collectStageResponses({
        stagePrefix: 'stage2',
        models: settings.councilModels,
        messages: [{ role: 'user', content: buildRankingPrompt(content, stage1Results) }],
        settings,
        client,
        emit,
        valueKey: 'ranking',
      });
      stage2Results = stage2Results.map((result) => ({
        ...result,
        parsed_ranking: parseRankingFromText(result.ranking),
      }));

      metadata = {
        label_to_model: labelToModel,
        ...calculateRankingDetails(stage2Results, labelToModel),
      };
      emit({ type: 'stage2_complete', data: stage2Results, metadata });

      emit({ type: 'stage3_start' });
      let stage3Content = '';
      let stage3Reasoning = null;
      let stage3Failed = false;

      for await (const event of client.chatCompletionStream(settings, {
        model: settings.chairmanModel,
        messages: [
          {
            role: 'user',
            content: buildChairmanPrompt(content, stage1Results, stage2Results),
          },
        ],
      })) {
        if (event?.delta_type === 'content') {
          const text = event.text || '';
          stage3Content += text;
          emit({ type: 'stage3_delta', delta_type: 'content', text });
        } else if (event?.delta_type === 'reasoning') {
          emit({ type: 'stage3_delta', delta_type: 'reasoning', text: event.text || '' });
        } else if (event?.delta_type === 'final') {
          stage3Reasoning = event.reasoning_details;
          if (!stage3Content && event.content) {
            stage3Content = event.content;
          }
        } else if (event?.delta_type === 'error') {
          stage3Failed = true;
          emit({ type: 'stage3_error', message: event.message || 'Unknown error' });
          break;
        }
      }

      stage3Result = {
        model: settings.chairmanModel,
        response:
          stage3Content ||
          (stage3Failed
            ? 'Error: Unable to generate final synthesis.'
            : 'No final synthesis was returned.'),
        reasoning_details: stage3Reasoning,
      };
      emit({ type: 'stage3_complete', data: stage3Result });
    } else {
      metadata = {
        label_to_model: {},
        aggregate_rankings: [],
        positions_by_model: {},
        stage2_parsed_rankings: [],
      };
      emit({ type: 'stage2_complete', data: [], metadata });
      emit({ type: 'stage3_start' });
      stage3Result = {
        model: settings.chairmanModel,
        response:
          'All models failed to respond. Check your provider configuration, CORS support, or API key and try again.',
        reasoning_details: null,
      };
      emit({ type: 'stage3_complete', data: stage3Result });
    }
  } catch (error) {
    emit({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    });

    if (!metadata) {
      metadata = {
        label_to_model: {},
        aggregate_rankings: [],
        positions_by_model: {},
        stage2_parsed_rankings: [],
      };
    }

    if (!stage3Result) {
      stage3Result = {
        model: settings.chairmanModel,
        response: 'Error: Unable to complete the MDT run.',
        reasoning_details: null,
      };
      emit({ type: 'stage3_complete', data: stage3Result });
    }
  }

  const title = await titlePromise;
  if (title) {
    await conversationRepo.updateConversationTitle(conversationId, title);
    emit({ type: 'title_complete', data: { title } });
  }

  await conversationRepo.addAssistantMessage(conversationId, {
    id: createId('assistant'),
    stage1: stage1Results,
    stage2: stage2Results,
    stage3: stage3Result,
    metadata,
    created_at: new Date().toISOString(),
  });

  emit({ type: 'complete' });
}
