import { describe, expect, it } from 'vitest';
import {
  calculateRankingDetails,
  parseRankingFromText,
  runMdtConversationStream,
} from './mdtOrchestrator';

function createMemoryRepo() {
  const conversations = new Map();

  const clone = (value) => JSON.parse(JSON.stringify(value));

  return {
    async createConversation(id) {
      const conversation = {
        id,
        created_at: '2026-03-06T00:00:00.000Z',
        title: 'New Conversation',
        messages: [],
      };
      conversations.set(id, clone(conversation));
      return clone(conversation);
    },
    async getConversation(id) {
      return conversations.has(id) ? clone(conversations.get(id)) : null;
    },
    async addUserMessage(id, content) {
      const conversation = conversations.get(id);
      conversation.messages.push({ role: 'user', content });
      conversations.set(id, conversation);
      return clone(conversation);
    },
    async updateConversationTitle(id, title) {
      const conversation = conversations.get(id);
      conversation.title = title;
      conversations.set(id, conversation);
      return clone(conversation);
    },
    async addAssistantMessage(id, message) {
      const conversation = conversations.get(id);
      conversation.messages.push({
        role: 'assistant',
        ...message,
      });
      conversations.set(id, conversation);
      return clone(conversation);
    },
  };
}

function createMockClient() {
  const streamQueues = {
    'openai/a': [
      [
        { delta_type: 'content', text: 'Stage 1 answer A' },
        { delta_type: 'final', content: 'Stage 1 answer A', reasoning_details: 'thinking A' },
      ],
      [
        {
          delta_type: 'content',
          text: 'Review A\n\nFINAL RANKING:\n1. Response A',
        },
        {
          delta_type: 'final',
          content: 'Review A\n\nFINAL RANKING:\n1. Response A',
          reasoning_details: 'ranking A',
        },
      ],
    ],
    'openai/b': [
      [{ delta_type: 'error', message: 'CORS blocked' }],
      [
        {
          delta_type: 'content',
          text: 'Review B\n\nFINAL RANKING:\n1. Response A',
        },
        {
          delta_type: 'final',
          content: 'Review B\n\nFINAL RANKING:\n1. Response A',
          reasoning_details: 'ranking B',
        },
      ],
    ],
    'openai/chair': [
      [
        { delta_type: 'content', text: 'Synthesized final answer' },
        {
          delta_type: 'final',
          content: 'Synthesized final answer',
          reasoning_details: 'chair reasoning',
        },
      ],
    ],
  };

  return {
    async chatCompletion() {
      return { content: 'Browser title' };
    },
    async *chatCompletionStream(_settings, { model }) {
      const queue = streamQueues[model];
      const next = queue?.shift() || [];
      for (const event of next) {
        yield event;
      }
    },
  };
}

describe('mdtOrchestrator helpers', () => {
  it('parses rankings and aggregate metadata', () => {
    expect(
      parseRankingFromText('Analysis\n\nFINAL RANKING:\n1. Response B\n2. Response A')
    ).toEqual(['Response B', 'Response A']);

    expect(
      calculateRankingDetails(
        [
          {
            model: 'judge',
            ranking: 'FINAL RANKING:\n1. Response B\n2. Response A',
          },
        ],
        {
          'Response A': 'openai/a',
          'Response B': 'openai/b',
        }
      )
    ).toEqual({
      aggregate_rankings: [
        { model: 'openai/b', average_rank: 1, rankings_count: 1 },
        { model: 'openai/a', average_rank: 2, rankings_count: 1 },
      ],
      positions_by_model: {
        'openai/b': [1],
        'openai/a': [2],
      },
      stage2_parsed_rankings: [
        {
          voter_model: 'judge',
          parsed_ranking: ['Response B', 'Response A'],
        },
      ],
    });
  });

  it('runs the browser MDT flow and stores the final assistant message', async () => {
    const repo = createMemoryRepo();
    await repo.createConversation('conversation-1');
    const client = createMockClient();
    const events = [];

    await runMdtConversationStream({
      conversationId: 'conversation-1',
      content: 'How does this work?',
      settings: {
        baseUrl: 'https://example.com/chat/completions',
        apiKey: 'secret',
        councilModels: ['openai/a', 'openai/b'],
        chairmanModel: 'openai/chair',
        titleModel: 'openai/title',
        extraHeaders: {},
      },
      onEvent: (_type, event) => events.push(event),
      conversationRepo: repo,
      client,
    });

    const conversation = await repo.getConversation('conversation-1');
    expect(conversation?.title).toBe('Browser title');
    expect(conversation?.messages).toHaveLength(2);
    expect(conversation?.messages[1]).toEqual(
      expect.objectContaining({
        role: 'assistant',
        stage1: [
          expect.objectContaining({
            model: 'openai/a',
            response: 'Stage 1 answer A',
          }),
        ],
        stage2: [
          expect.objectContaining({
            model: 'openai/a',
            parsed_ranking: ['Response A'],
          }),
          expect.objectContaining({
            model: 'openai/b',
            parsed_ranking: ['Response A'],
          }),
        ],
        stage3: expect.objectContaining({
          model: 'openai/chair',
          response: 'Synthesized final answer',
        }),
      })
    );

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'stage1_model_error', model: 'openai/b' }),
        expect.objectContaining({
          type: 'stage2_complete',
          metadata: expect.objectContaining({
            label_to_model: { 'Response A': 'openai/a' },
          }),
        }),
        expect.objectContaining({ type: 'title_complete' }),
        expect.objectContaining({ type: 'complete' }),
      ])
    );
  });
});
