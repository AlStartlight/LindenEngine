/**
 * Sanitize an HTML UI fragment before it is inserted into the game page.
 * HtmlUI fragments are markup + CSS only; behaviour comes from scripts via ctx.ui.
 * Parsing happens in an inert document (DOMParser), so nothing runs while we clean it.
 */

const BLOCKED_TAGS = new Set([
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'meta',
  'link',
  'noscript',
  'template',
  'portal',
])

const URL_ATTRS = new Set(['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'background', 'srcset', 'ping'])
const UNSAFE_URL = /^\s*(javascript|vbscript|data\s*:\s*text\/html)/i

export interface SanitizeReport {
  removedTags: string[]
  removedAttributes: string[]
}

export function sanitizeElementTree(root: ParentNode, report: SanitizeReport = { removedTags: [], removedAttributes: [] }): SanitizeReport {
  const elements = Array.from(root.querySelectorAll('*'))
  for (const el of elements) {
    const tag = el.tagName.toLowerCase()
    if (BLOCKED_TAGS.has(tag)) {
      report.removedTags.push(tag)
      el.remove()
      continue
    }
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase()
      const unsafe =
        name.startsWith('on') ||
        name === 'srcdoc' ||
        name === 'formaction' ||
        name === 'action' ||
        (URL_ATTRS.has(name) && UNSAFE_URL.test(attr.value.replace(/[\u0000-\u001f]/g, '')))
      if (unsafe) {
        report.removedAttributes.push(`${tag}[${name}]`)
        el.removeAttribute(attr.name)
      }
    }
  }
  return report
}

/** Parse and clean a fragment. Returns nodes adopted into `doc`, ready to append. */
export function sanitizeHtmlFragment(html: string, doc: Document = document): { fragment: DocumentFragment; report: SanitizeReport } {
  const parsed = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html')
  // <style> in <head> (if the author wrote a full page) is kept; everything else comes from <body>
  const report = sanitizeElementTree(parsed)
  const fragment = doc.createDocumentFragment()
  for (const style of Array.from(parsed.head.querySelectorAll('style'))) {
    fragment.appendChild(doc.importNode(style, true))
  }
  for (const node of Array.from(parsed.body.childNodes)) {
    fragment.appendChild(doc.importNode(node, true))
  }
  return { fragment, report }
}
