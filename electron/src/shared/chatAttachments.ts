import type { ChatAttachment, ChatMessageAttachment } from './models'

export interface ChatTextPart {
  type: 'text'
  text: string
}

export interface ChatImageUrlPart {
  type: 'image_url'
  image_url: {
    url: string
  }
}

export type ChatContentPart = ChatTextPart | ChatImageUrlPart

type AttachmentLike = Pick<ChatAttachment, 'kind' | 'name' | 'mimeType' | 'dataUrl'>
  | Pick<ChatMessageAttachment, 'kind' | 'name' | 'mimeType' | 'dataUrl'>

const TEXT_ATTACHMENT_MIME_PREFIXES = [
  'text/',
]

const TEXT_ATTACHMENT_MIME_TYPES = new Set([
  'application/json',
  'application/ld+json',
  'application/javascript',
  'application/typescript',
  'application/x-typescript',
  'application/xml',
  'application/x-sh',
  'application/x-httpd-php',
  'image/svg+xml',
])

const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.mdx',
  '.json',
  '.jsonl',
  '.yml',
  '.yaml',
  '.toml',
  '.ini',
  '.env',
  '.csv',
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.rb',
  '.php',
  '.java',
  '.kt',
  '.swift',
  '.go',
  '.rs',
  '.sh',
  '.bash',
  '.zsh',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.html',
  '.xml',
  '.svg',
  '.sql',
])

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function truncateText(content: string, maxChars: number): string {
  if (content.length <= maxChars) return content
  return `${content.slice(0, Math.max(0, maxChars - 18))}\n...[truncated]`
}

function decodeBase64Utf8(value: string): string {
  if (typeof atob === 'function') {
    const binary = atob(value)
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  }
  return Buffer.from(value, 'base64').toString('utf8')
}

export function decodeDataUrl(dataUrl: string): {
  mimeType: string | null
  data: string
  isBase64: boolean
} | null {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;(base64))?,(.*)$/s)
  if (!match) return null
  return {
    mimeType: match[1] ?? null,
    isBase64: match[2] === 'base64',
    data: match[3] ?? '',
  }
}

export function isTextAttachment(attachment: AttachmentLike): boolean {
  if (attachment.kind !== 'file') return false
  if (TEXT_ATTACHMENT_MIME_PREFIXES.some((prefix) => attachment.mimeType.startsWith(prefix))) {
    return true
  }
  if (TEXT_ATTACHMENT_MIME_TYPES.has(attachment.mimeType)) return true
  return TEXT_ATTACHMENT_EXTENSIONS.has(extensionOf(attachment.name))
}

export function extractTextAttachmentContent(
  attachment: AttachmentLike,
  maxChars: number = 4_000,
): string | null {
  if (!isTextAttachment(attachment)) return null
  const decoded = decodeDataUrl(attachment.dataUrl)
  if (!decoded) return null

  try {
    const raw = decoded.isBase64
      ? decodeBase64Utf8(decoded.data)
      : decodeURIComponent(decoded.data)
    return truncateText(raw, maxChars)
  } catch {
    return null
  }
}

function buildAttachmentNarrative(
  attachments: AttachmentLike[],
  options: {
    includeImagePlaceholders: boolean
    maxTextFileChars?: number
  },
): string {
  const sections: string[] = []

  for (const attachment of attachments) {
    if (attachment.kind === 'image') {
      if (options.includeImagePlaceholders) {
        sections.push(`Image attachment: ${attachment.name} (${attachment.mimeType || 'image'})`)
      }
      continue
    }

    const textContent = extractTextAttachmentContent(attachment, options.maxTextFileChars ?? 4_000)
    if (textContent) {
      sections.push([
        `File attachment: ${attachment.name} (${attachment.mimeType || 'file'})`,
        'Attached file contents:',
        '```',
        textContent,
        '```',
      ].join('\n'))
      continue
    }

    sections.push(`Binary file attachment: ${attachment.name} (${attachment.mimeType || 'file'}). Contents omitted.`)
  }

  return sections.join('\n\n')
}

export function buildMessageContentWithAttachments(
  text: string,
  attachments: AttachmentLike[] | undefined,
  options: {
    allowImages: boolean
    maxTextFileChars?: number
  },
): string | ChatContentPart[] {
  const normalizedText = text || ''
  const normalizedAttachments = attachments ?? []
  if (normalizedAttachments.length === 0) return normalizedText

  const imageParts = options.allowImages
    ? normalizedAttachments
      .filter((attachment) => attachment.kind === 'image')
      .map((attachment) => ({
        type: 'image_url' as const,
        image_url: { url: attachment.dataUrl },
      }))
    : []

  const attachmentNarrative = buildAttachmentNarrative(normalizedAttachments, {
    includeImagePlaceholders: !options.allowImages,
    maxTextFileChars: options.maxTextFileChars,
  })

  const combinedText = [normalizedText, attachmentNarrative]
    .filter((value) => value.trim().length > 0)
    .join('\n\n')

  if (imageParts.length === 0) {
    return combinedText
  }

  return [
    ...imageParts,
    {
      type: 'text',
      text: combinedText || 'Analyze the attached image(s).',
    },
  ]
}
