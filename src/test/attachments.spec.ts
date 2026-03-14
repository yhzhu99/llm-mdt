import { describe, expect, it } from 'vitest'
import {
  buildChatCompletionContentParts,
  getAttachmentValidationMessage,
  hasUserInputContent,
  normalizeUserInputPayload,
  summarizeUserInputForTitle,
} from '@/utils/attachments'
import type { UserAttachment } from '@/types'

const imageAttachment: UserAttachment = {
  id: 'image-1',
  kind: 'image',
  name: 'scan.png',
  mimeType: 'image/png',
  size: 128,
  dataUrl: 'data:image/png;base64,AAAA',
  textContent: null,
}

const pdfAttachment: UserAttachment = {
  id: 'file-1',
  kind: 'file',
  name: 'report.pdf',
  mimeType: 'application/pdf',
  size: 256,
  dataUrl: 'data:application/pdf;base64,BBBB',
  textContent: null,
}

describe('attachment utilities', () => {
  it('normalizes legacy string input into structured payload', () => {
    expect(normalizeUserInputPayload('Inspect this case')).toEqual({
      text: 'Inspect this case',
      attachments: [],
    })
  })

  it('treats attachment-only input as valid user content', () => {
    expect(
      hasUserInputContent({
        text: '',
        attachments: [imageAttachment],
      }),
    ).toBe(true)
  })

  it('preserves text-first multimodal content order', () => {
    expect(buildChatCompletionContentParts('Inspect this case', [imageAttachment, pdfAttachment])).toEqual([
      { type: 'text', text: 'Inspect this case' },
      {
        type: 'image',
        imageUrl: 'data:image/png;base64,AAAA',
        mimeType: 'image/png',
        name: 'scan.png',
      },
      {
        type: 'file',
        fileName: 'report.pdf',
        dataUrl: 'data:application/pdf;base64,BBBB',
        mimeType: 'application/pdf',
        textContent: null,
      },
    ])
  })

  it('returns a DeepSeek attachment validation message only for attachment-bearing inputs', () => {
    expect(
      getAttachmentValidationMessage(
        {
          text: 'Inspect this case',
          attachments: [pdfAttachment],
        },
        ['deepseek/deepseek-reasoner', 'openai/gpt-5.4'],
        'zh-CN',
      ),
    ).toContain('DeepSeek')

    expect(
      getAttachmentValidationMessage(
        {
          text: 'Inspect this case',
          attachments: [],
        },
        ['deepseek/deepseek-reasoner'],
        'en',
      ),
    ).toBe('')
  })

  it('includes attachment names when building the title summary', () => {
    expect(
      summarizeUserInputForTitle(
        {
          text: 'Review the uploaded findings',
          attachments: [imageAttachment, pdfAttachment],
        },
        'en',
      ),
    ).toContain('Attachments: scan.png, report.pdf')
  })
})
