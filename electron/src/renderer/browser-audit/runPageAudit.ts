import type { AuditFinding, AuditReport } from './types'

interface CollectedDOM {
  url: string
  title: string
  lang: string
  metaTags: Array<{ name: string; property: string; content: string }>
  headings: Array<{ tag: string; text: string }>
  images: Array<{ src: string; alt: string | null }>
  buttons: Array<{ text: string; ariaLabel: string | null }>
  links: Array<{ text: string; href: string }>
  inputs: Array<{ type: string; hasLabel: boolean; ariaLabel: string | null; placeholder: string | null }>
  favicon: string | null
  canonical: string | null
  ogTags: Record<string, string>
}

const COLLECT_DOM_SCRIPT = `
(() => {
  const metaEls = Array.from(document.querySelectorAll('meta'))
  const metaTags = metaEls.map(m => ({
    name: m.getAttribute('name') || '',
    property: m.getAttribute('property') || '',
    content: m.getAttribute('content') || '',
  }))

  const headingEls = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5, h6'))
  const headings = headingEls.map(h => ({
    tag: h.tagName.toLowerCase(),
    text: (h.textContent || '').trim().slice(0, 120),
  }))

  const imageEls = Array.from(document.querySelectorAll('img'))
  const images = imageEls.map(img => ({
    src: img.getAttribute('src') || '',
    alt: img.hasAttribute('alt') ? img.getAttribute('alt') : null,
  }))

  const buttonEls = Array.from(document.querySelectorAll('button, [role="button"]'))
  const buttons = buttonEls.map(btn => ({
    text: (btn.textContent || '').trim().slice(0, 80),
    ariaLabel: btn.getAttribute('aria-label'),
  }))

  const linkEls = Array.from(document.querySelectorAll('a[href]')).slice(0, 200)
  const links = linkEls.map(a => ({
    text: (a.textContent || '').trim().slice(0, 80),
    href: a.getAttribute('href') || '',
  }))

  const inputEls = Array.from(document.querySelectorAll('input:not([type="hidden"]), textarea, select'))
  const inputs = inputEls.map(inp => {
    const id = inp.getAttribute('id')
    const hasLabel = id ? !!document.querySelector('label[for="' + id + '"]') : false
    const parentLabel = !!inp.closest('label')
    return {
      type: inp.getAttribute('type') || inp.tagName.toLowerCase(),
      hasLabel: hasLabel || parentLabel,
      ariaLabel: inp.getAttribute('aria-label'),
      placeholder: inp.getAttribute('placeholder'),
    }
  })

  const faviconEl = document.querySelector('link[rel="icon"], link[rel="shortcut icon"]')
  const canonicalEl = document.querySelector('link[rel="canonical"]')

  const ogTags = {}
  metaEls.forEach(m => {
    const prop = m.getAttribute('property') || ''
    if (prop.startsWith('og:')) {
      ogTags[prop] = m.getAttribute('content') || ''
    }
  })

  return {
    url: location.href,
    title: document.title || '',
    lang: document.documentElement.getAttribute('lang') || '',
    metaTags,
    headings,
    images,
    buttons,
    links,
    inputs,
    favicon: faviconEl ? faviconEl.getAttribute('href') : null,
    canonical: canonicalEl ? canonicalEl.getAttribute('href') : null,
    ogTags,
  }
})()
`

let findingCounter = 0

function finding(
  partial: Omit<AuditFinding, 'id'>
): AuditFinding {
  findingCounter++
  return { id: `audit-${findingCounter}`, ...partial }
}

function analyzeSEO(dom: CollectedDOM): AuditFinding[] {
  const findings: AuditFinding[] = []

  // Title
  if (!dom.title) {
    findings.push(finding({
      severity: 'blocker',
      category: 'seo',
      title: 'Missing page title',
      description: 'The page has no <title> tag. Search engines use the title as the main link text in results.',
      remediation: 'Add a descriptive <title> tag inside <head>.',
    }))
  } else if (dom.title.length < 10) {
    findings.push(finding({
      severity: 'warning',
      category: 'seo',
      title: 'Title too short',
      description: `Title is only ${dom.title.length} characters. Recommended: 10-60 characters.`,
      evidence: dom.title,
      remediation: 'Write a more descriptive title with at least 10 characters.',
    }))
  } else if (dom.title.length > 60) {
    findings.push(finding({
      severity: 'warning',
      category: 'seo',
      title: 'Title too long',
      description: `Title is ${dom.title.length} characters. Search engines typically truncate after 60.`,
      evidence: dom.title.slice(0, 80) + '...',
      remediation: 'Shorten the title to 60 characters or less.',
    }))
  }

  // Meta description
  const metaDesc = dom.metaTags.find(
    m => m.name.toLowerCase() === 'description'
  )
  if (!metaDesc || !metaDesc.content) {
    findings.push(finding({
      severity: 'warning',
      category: 'seo',
      title: 'Missing meta description',
      description: 'No <meta name="description"> found. Search engines use this as snippet text.',
      remediation: 'Add <meta name="description" content="..."> with a 120-160 character summary.',
    }))
  }

  // Canonical
  if (!dom.canonical) {
    findings.push(finding({
      severity: 'info',
      category: 'seo',
      title: 'Missing canonical URL',
      description: 'No <link rel="canonical"> found. This helps prevent duplicate content issues.',
      remediation: 'Add <link rel="canonical" href="..."> pointing to the preferred URL.',
    }))
  }

  // Lang attribute
  if (!dom.lang) {
    findings.push(finding({
      severity: 'warning',
      category: 'seo',
      title: 'Missing lang attribute',
      description: 'The <html> element has no lang attribute. This helps screen readers and search engines.',
      remediation: 'Add lang="en" (or appropriate language code) to the <html> tag.',
    }))
  }

  // OG tags
  if (!dom.ogTags['og:title']) {
    findings.push(finding({
      severity: 'info',
      category: 'seo',
      title: 'Missing og:title',
      description: 'No Open Graph title found. Social media shares will lack a proper title.',
      remediation: 'Add <meta property="og:title" content="...">.',
    }))
  }
  if (!dom.ogTags['og:description']) {
    findings.push(finding({
      severity: 'info',
      category: 'seo',
      title: 'Missing og:description',
      description: 'No Open Graph description found. Social media shares will lack a description.',
      remediation: 'Add <meta property="og:description" content="...">.',
    }))
  }
  if (!dom.ogTags['og:image']) {
    findings.push(finding({
      severity: 'info',
      category: 'seo',
      title: 'Missing og:image',
      description: 'No Open Graph image found. Social media shares will have no preview image.',
      remediation: 'Add <meta property="og:image" content="..."> with a 1200x630px image URL.',
    }))
  }

  // Favicon
  if (!dom.favicon) {
    findings.push(finding({
      severity: 'warning',
      category: 'seo',
      title: 'Missing favicon',
      description: 'No favicon link found. Browsers display a generic icon in tabs and bookmarks.',
      remediation: 'Add <link rel="icon" href="/favicon.ico"> or a PNG/SVG favicon.',
    }))
  }

  return findings
}

function analyzeAccessibility(dom: CollectedDOM): AuditFinding[] {
  const findings: AuditFinding[] = []

  // Images without alt
  const imagesNoAlt = dom.images.filter(img => img.alt === null)
  if (imagesNoAlt.length > 0) {
    if (imagesNoAlt.length > 3) {
      findings.push(finding({
        severity: 'warning',
        category: 'accessibility',
        title: `${imagesNoAlt.length} images missing alt attribute`,
        description: 'Multiple images lack alt text. Screen readers cannot describe these images to users.',
        evidence: imagesNoAlt.slice(0, 5).map(i => i.src).join(', '),
        remediation: 'Add descriptive alt attributes to all <img> tags. Use alt="" for decorative images.',
      }))
    } else {
      for (const img of imagesNoAlt) {
        findings.push(finding({
          severity: 'warning',
          category: 'accessibility',
          title: 'Image missing alt attribute',
          description: 'An image has no alt text. Screen readers cannot describe it.',
          evidence: img.src.slice(0, 120),
          selector: `img[src="${img.src.slice(0, 60)}"]`,
          remediation: 'Add a descriptive alt attribute or alt="" if purely decorative.',
        }))
      }
    }
  }

  // Buttons without text
  const emptyButtons = dom.buttons.filter(
    btn => !btn.text && !btn.ariaLabel
  )
  if (emptyButtons.length > 0) {
    findings.push(finding({
      severity: 'warning',
      category: 'accessibility',
      title: `${emptyButtons.length} button${emptyButtons.length > 1 ? 's' : ''} without accessible text`,
      description: 'Buttons have no visible text or aria-label. Screen readers announce them as unlabeled.',
      remediation: 'Add text content or aria-label to each button.',
    }))
  }

  // Inputs without labels
  const unlabeledInputs = dom.inputs.filter(
    inp => !inp.hasLabel && !inp.ariaLabel
  )
  if (unlabeledInputs.length > 0) {
    findings.push(finding({
      severity: 'warning',
      category: 'accessibility',
      title: `${unlabeledInputs.length} input${unlabeledInputs.length > 1 ? 's' : ''} without label`,
      description: 'Form inputs lack associated <label> or aria-label. Users cannot identify what to enter.',
      evidence: unlabeledInputs.slice(0, 5).map(i => `<${i.type}>`).join(', '),
      remediation: 'Add a <label for="..."> or aria-label attribute to each input.',
    }))
  }

  return findings
}

function analyzeContent(dom: CollectedDOM): AuditFinding[] {
  const findings: AuditFinding[] = []

  const h1s = dom.headings.filter(h => h.tag === 'h1')

  if (h1s.length === 0) {
    findings.push(finding({
      severity: 'warning',
      category: 'content',
      title: 'No H1 heading found',
      description: 'The page has no <h1> element. Every page should have exactly one main heading.',
      remediation: 'Add a single <h1> that describes the page content.',
    }))
  } else if (h1s.length > 1) {
    findings.push(finding({
      severity: 'warning',
      category: 'content',
      title: `Multiple H1 headings (${h1s.length})`,
      description: 'The page has more than one <h1>. Best practice is a single H1 per page.',
      evidence: h1s.map(h => h.text).join(' | '),
      remediation: 'Keep only one <h1> and demote others to <h2> or lower.',
    }))
  }

  // Heading hierarchy skip
  const levelMap: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 }
  for (let i = 1; i < dom.headings.length; i++) {
    const prevLevel = levelMap[dom.headings[i - 1].tag] ?? 0
    const currLevel = levelMap[dom.headings[i].tag] ?? 0
    if (currLevel > prevLevel + 1) {
      findings.push(finding({
        severity: 'info',
        category: 'content',
        title: `Heading hierarchy skip: ${dom.headings[i - 1].tag.toUpperCase()} -> ${dom.headings[i].tag.toUpperCase()}`,
        description: `Heading levels should not skip. Found ${dom.headings[i - 1].tag} followed by ${dom.headings[i].tag}.`,
        evidence: `"${dom.headings[i - 1].text}" -> "${dom.headings[i].text}"`,
        remediation: 'Use sequential heading levels (h1 -> h2 -> h3) without skipping.',
      }))
      break // Only report the first skip to avoid noise
    }
  }

  return findings
}

function analyzeRuntime(
  consoleEntries: Array<{ level: string; message: string }>
): AuditFinding[] {
  const findings: AuditFinding[] = []

  const errors = consoleEntries.filter(e => e.level === 'error')
  const warnings = consoleEntries.filter(e => e.level === 'warning')

  if (errors.length > 0) {
    findings.push(finding({
      severity: 'warning',
      category: 'runtime',
      title: `${errors.length} console error${errors.length > 1 ? 's' : ''}`,
      description: 'JavaScript errors were detected in the console. These may indicate broken functionality.',
      evidence: errors.slice(0, 3).map(e => e.message.slice(0, 100)).join('\n'),
      remediation: 'Open DevTools and fix the reported JavaScript errors.',
    }))
  }

  if (warnings.length > 0) {
    findings.push(finding({
      severity: 'info',
      category: 'runtime',
      title: `${warnings.length} console warning${warnings.length > 1 ? 's' : ''}`,
      description: 'Warnings were detected in the console. These may indicate potential issues.',
      evidence: warnings.slice(0, 3).map(e => e.message.slice(0, 100)).join('\n'),
      remediation: 'Review console warnings and address any that indicate real problems.',
    }))
  }

  return findings
}

export async function runPageAudit(
  webview: any,
  consoleEntries: Array<{ level: string; message: string }>
): Promise<AuditReport> {
  // Reset counter for each audit run
  findingCounter = 0

  // Collect DOM data from the webview
  const dom: CollectedDOM = await webview.executeJavaScript(COLLECT_DOM_SCRIPT)

  // Run all analysis rules
  const findings: AuditFinding[] = [
    ...analyzeSEO(dom),
    ...analyzeAccessibility(dom),
    ...analyzeContent(dom),
    ...analyzeRuntime(consoleEntries),
  ]

  // Calculate summary
  const blockers = findings.filter(f => f.severity === 'blocker').length
  const warnings = findings.filter(f => f.severity === 'warning').length
  const infos = findings.filter(f => f.severity === 'info').length
  const score = Math.max(0, 100 - (blockers * 20 + warnings * 5 + infos * 1))

  return {
    url: dom.url,
    pageTitle: dom.title,
    generatedAt: Date.now(),
    findings,
    summary: { blockers, warnings, infos, score },
  }
}
