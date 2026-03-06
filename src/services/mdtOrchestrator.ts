import { conversationStore } from './conversationStore'
import { chatCompletion, chatCompletionStream } from './llmClient'
import { isProviderConfigured } from './providerSettings'
import { translate } from '@/i18n'
import type {
  AppLocale,
  ChatCompletionClient,
  ChatCompletionMessage,
  ConversationRepository,
  MdtEventHandler,
  MdtStreamEvent,
  ParsedStage2Ranking,
  ProviderSettings,
  RankingMetadata,
  Stage1Result,
  Stage2Result,
  Stage3Result,
} from '@/types'

function createId(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function buildUserMessage(userQuery: string): ChatCompletionMessage {
  return {
    role: 'user',
    content: userQuery,
  }
}

function buildRankingPrompt(userQuery: string, stage1Results: Stage1Result[]) {
  const labels = stage1Results.map((_, index) => String.fromCharCode(65 + index))
  const responsesText = stage1Results
    .map((result, index) => `Response ${labels[index]}:\n${result.response}`)
    .join('\n\n')

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

Now provide your evaluation and ranking:`
}

function buildChairmanPrompt(userQuery: string, stage1Results: Stage1Result[], stage2Results: Stage2Result[]) {
  const stage1Text = stage1Results.map((result) => `Model: ${result.model}\nResponse: ${result.response}`).join('\n\n')

  const stage2Text = stage2Results.map((result) => `Model: ${result.model}\nRanking: ${result.ranking}`).join('\n\n')

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

Provide a clear, well-reasoned final answer that represents the council's collective wisdom:`
}

function buildTitlePrompt(userQuery: string) {
  return `Generate a very short title (3-5 words maximum) that summarizes the following question.
The title should be concise and descriptive. Do not use quotes or punctuation in the title.

Question: ${userQuery}

Title:`
}

export function parseRankingFromText(rankingText: string) {
  const source = String(rankingText || '')

  if (source.includes('FINAL RANKING:')) {
    const [, rankingSection = ''] = source.split('FINAL RANKING:')
    const numberedMatches = [...rankingSection.matchAll(/\d+\.\s*(Response [A-Z])/g)]
    if (numberedMatches.length > 0) {
      return numberedMatches
        .map((match) => match[1])
        .filter((label): label is string => Boolean(label))
    }

    return [...rankingSection.matchAll(/Response [A-Z]/g)]
      .map((match) => match[0])
      .filter((label): label is string => Boolean(label))
  }

  return [...source.matchAll(/Response [A-Z]/g)]
    .map((match) => match[0])
    .filter((label): label is string => Boolean(label))
}

export function calculateRankingDetails(
  stage2Results: Array<Pick<Stage2Result, 'model' | 'ranking' | 'parsed_ranking'>>,
  labelToModel: Record<string, string>,
): RankingMetadata {
  const positionsByModel: Record<string, number[]> = {}
  const stage2ParsedRankings: ParsedStage2Ranking[] = []

  for (const ranking of stage2Results || []) {
    const voterModel = ranking.model || ''
    const parsedRanking = ranking.parsed_ranking?.length > 0 ? ranking.parsed_ranking : parseRankingFromText(ranking.ranking || '')

    stage2ParsedRankings.push({
      voter_model: voterModel,
      parsed_ranking: parsedRanking,
    })

    parsedRanking.forEach((label, index) => {
      const modelName = labelToModel[label]
      if (!modelName) return
      if (!positionsByModel[modelName]) {
        positionsByModel[modelName] = []
      }
      positionsByModel[modelName]?.push(index + 1)
    })
  }

  const aggregateRankings = Object.entries(positionsByModel)
    .map(([model, positions]) => ({
      model,
      average_rank: Number((positions.reduce((sum, value) => sum + value, 0) / positions.length).toFixed(2)),
      rankings_count: positions.length,
    }))
    .sort((left, right) => left.average_rank - right.average_rank)

  return {
    label_to_model: labelToModel,
    aggregate_rankings: aggregateRankings,
    positions_by_model: positionsByModel,
    stage2_parsed_rankings: stage2ParsedRankings,
  }
}

async function collectStageResponses({
  stagePrefix,
  models,
  messages,
  settings,
  client,
  emit,
  valueKey,
  locale,
}: {
  stagePrefix: 'stage1' | 'stage2'
  models: string[]
  messages: ChatCompletionMessage[]
  settings: ProviderSettings
  client: ChatCompletionClient
  emit: (event: MdtStreamEvent) => void
  valueKey: 'response' | 'ranking'
  locale: AppLocale
}) {
  emit({ type: `${stagePrefix}_start` } as MdtStreamEvent)

  const resultsByModel = new Map<string, Stage1Result | Stage2Result>()

  await Promise.all(
    models.map(async (model) => {
      emit({ type: `${stagePrefix}_model_start`, model } as MdtStreamEvent)

      let contentAcc = ''
      let reasoningDetails: string | null = null
      let failed = false

      try {
        for await (const event of client.chatCompletionStream(settings, { model, messages })) {
          if (event.delta_type === 'content') {
            const text = event.text || ''
            contentAcc += text
            emit({
              type: `${stagePrefix}_model_delta`,
              model,
              delta_type: 'content',
              text,
            } as MdtStreamEvent)
          } else if (event.delta_type === 'reasoning') {
            emit({
              type: `${stagePrefix}_model_delta`,
              model,
              delta_type: 'reasoning',
              text: event.text || '',
            } as MdtStreamEvent)
          } else if (event.delta_type === 'final') {
            reasoningDetails = event.reasoning_details
            if (!contentAcc && event.content) {
              contentAcc = event.content
            }
          } else if (event.delta_type === 'error') {
            failed = true
            emit({
              type: `${stagePrefix}_model_error`,
              model,
              message: event.message || translate(locale, 'orchestratorUnknownError'),
            } as MdtStreamEvent)
            break
          }
        }
      } catch (error) {
        failed = true
        emit({
          type: `${stagePrefix}_model_error`,
          model,
          message: error instanceof Error ? error.message : String(error),
        } as MdtStreamEvent)
      }

      if (!failed && contentAcc.trim()) {
        resultsByModel.set(
          model,
          valueKey === 'response'
            ? {
                model,
                response: contentAcc,
                reasoning_details: reasoningDetails,
              }
            : {
                model,
                ranking: contentAcc,
                parsed_ranking: [],
                reasoning_details: reasoningDetails,
              },
        )
      }
    }),
  )

  return models.map((model) => resultsByModel.get(model)).filter(Boolean) as Array<Stage1Result | Stage2Result>
}

async function generateConversationTitle(
  userQuery: string,
  settings: ProviderSettings,
  client: ChatCompletionClient,
  locale: AppLocale,
) {
  const titleModel = settings.titleModel || settings.chairmanModel
  if (!titleModel) {
    return translate(locale, 'conversationUntitled')
  }

  try {
    const response = await client.chatCompletion(settings, {
      model: titleModel,
      messages: [{ role: 'user', content: buildTitlePrompt(userQuery) }],
      timeoutMs: 30000,
    })

    const title = String(response.content || translate(locale, 'conversationUntitled'))
      .trim()
      .replace(/^["']+|["']+$/g, '')

    if (!title) {
      return translate(locale, 'conversationUntitled')
    }

    return title.length > 50 ? `${title.slice(0, 47)}...` : title
  } catch {
    return translate(locale, 'conversationUntitled')
  }
}

export async function runMdtConversationStream({
  conversationId,
  content,
  locale = 'zh-CN',
  settings,
  onEvent,
  conversationRepo = conversationStore,
  client = { chatCompletion, chatCompletionStream },
}: {
  conversationId: string
  content: string
  locale?: AppLocale
  settings: ProviderSettings
  onEvent?: MdtEventHandler
  conversationRepo?: ConversationRepository
  client?: ChatCompletionClient
}) {
  if (!isProviderConfigured(settings)) {
    throw new Error(translate(locale, 'orchestratorConfigureProvider'))
  }

  const emit = (event: MdtStreamEvent) => {
    if (typeof onEvent === 'function' && event.type) {
      onEvent(event.type, event)
    }
  }

  const conversation = await conversationRepo.getConversation(conversationId)
  if (!conversation) {
    throw new Error(translate(locale, 'orchestratorConversationNotFound'))
  }

  const isFirstMessage = (conversation.messages || []).length === 0
  const titlePromise = isFirstMessage
    ? generateConversationTitle(content, settings, client, locale)
    : Promise.resolve<string | null>(null)

  await conversationRepo.addUserMessage(conversationId, content)

  let stage1Results: Stage1Result[] = []
  let stage2Results: Stage2Result[] = []
  let stage3Result: Stage3Result | null = null
  let metadata: RankingMetadata | null = null

  try {
    stage1Results = (await collectStageResponses({
      stagePrefix: 'stage1',
      models: settings.councilModels,
      messages: [buildUserMessage(content)],
      settings,
      client,
      emit,
      valueKey: 'response',
      locale,
    })) as Stage1Result[]
    emit({ type: 'stage1_complete', data: stage1Results })

    if (stage1Results.length > 0) {
      const labelToModel = Object.fromEntries(
        stage1Results.map((result, index) => [`Response ${String.fromCharCode(65 + index)}`, result.model]),
      ) as Record<string, string>

      stage2Results = (await collectStageResponses({
        stagePrefix: 'stage2',
        models: settings.councilModels,
        messages: [{ role: 'user', content: buildRankingPrompt(content, stage1Results) }],
        settings,
        client,
        emit,
        valueKey: 'ranking',
        locale,
      })) as Stage2Result[]
      stage2Results = stage2Results.map((result) => ({
        ...result,
        parsed_ranking: parseRankingFromText(result.ranking),
      }))

      metadata = calculateRankingDetails(stage2Results, labelToModel)
      emit({ type: 'stage2_complete', data: stage2Results, metadata })

      emit({ type: 'stage3_start' })
      let stage3Content = ''
      let stage3Reasoning: string | null = null
      let stage3Failed = false

      for await (const event of client.chatCompletionStream(settings, {
        model: settings.chairmanModel,
        messages: [
          {
            role: 'user',
            content: buildChairmanPrompt(content, stage1Results, stage2Results),
          },
        ],
      })) {
        if (event.delta_type === 'content') {
          const text = event.text || ''
          stage3Content += text
          emit({ type: 'stage3_delta', delta_type: 'content', text })
        } else if (event.delta_type === 'reasoning') {
          emit({ type: 'stage3_delta', delta_type: 'reasoning', text: event.text || '' })
        } else if (event.delta_type === 'final') {
          stage3Reasoning = event.reasoning_details
          if (!stage3Content && event.content) {
            stage3Content = event.content
          }
        } else if (event.delta_type === 'error') {
          stage3Failed = true
          emit({ type: 'stage3_error', message: event.message || translate(locale, 'orchestratorUnknownError') })
          break
        }
      }

      stage3Result = {
        model: settings.chairmanModel,
        response:
          stage3Content ||
          (stage3Failed
            ? translate(locale, 'orchestratorFinalSynthesisFailed')
            : translate(locale, 'orchestratorFinalSynthesisMissing')),
        reasoning_details: stage3Reasoning,
      }
      emit({ type: 'stage3_complete', data: stage3Result })
    } else {
      metadata = {
        label_to_model: {},
        aggregate_rankings: [],
        positions_by_model: {},
        stage2_parsed_rankings: [],
      }
      emit({ type: 'stage2_complete', data: [], metadata })
      emit({ type: 'stage3_start' })
      stage3Result = {
        model: settings.chairmanModel,
        response: translate(locale, 'orchestratorAllModelsFailed'),
        reasoning_details: null,
      }
      emit({ type: 'stage3_complete', data: stage3Result })
    }
  } catch (error) {
    emit({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    })

    if (!metadata) {
      metadata = {
        label_to_model: {},
        aggregate_rankings: [],
        positions_by_model: {},
        stage2_parsed_rankings: [],
      }
    }

    if (!stage3Result) {
      stage3Result = {
        model: settings.chairmanModel,
        response: translate(locale, 'orchestratorRunFailed'),
        reasoning_details: null,
      }
      emit({ type: 'stage3_complete', data: stage3Result })
    }
  }

  const title = await titlePromise
  if (title) {
    await conversationRepo.updateConversationTitle(conversationId, title)
    emit({ type: 'title_complete', data: { title } })
  }

  await conversationRepo.addAssistantMessage(conversationId, {
    id: createId('assistant'),
    stage1: stage1Results,
    stage2: stage2Results,
    stage3: stage3Result,
    metadata,
    created_at: new Date().toISOString(),
  })

  emit({ type: 'complete' })
}
