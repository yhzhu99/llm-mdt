export type MessageRole = 'user' | 'assistant'
export type StreamDeltaType = 'content' | 'reasoning'
export type StreamStatus = 'idle' | 'running' | 'complete' | 'error'
export type AppLocale = 'zh-CN' | 'en'

export interface ProviderSettings {
  baseUrl: string
  apiKey: string
  councilModels: string[]
  chairmanModel: string
  titleModel: string
  extraHeaders: Record<string, string>
}

export interface ProviderSettingsInput {
  baseUrl?: string
  apiKey?: string
  councilModels?: string[] | string
  chairmanModel?: string
  titleModel?: string
  extraHeaders?: Record<string, string>
}

export interface RuntimeConfig {
  configured: boolean
  council_models: string[]
  chairman_model: string
  title_model: string
  base_url: string
}

export interface AppPreferences {
  locale: AppLocale
}

export interface Project {
  id: string
  name: string
  created_at: string
  is_default?: boolean
}

export interface ProjectSummary {
  id: string
  name: string
  created_at: string
  conversation_count: number
  is_default?: boolean
}

export interface ConversationSummary {
  id: string
  project_id: string
  created_at: string
  title: string
  message_count: number
}

export interface UserConversationMessage {
  id?: string
  role: 'user'
  content: string
  created_at?: string
}

export interface Stage1Result {
  model: string
  response: string
  reasoning_details: string | null
}

export interface Stage2Result {
  model: string
  ranking: string
  parsed_ranking: string[]
  reasoning_details: string | null
}

export interface Stage3Result {
  model: string
  response: string
  reasoning_details: string | null
}

export interface AggregateRanking {
  model: string
  average_rank: number
  rankings_count: number
}

export interface ParsedStage2Ranking {
  voter_model: string
  parsed_ranking: string[]
}

export interface RankingMetadata {
  label_to_model: Record<string, string>
  aggregate_rankings: AggregateRanking[]
  positions_by_model: Record<string, number[]>
  stage2_parsed_rankings: ParsedStage2Ranking[]
}

export interface Stage1StreamState {
  response: string
  thinking: string
}

export interface Stage2StreamState {
  ranking: string
  thinking: string
}

export interface Stage3StreamState {
  response: string
  thinking: string
}

export interface StreamStatusMeta {
  status: StreamStatus
  message?: string
}

export interface AssistantStreamState {
  stage1: Record<string, Stage1StreamState>
  stage2: Record<string, Stage2StreamState>
  stage3: Stage3StreamState
}

export interface AssistantStreamMeta {
  stage1: Record<string, StreamStatusMeta>
  stage2: Record<string, StreamStatusMeta>
  stage3: StreamStatusMeta
}

export interface AssistantLoadingState {
  stage1: boolean
  stage2: boolean
  stage3: boolean
}

export interface AssistantConversationMessage {
  id: string
  role: 'assistant'
  stage1: Stage1Result[] | null
  stage2: Stage2Result[] | null
  stage3: Stage3Result | null
  metadata: RankingMetadata | null
  created_at?: string
  stream?: AssistantStreamState
  streamMeta?: AssistantStreamMeta
  loading?: AssistantLoadingState
}

export type ConversationMessage = UserConversationMessage | AssistantConversationMessage

export interface Conversation {
  id: string
  project_id: string
  created_at: string
  title: string
  messages: ConversationMessage[]
}

export interface AssistantMessageRecord {
  id?: string
  stage1?: Stage1Result[]
  stage2?: Stage2Result[]
  stage3?: Stage3Result | null
  metadata?: RankingMetadata | null
  created_at?: string
}

export interface HealthStatus {
  status: 'ready' | 'unconfigured'
  mode: 'browser-only'
}

export interface SendMessagePayload {
  content: string
}

export interface SendMessageResult {
  stage1: Stage1Result[]
  stage2: Stage2Result[]
  stage3: Stage3Result | null
  metadata: RankingMetadata | null
}

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatCompletionOptions {
  model: string
  messages: ChatCompletionMessage[]
  timeoutMs?: number
}

export interface ChatCompletionResult {
  content: string
  reasoning_details: string | null
}

export type ChatCompletionStreamEvent =
  | { delta_type: 'content'; text: string }
  | { delta_type: 'reasoning'; text: string }
  | { delta_type: 'final'; content: string; reasoning_details: string | null }
  | { delta_type: 'error'; message: string }

export interface ChatCompletionClient {
  chatCompletion: (
    settings: ProviderSettings,
    options: ChatCompletionOptions,
  ) => Promise<ChatCompletionResult>
  chatCompletionStream: (
    settings: ProviderSettings,
    options: ChatCompletionOptions,
  ) => AsyncGenerator<ChatCompletionStreamEvent>
}

export interface ConversationRepository {
  createConversation: (conversationId?: string) => Promise<Conversation>
  getConversation: (conversationId: string) => Promise<Conversation | null>
  saveConversation: (conversation: Conversation) => Promise<Conversation>
  addUserMessage: (conversationId: string, content: string) => Promise<Conversation>
  addAssistantMessage: (
    conversationId: string,
    message: AssistantMessageRecord,
  ) => Promise<Conversation>
  updateConversationTitle: (conversationId: string, title: string) => Promise<Conversation>
  deleteConversation?: (conversationId: string) => Promise<boolean>
}

export interface MdtStage1StartEvent {
  type: 'stage1_start'
}

export interface MdtStage1ModelStartEvent {
  type: 'stage1_model_start'
  model: string
}

export interface MdtStage1ModelDeltaEvent {
  type: 'stage1_model_delta'
  model: string
  delta_type: StreamDeltaType
  text: string
}

export interface MdtStage1ModelErrorEvent {
  type: 'stage1_model_error'
  model: string
  message: string
}

export interface MdtStage1CompleteEvent {
  type: 'stage1_complete'
  data: Stage1Result[]
}

export interface MdtStage2StartEvent {
  type: 'stage2_start'
}

export interface MdtStage2ModelStartEvent {
  type: 'stage2_model_start'
  model: string
}

export interface MdtStage2ModelDeltaEvent {
  type: 'stage2_model_delta'
  model: string
  delta_type: StreamDeltaType
  text: string
}

export interface MdtStage2ModelErrorEvent {
  type: 'stage2_model_error'
  model: string
  message: string
}

export interface MdtStage2CompleteEvent {
  type: 'stage2_complete'
  data: Stage2Result[]
  metadata: RankingMetadata
}

export interface MdtStage3StartEvent {
  type: 'stage3_start'
}

export interface MdtStage3DeltaEvent {
  type: 'stage3_delta'
  delta_type: StreamDeltaType
  text: string
}

export interface MdtStage3ErrorEvent {
  type: 'stage3_error'
  message: string
}

export interface MdtStage3CompleteEvent {
  type: 'stage3_complete'
  data: Stage3Result
}

export interface MdtTitleCompleteEvent {
  type: 'title_complete'
  data: {
    title: string
  }
}

export interface MdtErrorEvent {
  type: 'error'
  message: string
}

export interface MdtCompleteEvent {
  type: 'complete'
}

export type MdtStreamEvent =
  | MdtStage1StartEvent
  | MdtStage1ModelStartEvent
  | MdtStage1ModelDeltaEvent
  | MdtStage1ModelErrorEvent
  | MdtStage1CompleteEvent
  | MdtStage2StartEvent
  | MdtStage2ModelStartEvent
  | MdtStage2ModelDeltaEvent
  | MdtStage2ModelErrorEvent
  | MdtStage2CompleteEvent
  | MdtStage3StartEvent
  | MdtStage3DeltaEvent
  | MdtStage3ErrorEvent
  | MdtStage3CompleteEvent
  | MdtTitleCompleteEvent
  | MdtErrorEvent
  | MdtCompleteEvent

export type MdtEventHandler = (eventType: MdtStreamEvent['type'], event: MdtStreamEvent) => void
