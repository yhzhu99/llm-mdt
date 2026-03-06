import { describe, expect, it } from 'vitest';
import { __private__ } from './llmClient';

describe('llmClient helpers', () => {
  it('extracts payloads from SSE blocks', () => {
    const block = 'event: message\ndata: {"choices":[{"delta":{"content":"Hi"}}]}\n';
    expect(__private__.extractPayloadsFromBlock(block)).toEqual([
      '{"choices":[{"delta":{"content":"Hi"}}]}',
    ]);
  });

  it('normalizes structured content arrays', () => {
    const value = [
      { type: 'text', text: 'Hello' },
      { type: 'output_text', text: ' world' },
    ];
    expect(__private__.normalizeStructuredText(value)).toBe('Hello world');
  });

  it('builds response objects with reasoning fallback', () => {
    const response = __private__.buildResponseObject(
      {
        content: [{ type: 'text', text: 'Final answer' }],
      },
      'deliberation'
    );

    expect(response).toEqual({
      content: 'Final answer',
      reasoning_details: 'deliberation',
    });
  });
});
