import { conversationStore } from './conversationStore'
import { chatCompletion, chatCompletionStream } from './llmClient'
import { isProviderConfigured } from './providerSettings'
import { translate } from '@/i18n'
import { isAbortError, pickBestReasoningText } from '@/utils'
import type {
  AppLocale,
  ChatCompletionClient,
  ChatCompletionMessage,
  ConversationRepository,
  MdtEventHandler,
  MdtRunOptions,
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

function getResponseLetter(index: number) {
  return String.fromCharCode(65 + index)
}

function getResponseLabel(locale: AppLocale, value: number | string) {
  const letter = typeof value === 'number' ? getResponseLetter(value) : String(value || '').trim().toUpperCase()
  return locale === 'zh-CN' ? `回答${letter}` : `Response ${letter}`
}

function getFinalRankingHeader(locale: AppLocale) {
  return locale === 'zh-CN' ? '最终排名' : 'FINAL RANKING'
}

function normalizeParsedRankingLabel(label: string, locale: AppLocale) {
  const letterMatch = String(label || '').match(/[A-Z]/i)
  if (!letterMatch) return null
  return getResponseLabel(locale, letterMatch[0])
}

function getRankingHeaderPattern(locale: AppLocale) {
  return locale === 'zh-CN' ? /最终排名\s*[：:]/ : /FINAL RANKING\s*:/i
}

function getNumberedRankingPattern(locale: AppLocale) {
  return locale === 'zh-CN'
    ? /\d+\s*[.．]\s*(回答\s*[A-Z])/gi
    : /\d+\s*[.]\s*(Response\s+[A-Z])/gi
}

function getRankingLabelPattern(locale: AppLocale) {
  return locale === 'zh-CN' ? /回答\s*[A-Z]/gi : /Response\s+[A-Z]/gi
}

function extractParsedRankingLabels(source: string, locale: AppLocale, numberedOnly = false) {
  const pattern = numberedOnly ? getNumberedRankingPattern(locale) : getRankingLabelPattern(locale)
  return [...String(source || '').matchAll(pattern)]
    .map((match) => normalizeParsedRankingLabel(match[1] || match[0], locale))
    .filter((label): label is string => Boolean(label))
}

function buildRankingPrompt(userQuery: string, stage1Results: Stage1Result[], locale: AppLocale) {
  const responsesText = stage1Results
    .map((result, index) => `${getResponseLabel(locale, index)}:\n${result.response}`)
    .join('\n\n')

  if (locale === 'zh-CN') {
    return `你是 MDT 委员会中的评审成员，需要评估同一用户问题的多个匿名回答。

要求：
1. 逐一评价每个回答的主要优点与不足。
2. 只能使用题面提供的匿名标签，不要猜测或透露模型名称。
3. 在分析结束后，再输出最终排名。

输出格式要求：
1. 在回答结尾单独输出一节，标题必须是“${getFinalRankingHeader(locale)}：”
2. 排名区块内按从优到劣列出回答。
3. 每一行必须写成“1. 回答A”这种格式，只能写编号和匿名标签。
4. 排名区块后不要再补充解释。

用户问题：
${userQuery}

匿名回答：
${responsesText}

示例格式：
回答A 的优点是……不足是……
回答B 的优点是……不足是……
回答C 的优点是……不足是……

${getFinalRankingHeader(locale)}：
1. 回答C
2. 回答A
3. 回答B

任务：请先完成逐项评估，再给出最终排名。`
  }

  return `You are a reviewer on an MDT council, evaluating multiple anonymized responses to the same user question.

Instructions:
1. Evaluate each response individually and explain its main strengths and weaknesses.
2. Use only the anonymized labels exactly as provided, and do not infer or reveal model names.
3. After the analysis, provide a final ranking.

Output format requirements:
1. At the end of your answer, include a section titled "${getFinalRankingHeader(locale)}:"
2. In that ranking block, list the responses from best to worst.
3. Each line must follow the exact format "1. Response A" with only the number and anonymized label.
4. Do not add any explanation after the ranking block.

User question:
${userQuery}

Anonymized responses:
${responsesText}

Example format:
Response A does well on... but misses...
Response B is strong on... but weak on...
Response C is the most complete because...

${getFinalRankingHeader(locale)}:
1. Response C
2. Response A
3. Response B

Task: first provide the per-response evaluation, then provide the final ranking.`
}

function buildAggregateRankingSummary(metadata: RankingMetadata | null, locale: AppLocale) {
  if (!metadata?.aggregate_rankings?.length) {
    return locale === 'zh-CN' ? '暂无汇总排名数据。' : 'No aggregate ranking summary is available.'
  }

  if (locale === 'zh-CN') {
    return metadata.aggregate_rankings
      .map(
        (item, index) =>
          `${index + 1}. ${item.model}，平均名次 ${item.average_rank.toFixed(2)}，有效票数 ${item.rankings_count}`,
      )
      .join('\n')
  }

  return metadata.aggregate_rankings
    .map(
      (item, index) =>
        `${index + 1}. ${item.model}, average rank ${item.average_rank.toFixed(2)}, ballots ${item.rankings_count}`,
    )
    .join('\n')
}

function buildChairmanPrompt(
  userQuery: string,
  stage1Results: Stage1Result[],
  stage2Results: Stage2Result[],
  metadata: RankingMetadata | null,
  locale: AppLocale,
) {
  if (locale === 'zh-CN') {
    const stage1Text = stage1Results.map((result) => `模型：${result.model}\n回答：${result.response}`).join('\n\n')
    const stage2Text = stage2Results.map((result) => `模型：${result.model}\n评议与排名：${result.ranking}`).join('\n\n')
    const aggregateSummary = buildAggregateRankingSummary(metadata, locale)

    return `你是 LLM MDT 的主席，负责综合各模型的回答、互评与投票信息，给出最终定稿。

要求：
1. 必须先总结前面的讨论情况，再给出最终综合回答。
2. 讨论总结需要概括：各家回答的主要优点与不足、投票/排名信号、明显共识、关键分歧。
3. 如果存在分歧，需要简要说明你更采纳哪一类观点以及原因。
4. 最终综合回答要吸收各家长处，修正明显错误、遗漏或表述不清之处，并直接回答用户原问题。
5. 最终输出必须严格按以下两个标题顺序书写，不能缺少，也不要新增第三个标题：
## 讨论与投票总结
## 最终综合回答
6. 第一部分保持简洁；第二部分给出完整、清晰、可执行的最终答案。

原始问题：
${userQuery}

第一阶段：各模型回答
${stage1Text}

第二阶段：互评与排名
${stage2Text}

汇总排名概览：
${aggregateSummary}

任务：请先输出“## 讨论与投票总结”，再输出“## 最终综合回答”。`
  }

  const stage1Text = stage1Results.map((result) => `Model: ${result.model}\nResponse: ${result.response}`).join('\n\n')
  const stage2Text = stage2Results.map((result) => `Model: ${result.model}\nReview and ranking: ${result.ranking}`).join('\n\n')
  const aggregateSummary = buildAggregateRankingSummary(metadata, locale)

  return `You are the chairman of an LLM MDT. Your job is to synthesize the models' answers, peer reviews, and voting signals into the final answer.

Instructions:
1. You must summarize the earlier deliberation before giving the final synthesized answer.
2. The deliberation summary should cover: major strengths and weaknesses of the candidate answers, peer ranking signals, clear areas of agreement, and key disagreements.
3. If there are disagreements, briefly state which view you trust more and why.
4. The final synthesized answer should combine the best parts of the earlier responses, correct clear mistakes or omissions, and directly answer the original user question.
5. Your final output must use exactly these two section headings in this order, with no third heading:
## Deliberation Summary
## Final Synthesized Answer
6. Keep the first section concise, and make the second section complete, clear, and actionable.

Original question:
${userQuery}

Stage 1 - Individual Responses:
${stage1Text}

Stage 2 - Peer Reviews and Rankings:
${stage2Text}

Aggregate ranking snapshot:
${aggregateSummary}

Task: first output "## Deliberation Summary", then output "## Final Synthesized Answer".`
}

function buildTitlePrompt(userQuery: string, locale: AppLocale) {
  if (locale === 'zh-CN') {
    return `你负责为对话生成标题。

要求：
1. 输出一个简洁、准确的中文标题。
2. 标题尽量控制在 12 个字以内。
3. 不要使用引号或句末标点。
4. 只输出标题本身，不要添加解释。

问题：
${userQuery}

任务：请输出标题。`
  }

  return `You generate titles for conversations.

Instructions:
1. Return a concise, descriptive English title.
2. Use 3-5 words maximum.
3. Do not use quotes or ending punctuation.
4. Return only the title itself with no explanation.

Question:
${userQuery}

Task: provide the title.`
}

export function parseRankingFromText(rankingText: string, locale: AppLocale = 'en') {
  const source = String(rankingText || '')
  const headerMatch = source.match(getRankingHeaderPattern(locale))
  const rankingSection =
    headerMatch && typeof headerMatch.index === 'number' ? source.slice(headerMatch.index + headerMatch[0].length) : source

  const numberedMatches = extractParsedRankingLabels(rankingSection, locale, true)
  if (numberedMatches.length > 0) {
    return numberedMatches
  }

  const sectionMatches = extractParsedRankingLabels(rankingSection, locale)
  if (sectionMatches.length > 0) {
    return sectionMatches
  }

  return extractParsedRankingLabels(source, locale)
}

export function calculateRankingDetails(
  stage2Results: Array<Pick<Stage2Result, 'model' | 'ranking' | 'parsed_ranking'>>,
  labelToModel: Record<string, string>,
  locale: AppLocale,
): RankingMetadata {
  const positionsByModel: Record<string, number[]> = {}
  const stage2ParsedRankings: ParsedStage2Ranking[] = []

  for (const ranking of stage2Results || []) {
    const voterModel = ranking.model || ''
    const parsedRanking =
      ranking.parsed_ranking?.length > 0 ? ranking.parsed_ranking : parseRankingFromText(ranking.ranking || '', locale)

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
  signal,
}: {
  stagePrefix: 'stage1' | 'stage2'
  models: string[]
  messages: ChatCompletionMessage[]
  settings: ProviderSettings
  client: ChatCompletionClient
  emit: (event: MdtStreamEvent) => void
  valueKey: 'response' | 'ranking'
  locale: AppLocale
  signal?: AbortSignal
}) {
  emit({ type: `${stagePrefix}_start` } as MdtStreamEvent)

  const resultsByModel = new Map<string, Stage1Result | Stage2Result>()

  await Promise.all(
    models.map(async (model) => {
      emit({ type: `${stagePrefix}_model_start`, model } as MdtStreamEvent)

      let contentAcc = ''
      let reasoningDetails: string | null = null
      let reasoningAcc = ''
      let failed = false

      try {
        for await (const event of client.chatCompletionStream(settings, { model, messages, signal })) {
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
            reasoningAcc += event.text || ''
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
        if (isAbortError(error)) {
          throw error
        }
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
                reasoning_details: pickBestReasoningText(reasoningDetails, reasoningAcc) || null,
              }
            : {
                model,
                ranking: contentAcc,
                parsed_ranking: [],
                reasoning_details: pickBestReasoningText(reasoningDetails, reasoningAcc) || null,
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
  signal?: AbortSignal,
) {
  const titleModel = settings.titleModel || settings.chairmanModel
  if (!titleModel) {
    return translate(locale, 'conversationUntitled')
  }

  try {
    const response = await client.chatCompletion(settings, {
      model: titleModel,
      messages: [{ role: 'user', content: buildTitlePrompt(userQuery, locale) }],
      timeoutMs: 30000,
      signal,
    })

    const title = String(response.content || translate(locale, 'conversationUntitled'))
      .trim()
      .replace(/^["']+|["']+$/g, '')

    if (!title) {
      return translate(locale, 'conversationUntitled')
    }

    return title.length > 50 ? `${title.slice(0, 47)}...` : title
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }
    return translate(locale, 'conversationUntitled')
  }
}

export async function runMdtConversationStream({
  conversationId,
  content,
  locale = 'zh-CN',
  settings,
  onEvent,
  options,
  conversationRepo = conversationStore,
  client = { chatCompletion, chatCompletionStream },
}: {
  conversationId: string
  content: string
  locale?: AppLocale
  settings: ProviderSettings
  onEvent?: MdtEventHandler
  options?: MdtRunOptions
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

  const isFirstMessage =
    typeof options?.shouldGenerateTitle === 'boolean'
      ? options.shouldGenerateTitle
      : (conversation.messages || []).length === 0
  const titlePromise = isFirstMessage
    ? generateConversationTitle(content, settings, client, locale, options?.signal).catch((error) => {
        if (isAbortError(error)) {
          return null
        }
        throw error
      })
    : Promise.resolve<string | null>(null)

  if (options?.persistUserMessage !== false) {
    await conversationRepo.addUserMessage(conversationId, content)
  }

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
      signal: options?.signal,
    })) as Stage1Result[]
    emit({ type: 'stage1_complete', data: stage1Results })

    if (stage1Results.length > 0) {
      const labelToModel = Object.fromEntries(
        stage1Results.map((result, index) => [getResponseLabel(locale, index), result.model]),
      ) as Record<string, string>

      stage2Results = (await collectStageResponses({
        stagePrefix: 'stage2',
        models: settings.councilModels,
        messages: [{ role: 'user', content: buildRankingPrompt(content, stage1Results, locale) }],
        settings,
        client,
        emit,
        valueKey: 'ranking',
        locale,
        signal: options?.signal,
      })) as Stage2Result[]
      stage2Results = stage2Results.map((result) => ({
        ...result,
        parsed_ranking: parseRankingFromText(result.ranking, locale),
      }))

      metadata = calculateRankingDetails(stage2Results, labelToModel, locale)
      emit({ type: 'stage2_complete', data: stage2Results, metadata })

      emit({ type: 'stage3_start' })
      let stage3Content = ''
      let stage3Reasoning: string | null = null
      let stage3ReasoningAcc = ''
      let stage3Diagnostics = null
      let stage3Failed = false

      for await (const event of client.chatCompletionStream(settings, {
        model: settings.chairmanModel,
        messages: [
          {
            role: 'user',
            content: buildChairmanPrompt(content, stage1Results, stage2Results, metadata, locale),
          },
        ],
        signal: options?.signal,
      })) {
        if (event.delta_type === 'content') {
          const text = event.text || ''
          stage3Content += text
          emit({ type: 'stage3_delta', delta_type: 'content', text })
        } else if (event.delta_type === 'reasoning') {
          stage3ReasoningAcc += event.text || ''
          emit({ type: 'stage3_delta', delta_type: 'reasoning', text: event.text || '' })
        } else if (event.delta_type === 'final') {
          stage3Reasoning = event.reasoning_details
          stage3Diagnostics = event.diagnostics || null
          if (!stage3Content && event.content) {
            stage3Content = event.content
          }
        } else if (event.delta_type === 'error') {
          stage3Failed = true
          stage3Diagnostics = event.diagnostics || null
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
        reasoning_details: pickBestReasoningText(stage3Reasoning, stage3ReasoningAcc) || null,
        diagnostics: stage3Diagnostics,
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
    if (isAbortError(error)) {
      emit({ type: 'stopped' })
      return
    }

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

  if (options?.assistantMessageId) {
    const latestConversation = await conversationRepo.getConversation(conversationId)
    if (!latestConversation) {
      throw new Error(translate(locale, 'orchestratorConversationNotFound'))
    }

    const messageIndex = latestConversation.messages.findIndex(
      (message) => message.role === 'assistant' && message.id === options.assistantMessageId,
    )

    const nextAssistantMessage = {
      id: options.assistantMessageId,
      role: 'assistant' as const,
      stage1: stage1Results,
      stage2: stage2Results,
      stage3: stage3Result,
      metadata,
      created_at:
        options.assistantMessageCreatedAt ||
        (messageIndex >= 0 ? latestConversation.messages[messageIndex]?.created_at : undefined) ||
        new Date().toISOString(),
    }

    if (messageIndex >= 0) {
      latestConversation.messages[messageIndex] = nextAssistantMessage
    } else {
      latestConversation.messages.push(nextAssistantMessage)
    }

    await conversationRepo.saveConversation(latestConversation)
  } else {
    await conversationRepo.addAssistantMessage(conversationId, {
      id: createId('assistant'),
      stage1: stage1Results,
      stage2: stage2Results,
      stage3: stage3Result,
      metadata,
      created_at: new Date().toISOString(),
    })
  }

  emit({ type: 'complete' })
}
