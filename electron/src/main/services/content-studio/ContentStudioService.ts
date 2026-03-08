import { randomUUID } from 'crypto'

export interface ContentPack {
  id: string
  type: 'seo' | 'copy' | 'cta' | 'faq' | 'og-concept'
  title: string
  content: string // markdown
  routePath: string | null
  generatedAt: number
}

interface GeneratePackInputs {
  type: string
  pageTitle: string
  pageUrl: string
  domSummary: string
  projectName: string
}

function extractRoutePath(url: string): string | null {
  try {
    const parsed = new URL(url)
    return parsed.pathname || null
  } catch {
    return null
  }
}

function generateSEO(inputs: GeneratePackInputs): string {
  const { pageTitle, pageUrl, domSummary, projectName } = inputs
  const summary = domSummary.slice(0, 300).trim()
  const keywords = extractKeywords(domSummary)

  return `# SEO Pack: ${pageTitle}

**Project:** ${projectName}
**URL:** ${pageUrl}
**Generated:** ${new Date().toISOString()}

---

## Meta Title
\`\`\`
${pageTitle} | ${projectName}
\`\`\`

> Keep under 60 characters. Current: ${pageTitle.length} chars.

## Meta Description
\`\`\`
${summary.length > 155 ? summary.slice(0, 152) + '...' : summary}
\`\`\`

> Keep between 120-160 characters for best results.

## Keywords
${keywords.map((k) => `- ${k}`).join('\n')}

## Open Graph Tags
\`\`\`html
<meta property="og:title" content="${pageTitle}" />
<meta property="og:description" content="${summary.slice(0, 155)}" />
<meta property="og:url" content="${pageUrl}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="${projectName}" />
\`\`\`

## Twitter Card
\`\`\`html
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${pageTitle}" />
<meta name="twitter:description" content="${summary.slice(0, 155)}" />
\`\`\`

## Structured Data Suggestion
\`\`\`json
{
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "${pageTitle}",
  "description": "${summary.slice(0, 155).replace(/"/g, '\\"')}",
  "url": "${pageUrl}",
  "isPartOf": {
    "@type": "WebSite",
    "name": "${projectName}"
  }
}
\`\`\`

## Recommendations
- Ensure the page has a single \`<h1>\` tag matching the meta title theme
- Add alt text to all images with relevant keywords
- Internal links should use descriptive anchor text
- Consider adding FAQ schema if the page has Q&A content
`
}

function generateCopy(inputs: GeneratePackInputs): string {
  const { pageTitle, pageUrl, domSummary, projectName } = inputs
  const summary = domSummary.slice(0, 500).trim()

  return `# Copy Pack: ${pageTitle}

**Project:** ${projectName}
**URL:** ${pageUrl}
**Generated:** ${new Date().toISOString()}

---

## Hero Headline Options

### Option A (Benefit-driven)
> Transform the way you [main benefit from page context]

### Option B (Problem-solution)
> Stop struggling with [pain point]. Start [desired outcome].

### Option C (Direct)
> ${pageTitle}

## Subheadline
> A supporting line that expands on the headline and provides context about what the user can expect.

## CTA Text
- Primary: **Get Started Now**
- Secondary: **Learn More**
- Tertiary: **See How It Works**

## Body Copy Suggestions

### Opening Paragraph
Based on the page content, consider leading with the primary value proposition. The current page content focuses on:

${summary ? `> ${summary.slice(0, 200)}...` : '> [Page content not available for analysis]'}

### Key Points to Address
- What problem does this page solve?
- What is the unique value proposition?
- What social proof or credibility indicators can be added?
- What is the desired next action for the visitor?

### Tone Guidelines
- Keep sentences short and scannable
- Use active voice
- Address the reader directly ("you" / "your")
- Lead with benefits, not features

## Content Structure Recommendation
1. **Hero section** -- Headline + subheadline + primary CTA
2. **Problem statement** -- Identify the pain point
3. **Solution overview** -- How your product/service solves it
4. **Social proof** -- Testimonials, logos, stats
5. **Features/Benefits** -- 3-4 key points
6. **Final CTA** -- Repeat primary call to action
`
}

function generateCTA(inputs: GeneratePackInputs): string {
  const { pageTitle, pageUrl, projectName } = inputs

  return `# CTA Pack: ${pageTitle}

**Project:** ${projectName}
**URL:** ${pageUrl}
**Generated:** ${new Date().toISOString()}

---

## CTA Variations

### 1. Urgent
> **Don't miss out -- Get started today**
>
> Button: \`Start Now\`
>
> Supporting text: "Limited availability. Join thousands who already made the switch."

### 2. Friendly
> **Ready to give it a try?**
>
> Button: \`Let's Go\`
>
> Supporting text: "No commitment needed. See for yourself why people love it."

### 3. Professional
> **Elevate your workflow**
>
> Button: \`Request a Demo\`
>
> Supporting text: "See how ${projectName} can transform your process."

### 4. Value-focused
> **Get more done in less time**
>
> Button: \`Try Free for 14 Days\`
>
> Supporting text: "No credit card required. Full access to all features."

### 5. Social Proof
> **Join 10,000+ professionals**
>
> Button: \`Join the Community\`
>
> Supporting text: "Rated 4.9/5 by users who switched this quarter."

---

## Placement Recommendations
- **Above the fold:** Use variation #1 or #4
- **Mid-page (after features):** Use variation #3 or #5
- **Footer / exit intent:** Use variation #2
- **Pricing section:** Use variation #4

## Button Design Tips
- Use contrasting colors for primary CTA
- Keep button text to 2-4 words
- Add hover states and micro-interactions
- Consider adding a small icon (arrow, checkmark)
`
}

function generateFAQ(inputs: GeneratePackInputs): string {
  const { pageTitle, pageUrl, domSummary, projectName } = inputs
  const keywords = extractKeywords(domSummary)

  return `# FAQ Pack: ${pageTitle}

**Project:** ${projectName}
**URL:** ${pageUrl}
**Generated:** ${new Date().toISOString()}

---

## Suggested FAQ Entries

### Q1: What is ${projectName}?
**A:** ${projectName} is [brief description based on page context]. It helps users [primary benefit].

### Q2: How do I get started?
**A:** Getting started is simple. [Describe the onboarding process or first steps]. You can begin in just a few minutes.

### Q3: What are the main features?
**A:** Key features include:
${keywords.slice(0, 4).map((k) => `- ${k}`).join('\n')}

### Q4: Is there a free trial or free tier?
**A:** [Describe pricing model]. We offer [free trial / freemium / etc.] so you can evaluate before committing.

### Q5: How is my data handled?
**A:** We take data security seriously. [Describe security measures, compliance, data handling policies].

### Q6: Can I integrate with other tools?
**A:** Yes, ${projectName} integrates with [list common integrations]. Check our integrations page for the full list.

### Q7: What support options are available?
**A:** We offer [email support / live chat / documentation / community forum]. Our team typically responds within [timeframe].

### Q8: How do I cancel or change my plan?
**A:** You can manage your subscription at any time from your account settings. [Describe cancellation policy].

---

## FAQ Schema Markup
\`\`\`json
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What is ${projectName}?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "${projectName} is [brief description]."
      }
    }
  ]
}
\`\`\`

> Add all FAQ entries to the schema for rich search results.

## Recommendations
- Place FAQ section near the bottom of the page, before the final CTA
- Use accordion/collapsible UI for better scannability
- Link relevant FAQ answers to detailed documentation pages
- Update FAQ regularly based on actual customer questions
`
}

function generateOGConcept(inputs: GeneratePackInputs): string {
  const { pageTitle, pageUrl, domSummary, projectName } = inputs
  const summary = domSummary.slice(0, 200).trim()

  return `# OG Image Concept: ${pageTitle}

**Project:** ${projectName}
**URL:** ${pageUrl}
**Generated:** ${new Date().toISOString()}

---

## Recommended Dimensions
| Platform | Width | Height | Ratio |
|----------|-------|--------|-------|
| Open Graph (Facebook, LinkedIn) | 1200px | 630px | 1.91:1 |
| Twitter Summary Large Image | 1200px | 628px | 1.91:1 |
| Twitter Summary | 240px | 240px | 1:1 |

## Image Concept Description

### Option A: Clean & Branded
- **Background:** Solid dark gradient (brand colors)
- **Center:** Large bold text with page title
- **Bottom-left:** ${projectName} logo
- **Bottom-right:** URL or tagline
- **Style:** Minimalist, professional

### Option B: Content Preview
- **Background:** Blurred screenshot of the actual page
- **Overlay:** Semi-transparent dark overlay (60% opacity)
- **Center:** Page title in white bold text
- **Top-left:** ${projectName} logo
- **Style:** Modern, contextual

### Option C: Illustration-based
- **Background:** Brand gradient
- **Left half:** Abstract illustration related to page content
- **Right half:** Title + brief description text
- **Bottom:** ${projectName} branding
- **Style:** Creative, eye-catching

## Social Copy

### Facebook / LinkedIn
> **Title:** ${pageTitle}
> **Description:** ${summary || 'Discover what ' + projectName + ' has to offer.'}

### Twitter
> **Title:** ${pageTitle}
> **Description:** ${summary ? summary.slice(0, 120) : 'Check out ' + projectName + '.'}

## Technical Requirements
- File format: PNG or JPG
- Max file size: 8MB (Facebook), 5MB (Twitter)
- Text should occupy no more than 20% of image area (Facebook guideline)
- Ensure text is readable at small sizes (mobile feeds)
- Test with https://www.opengraph.xyz/ before deploying

## Alt Text Suggestion
\`\`\`
${pageTitle} - ${projectName}
\`\`\`
`
}

function extractKeywords(text: string): string[] {
  if (!text || text.trim().length === 0) return ['[no content available]']

  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'shall', 'can', 'this', 'that',
    'these', 'those', 'it', 'its', 'not', 'no', 'nor', 'as', 'if', 'then',
    'than', 'so', 'up', 'out', 'about', 'into', 'over', 'after', 'all',
    'also', 'just', 'more', 'most', 'other', 'some', 'such', 'only', 'own',
    'same', 'very', 'your', 'you', 'we', 'our', 'us', 'my', 'me', 'he',
    'she', 'they', 'them', 'his', 'her', 'who', 'which', 'what', 'when',
    'where', 'how', 'each', 'every', 'any', 'both', 'few', 'many', 'much',
  ])

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !stopWords.has(w))

  const freq = new Map<string, number>()
  for (const w of words) {
    freq.set(w, (freq.get(w) || 0) + 1)
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([word]) => word)
}

export class ContentStudioService {
  generatePack(inputs: GeneratePackInputs): ContentPack {
    const packType = inputs.type as ContentPack['type']

    let content: string
    let title: string

    switch (packType) {
      case 'seo':
        content = generateSEO(inputs)
        title = `SEO Pack: ${inputs.pageTitle}`
        break
      case 'copy':
        content = generateCopy(inputs)
        title = `Copy Pack: ${inputs.pageTitle}`
        break
      case 'cta':
        content = generateCTA(inputs)
        title = `CTA Pack: ${inputs.pageTitle}`
        break
      case 'faq':
        content = generateFAQ(inputs)
        title = `FAQ Pack: ${inputs.pageTitle}`
        break
      case 'og-concept':
        content = generateOGConcept(inputs)
        title = `OG Concept: ${inputs.pageTitle}`
        break
      default:
        throw new Error(`Unknown content pack type: ${inputs.type}`)
    }

    return {
      id: randomUUID(),
      type: packType,
      title,
      content,
      routePath: extractRoutePath(inputs.pageUrl),
      generatedAt: Date.now(),
    }
  }
}
