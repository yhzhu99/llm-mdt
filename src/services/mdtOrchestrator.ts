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

interface PromptCopy {
  languageName: string
  panelName: string
  memberRole: string
  chairRole: string
  titleRole: string
  finalRankingTitle: string
  stage2ReviewsHeading: string
  stage2StrengthsLabel: string
  stage2WeaknessesLabel: string
  stage3SummaryHeading: string
  stage3SummaryAgreementsLabel: string
  stage3SummaryDisagreementsLabel: string
  stage3SummaryDecisionLabel: string
  stage3AnswerHeading: string
}

function getPromptCopy(locale: AppLocale): PromptCopy {
  if (locale === 'zh-CN') {
    return {
      languageName: '中文',
      panelName: '多模型会诊委员会',
      memberRole: '会诊委员',
      chairRole: '会诊主席',
      titleRole: '标题拟定人',
      finalRankingTitle: '最终排名',
      stage2ReviewsHeading: '## 单项评议',
      stage2StrengthsLabel: '优点',
      stage2WeaknessesLabel: '不足',
      stage3SummaryHeading: '## 讨论与投票总结',
      stage3SummaryAgreementsLabel: '主要共识',
      stage3SummaryDisagreementsLabel: '主要分歧',
      stage3SummaryDecisionLabel: '采纳理由',
      stage3AnswerHeading: '## 最终综合回答',
    }
  }

  return {
    languageName: 'English',
    panelName: 'multi-model consultation panel',
    memberRole: 'panel member',
    chairRole: 'panel chair',
    titleRole: 'title writer',
    finalRankingTitle: 'FINAL RANKING',
    stage2ReviewsHeading: '## Individual Reviews',
    stage2StrengthsLabel: 'Strengths',
    stage2WeaknessesLabel: 'Weaknesses',
    stage3SummaryHeading: '## Deliberation Summary',
    stage3SummaryAgreementsLabel: 'Main agreements',
    stage3SummaryDisagreementsLabel: 'Main disagreements',
    stage3SummaryDecisionLabel: 'Why this synthesis',
    stage3AnswerHeading: '## Final Synthesized Answer',
  }
}

function buildXmlAttributes(attributes?: Record<string, string>) {
  const entries = Object.entries(attributes || {}).filter(([, value]) => Boolean(value))
  if (entries.length === 0) return ''
  return ` ${entries.map(([key, value]) => `${key}="${value.replace(/"/g, '&quot;')}"`).join(' ')}`
}

function buildXmlBlock(tag: string, content: string, attributes?: Record<string, string>) {
  return `<${tag}${buildXmlAttributes(attributes)}>\n${String(content || '').trim()}\n</${tag}>`
}

function buildPromptDocument(
  stage: 'stage1' | 'stage2' | 'stage3' | 'title',
  locale: AppLocale,
  sections: string[],
) {
  return [`<mdt_prompt${buildXmlAttributes({ stage, locale })}>`, ...sections, '</mdt_prompt>'].join('\n\n')
}

function buildNumberedRules(items: string[]) {
  return items.map((item, index) => `${index + 1}. ${item}`).join('\n')
}

function getResponseLetter(index: number) {
  return String.fromCharCode(65 + index)
}

function getResponseLabel(locale: AppLocale, value: number | string) {
  const letter = typeof value === 'number' ? getResponseLetter(value) : String(value || '').trim().toUpperCase()
  return locale === 'zh-CN' ? `回答${letter}` : `Response ${letter}`
}

function normalizeParsedRankingLabel(label: string, locale: AppLocale) {
  const letterMatch = String(label || '').match(/[A-Z]/i)
  if (!letterMatch) return null
  return getResponseLabel(locale, letterMatch[0])
}

function getRankingHeaderPattern(locale: AppLocale) {
  return locale === 'zh-CN'
    ? /(^|\n)\s{0,3}(?:##\s*)?最终排名(?:\s*[：:])?/im
    : /(^|\n)\s{0,3}(?:##\s*)?FINAL RANKING(?:\s*:)?/im
}

function getNumberedRankingPattern(locale: AppLocale) {
  return locale === 'zh-CN'
    ? /\d+\s*[.．]\s*(回答\s*[A-Z])/gi
    : /\d+\s*[.]\s*(Response\s*[A-Z])/gi
}

function getRankingLabelPattern(locale: AppLocale) {
  return locale === 'zh-CN' ? /回答\s*[A-Z]/gi : /Response\s*[A-Z]/gi
}

function extractParsedRankingLabels(source: string, locale: AppLocale, numberedOnly = false) {
  const pattern = numberedOnly ? getNumberedRankingPattern(locale) : getRankingLabelPattern(locale)
  return [...String(source || '').matchAll(pattern)]
    .map((match) => normalizeParsedRankingLabel(match[1] || match[0], locale))
    .filter((label): label is string => Boolean(label))
}

function buildStage2ResponseMaterials(stage1Results: Stage1Result[], locale: AppLocale) {
  return stage1Results
    .map((result, index) =>
      buildXmlBlock('response', result.response, {
        id: getResponseLetter(index),
        label: getResponseLabel(locale, index),
      }),
    )
    .join('\n\n')
}

function buildStage2ReviewTemplate(stage1Results: Stage1Result[], locale: AppLocale) {
  const copy = getPromptCopy(locale)
  const reviewBlocks = stage1Results
    .map(
      (_, index) => `### ${getResponseLabel(locale, index)}
- ${copy.stage2StrengthsLabel}: ...
- ${copy.stage2WeaknessesLabel}: ...`,
    )
    .join('\n\n')
  const rankingLines = stage1Results
    .map((_, index) => `${index + 1}. ${locale === 'zh-CN' ? '回答<字母>' : 'Response <LETTER>'}`)
    .join('\n')

  if (locale === 'zh-CN') {
    return `你必须严格按照以下结构输出：

${copy.stage2ReviewsHeading}

${reviewBlocks}

## ${copy.finalRankingTitle}
${rankingLines}

请将“<字母>”替换为实际的匿名标签字母，并确保每个标签只出现一次。
在“## ${copy.finalRankingTitle}”之后不要输出任何额外内容。`
  }

  return `You must follow this exact structure:

${copy.stage2ReviewsHeading}

${reviewBlocks}

## ${copy.finalRankingTitle}
${rankingLines}

Replace "<LETTER>" with the actual anonymized label letter, and use each label exactly once.
Do not output anything after "## ${copy.finalRankingTitle}".`
}

function buildAnonymizedResponseLabelMap(stage1Results: Stage1Result[], locale: AppLocale) {
  return new Map(stage1Results.map((result, index) => [result.model, getResponseLabel(locale, index)]))
}

function buildRankingPrompt(userQuery: string, stage1Results: Stage1Result[], locale: AppLocale) {
  const copy = getPromptCopy(locale)

  if (locale === 'zh-CN') {
    return buildPromptDocument('stage2', locale, [
      buildXmlBlock('role', `你是${copy.panelName}中的一名${copy.memberRole}。`),
      buildXmlBlock('objective', '评估多个匿名候选回答，并给出最终排名。'),
      buildXmlBlock('language_policy', `所有可见输出必须使用${copy.languageName}。`),
      buildXmlBlock(
        'given_materials',
        [buildXmlBlock('user_question', userQuery), buildXmlBlock('candidate_responses', buildStage2ResponseMaterials(stage1Results, locale))].join('\n\n'),
      ),
      buildXmlBlock(
        'instructions',
        buildNumberedRules([
          '逐一评估每个匿名回答的主要优点与不足。',
          '比较这些回答的准确性、完整性、相关性、推理质量和表达清晰度。',
          '先完成全部单项评议，再给出最终排名。',
        ]),
      ),
      buildXmlBlock(
        'hard_constraints',
        buildNumberedRules([
          '只能使用给定的匿名标签，不要猜测或透露任何模型身份。',
          '不要复述这些 XML 标签，也不要解释你的格式选择。',
          `必须严格遵守 <output_contract> 中的标题和子结构，尤其是“## ${copy.finalRankingTitle}”部分。`,
          `在“## ${copy.finalRankingTitle}”之后不要输出任何额外内容。`,
        ]),
      ),
      buildXmlBlock('output_contract', buildStage2ReviewTemplate(stage1Results, locale)),
      buildXmlBlock('task', '请根据给定材料完成单项评议，并给出最终排名。'),
    ])
  }

  return buildPromptDocument('stage2', locale, [
    buildXmlBlock('role', `You are a ${copy.memberRole} on a ${copy.panelName}.`),
    buildXmlBlock('objective', 'Evaluate multiple anonymized candidate responses and produce a final ranking.'),
    buildXmlBlock('language_policy', `All visible output must be in ${copy.languageName}.`),
    buildXmlBlock(
      'given_materials',
      [buildXmlBlock('user_question', userQuery), buildXmlBlock('candidate_responses', buildStage2ResponseMaterials(stage1Results, locale))].join('\n\n'),
    ),
    buildXmlBlock(
      'instructions',
      buildNumberedRules([
        'Evaluate the main strengths and weaknesses of each anonymized response one by one.',
        'Compare the responses for accuracy, completeness, relevance, reasoning quality, and clarity.',
        'Finish all individual reviews before giving the final ranking.',
      ]),
    ),
    buildXmlBlock(
      'hard_constraints',
      buildNumberedRules([
        'Use only the given anonymized labels and do not infer or reveal model identities.',
        'Do not reproduce these XML tags or explain your formatting choices.',
        `Follow the headings and substructure in <output_contract> exactly, especially the "## ${copy.finalRankingTitle}" section.`,
        `Do not output anything after "## ${copy.finalRankingTitle}".`,
      ]),
    ),
    buildXmlBlock('output_contract', buildStage2ReviewTemplate(stage1Results, locale)),
    buildXmlBlock('task', 'Using the given materials, complete the individual reviews and then provide the final ranking.'),
  ])
}

function buildAggregateRankingSummary(metadata: RankingMetadata | null, stage1Results: Stage1Result[], locale: AppLocale) {
  if (!metadata?.aggregate_rankings?.length) {
    return buildXmlBlock('note', locale === 'zh-CN' ? '暂无汇总排名数据。' : 'No aggregate ranking summary is available.')
  }

  const modelToLabel = buildAnonymizedResponseLabelMap(stage1Results, locale)

  return metadata.aggregate_rankings
    .map(
      (item, index) =>
        buildXmlBlock(
          'ranking',
          locale === 'zh-CN'
            ? `平均名次：${item.average_rank.toFixed(2)}\n有效票数：${item.rankings_count}`
            : `Average rank: ${item.average_rank.toFixed(2)}\nBallots: ${item.rankings_count}`,
          {
            position: String(index + 1),
            label: modelToLabel.get(item.model) || getResponseLabel(locale, index),
          },
        ),
    )
    .join('\n\n')
}

function buildStage3ResponseMaterials(stage1Results: Stage1Result[], locale: AppLocale) {
  return stage1Results
    .map((result, index) =>
      buildXmlBlock('response', result.response, {
        id: getResponseLetter(index),
        label: getResponseLabel(locale, index),
      }),
    )
    .join('\n\n')
}

function buildStage3ReviewMaterials(stage2Results: Stage2Result[]) {
  return stage2Results
    .map((result, index) => buildXmlBlock('review', result.ranking, { reviewer_id: `R${index + 1}` }))
    .join('\n\n')
}

function buildStage3OutputContract(locale: AppLocale) {
  const copy = getPromptCopy(locale)

  if (locale === 'zh-CN') {
    return `你必须严格按照以下结构输出：

${copy.stage3SummaryHeading}
- ${copy.stage3SummaryAgreementsLabel}：...
- ${copy.stage3SummaryDisagreementsLabel}：...
- ${copy.stage3SummaryDecisionLabel}：...

${copy.stage3AnswerHeading}
直接给出最终综合回答。

不要添加第三个标题。`
  }

  return `You must follow this exact structure:

${copy.stage3SummaryHeading}
- ${copy.stage3SummaryAgreementsLabel}: ...
- ${copy.stage3SummaryDisagreementsLabel}: ...
- ${copy.stage3SummaryDecisionLabel}: ...

${copy.stage3AnswerHeading}
Give the final synthesized answer directly.

Do not add a third heading.`
}

function buildChairmanPrompt(
  userQuery: string,
  stage1Results: Stage1Result[],
  stage2Results: Stage2Result[],
  metadata: RankingMetadata | null,
  locale: AppLocale,
) {
  const copy = getPromptCopy(locale)

  if (locale === 'zh-CN') {
    return buildPromptDocument('stage3', locale, [
      buildXmlBlock('role', `你是${copy.panelName}的${copy.chairRole}。`),
      buildXmlBlock('objective', '综合前面各方材料，形成最终综合回答。'),
      buildXmlBlock('language_policy', `所有可见输出必须使用${copy.languageName}。`),
      buildXmlBlock(
        'given_materials',
        [
          buildXmlBlock('user_question', userQuery),
          buildXmlBlock('stage1_responses', buildStage3ResponseMaterials(stage1Results, locale)),
          buildXmlBlock('stage2_reviews', buildStage3ReviewMaterials(stage2Results)),
          buildXmlBlock('aggregate_rankings', buildAggregateRankingSummary(metadata, stage1Results, locale)),
        ].join('\n\n'),
      ),
      buildXmlBlock(
        'instructions',
        buildNumberedRules([
          '先总结前面的讨论、投票和主要观点，再给出最终综合回答。',
          '在总结中说明主要共识、主要分歧，以及你最终采纳哪些观点。',
          '最终综合回答要吸收前面材料中的长处，修正明显错误、遗漏或不清晰之处。',
        ]),
      ),
      buildXmlBlock(
        'hard_constraints',
        buildNumberedRules([
          '不要提及这些 XML 标签，也不要解释你的格式选择。',
          '只能依据匿名回答、匿名评议和匿名排名信号进行综合，不要猜测或提及底层模型身份。',
          `必须严格遵守 <output_contract> 中的两个标题结构：${copy.stage3SummaryHeading} 和 ${copy.stage3AnswerHeading}。`,
          '第一部分保持简洁，第二部分直接回答用户问题。',
          '不要添加第三个标题，也不要在最后补充格式说明。',
        ]),
      ),
      buildXmlBlock('output_contract', buildStage3OutputContract(locale)),
      buildXmlBlock('task', '请根据给定材料，先总结讨论与投票情况，再给出最终综合回答。'),
    ])
  }

  return buildPromptDocument('stage3', locale, [
    buildXmlBlock('role', `You are the ${copy.chairRole} of a ${copy.panelName}.`),
    buildXmlBlock('objective', 'Synthesize the earlier materials into the final answer.'),
    buildXmlBlock('language_policy', `All visible output must be in ${copy.languageName}.`),
    buildXmlBlock(
      'given_materials',
      [
        buildXmlBlock('user_question', userQuery),
        buildXmlBlock('stage1_responses', buildStage3ResponseMaterials(stage1Results, locale)),
        buildXmlBlock('stage2_reviews', buildStage3ReviewMaterials(stage2Results)),
        buildXmlBlock('aggregate_rankings', buildAggregateRankingSummary(metadata, stage1Results, locale)),
      ].join('\n\n'),
    ),
    buildXmlBlock(
      'instructions',
      buildNumberedRules([
        'Summarize the earlier discussion, voting signals, and major viewpoints before giving the final synthesized answer.',
        'In the summary, identify the main agreements, main disagreements, and which viewpoints you ultimately adopt.',
        'In the final synthesized answer, keep the strongest parts of the earlier materials and correct clear mistakes, omissions, or unclear statements.',
      ]),
    ),
    buildXmlBlock(
      'hard_constraints',
      buildNumberedRules([
        'Do not mention these XML tags or explain your formatting choices.',
        'Use only the anonymized responses, anonymized reviews, and anonymized ranking signals; do not infer or mention underlying model identities.',
        `Follow the two-heading structure in <output_contract> exactly: ${copy.stage3SummaryHeading} and ${copy.stage3AnswerHeading}.`,
        'Keep the first section concise and make the second section directly answer the user question.',
        'Do not add a third heading or any trailing format note.',
      ]),
    ),
    buildXmlBlock('output_contract', buildStage3OutputContract(locale)),
    buildXmlBlock('task', 'Using the given materials, summarize the deliberation first and then provide the final synthesized answer.'),
  ])
}

function buildTitlePrompt(userQuery: string, locale: AppLocale) {
  const copy = getPromptCopy(locale)

  if (locale === 'zh-CN') {
    return buildPromptDocument('title', locale, [
      buildXmlBlock('role', `你是${copy.panelName}对话的${copy.titleRole}。`),
      buildXmlBlock('objective', '为本次对话拟定一个简洁、准确的标题。'),
      buildXmlBlock('language_policy', `所有可见输出必须使用${copy.languageName}。`),
      buildXmlBlock('given_materials', buildXmlBlock('user_question', userQuery)),
      buildXmlBlock(
        'instructions',
        buildNumberedRules([
          '标题应准确概括用户问题。',
          '标题尽量控制在 12 个字以内。',
          '标题要自然、简洁，不要写成完整句子。',
        ]),
      ),
      buildXmlBlock(
        'hard_constraints',
        buildNumberedRules([
          '只输出标题本身，不要输出解释、引号、编号、markdown 标题或 XML 标签。',
          '不要使用句末标点。',
          '输出必须只有一行。',
        ]),
      ),
      buildXmlBlock('output_contract', '输出一行标题，仅包含标题文本本身。'),
      buildXmlBlock('task', '请根据给定问题输出标题。'),
    ])
  }

  return buildPromptDocument('title', locale, [
    buildXmlBlock('role', `You are the ${copy.titleRole} for a ${copy.panelName} conversation.`),
    buildXmlBlock('objective', 'Create a concise and accurate title for this conversation.'),
    buildXmlBlock('language_policy', `All visible output must be in ${copy.languageName}.`),
    buildXmlBlock('given_materials', buildXmlBlock('user_question', userQuery)),
    buildXmlBlock(
      'instructions',
      buildNumberedRules([
        "The title should summarize the user's question accurately.",
        'Keep the title concise and descriptive.',
        'Prefer 3-5 words when possible.',
      ]),
    ),
    buildXmlBlock(
      'hard_constraints',
      buildNumberedRules([
        'Output only the title text with no explanation, quotes, numbering, markdown heading, or XML tags.',
        'Do not use ending punctuation.',
        'The output must be a single line.',
      ]),
    ),
    buildXmlBlock('output_contract', 'Output exactly one line containing only the title text.'),
    buildXmlBlock('task', 'Please provide the title for the given question.'),
  ])
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
