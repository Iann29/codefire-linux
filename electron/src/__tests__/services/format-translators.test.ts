import { describe, expect, it } from 'vitest'

import { openaiToAnthropic, openaiToGemini } from '../../main/services/providers/format-translators'

describe('format translators', () => {
  it('converts OpenAI-style image parts into Anthropic image blocks', () => {
    const request = openaiToAnthropic({
      model: 'claude-opus-4-6',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/png;base64,aGVsbG8=',
              },
            },
            {
              type: 'text',
              text: 'Inspect this screenshot',
            },
          ],
        },
      ],
    })

    expect(Array.isArray(request.messages[0].content)).toBe(true)
    expect(request.messages[0].content).toEqual([
      {
        type: 'image',
        source: {
          type: 'base64',
          media_type: 'image/png',
          data: 'aGVsbG8=',
        },
      },
      {
        type: 'text',
        text: 'Inspect this screenshot',
      },
    ])
  })

  it('converts OpenAI-style image parts into Gemini inline data parts', () => {
    const request = openaiToGemini({
      model: 'gemini-2.5-pro',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: 'data:image/jpeg;base64,aGVsbG8=',
              },
            },
            {
              type: 'text',
              text: 'Compare the layout',
            },
          ],
        },
      ],
    })

    expect(request.contents[0]).toEqual({
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: 'aGVsbG8=',
          },
        },
        {
          text: 'Compare the layout',
        },
      ],
    })
  })
})
