/**
 * Convertisseur Markdown → HTML, taillé pour la documentation de ce projet.
 *
 * Il ne vise pas CommonMark dans son intégralité : il couvre exactement ce que
 * les fichiers `README.md`, `docs/guide.md` et `docs/firmware.md` emploient —
 * titres, paragraphes, listes (y compris imbriquées), tableaux, citations,
 * blocs de code, filets, et le formatage en ligne.
 *
 * Le HTML est **échappé par défaut** ; seules quelques balises sont rétablies
 * (`<kbd>`, `<br>`). C'est important : la documentation contient des gabarits
 * d'octets comme `<port>` ou `<puissance>`, qui doivent s'afficher tels quels.
 */

/** Balises autorisées à traverser l'échappement. */
const HTML_WHITELIST = [
  [/&lt;kbd&gt;/g, '<kbd>'],
  [/&lt;\/kbd&gt;/g, '</kbd>'],
  [/&lt;br\s*\/?&gt;/g, '<br />'],
];

/**
 * Marqueur de mise en réserve des segments de code. Pris dans la zone à usage
 * privé d'Unicode : aucun texte ne peut le contenir par accident.
 */
const SENTINEL = String.fromCharCode(0xe000);

const escapeHtml = (text) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Identifiant d'ancre, compatible avec celui de GitHub : minuscules, ponctuation
 * retirée, espaces convertis un à un (« Étape 4 · Titre » → `étape-4--titre`).
 */
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*?([^*]*)\*\*?/g, '$1')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-');
}

/* ------------------------------------------------------------------ */
/* Formatage en ligne                                                  */
/* ------------------------------------------------------------------ */

function renderInline(text) {
  let html = escapeHtml(text);

  // Les segments de code sont mis de côté : rien ne doit être interprété dedans.
  const codes = [];
  html = html.replace(/`([^`]+)`/g, (_, code) => {
    codes.push(code);
    return `${SENTINEL}${codes.length - 1}${SENTINEL}`;
  });

  html = html
    // [texte](cible)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, href) => link(href, label))
    // <https://exemple.fr>
    .replace(/&lt;((?:https?|mailto):[^\s&]+)&gt;/g, (_, href) => link(href, href))
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    // L'étoile ouvrante doit coller à son texte, la fermante aussi : sans quoi
    // « 3 * 4 * 5 » passerait pour de l'italique.
    .replace(/(^|[\s(])\*(\S|\S[^*\n]*?\S)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_(\S|\S[^_\n]*?\S)_/g, '$1<em>$2</em>');

  for (const [pattern, replacement] of HTML_WHITELIST) html = html.replace(pattern, replacement);

  const restore = new RegExp(`${SENTINEL}(\\d+)${SENTINEL}`, 'g');
  return html.replace(restore, (_, index) => `<code>${codes[Number(index)]}</code>`);
}

/**
 * Un lien vers un autre document est marqué : le lecteur l'ouvre dans son
 * panneau au lieu de quitter la page.
 */
function link(href, label) {
  const isDoc = /\.md(#.*)?$/i.test(href) && !/^https?:/i.test(href);
  if (isDoc) {
    const [file, anchor] = href.split('#');
    return `<a href="#" data-doc="${escapeHtml(file)}"${anchor ? ` data-anchor="${escapeHtml(anchor)}"` : ''}>${label}</a>`;
  }
  if (href.startsWith('#')) return `<a href="${escapeHtml(href)}" data-anchor="${escapeHtml(href.slice(1))}">${label}</a>`;
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
}

/* ------------------------------------------------------------------ */
/* Blocs                                                               */
/* ------------------------------------------------------------------ */

const RE_HEADING = /^(#{1,6})\s+(.*)$/;
const RE_RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const RE_FENCE = /^\s*```\s*(\S*)\s*$/;
const RE_LIST = /^(\s*)(?:([-*+])|(\d+)[.)])\s+(.*)$/;
const RE_TABLE_SEP = /^\s*\|?[\s:|-]+\|[\s:|-]*$/;

/**
 * @param {string} source
 * @returns {{html: string, headings: Array<{level:number, text:string, id:string}>}}
 */
export function renderMarkdown(source) {
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  const headings = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // Bloc de code délimité
    const fence = RE_FENCE.exec(line);
    if (fence) {
      const body = [];
      i += 1;
      while (i < lines.length && !RE_FENCE.test(lines[i])) body.push(lines[i++]);
      i += 1; // ferme la clôture
      const language = fence[1] ? ` class="language-${escapeHtml(fence[1])}"` : '';
      out.push(`<pre><code${language}>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    // Titre
    const heading = RE_HEADING.exec(line);
    if (heading) {
      const level = heading[1].length;
      const text = heading[2].replace(/\s+#+\s*$/, '');
      const id = slugify(text);
      headings.push({ level, text: text.replace(/[*`]/g, ''), id });
      out.push(`<h${level} id="${id}">${renderInline(text)}</h${level}>`);
      i += 1;
      continue;
    }

    // Filet — testé après les titres, sinon « --- » masquerait un soulignement
    if (RE_RULE.test(line)) {
      out.push('<hr />');
      i += 1;
      continue;
    }

    // Tableau : une ligne de cellules suivie d'une ligne de séparation
    if (line.includes('|') && RE_TABLE_SEP.test(lines[i + 1] ?? '')) {
      const [table, next] = renderTable(lines, i);
      out.push(table);
      i = next;
      continue;
    }

    // Citation
    if (/^\s*>/.test(line)) {
      const body = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) body.push(lines[i++].replace(/^\s*>\s?/, ''));
      const inner = renderMarkdown(body.join('\n'));
      out.push(`<blockquote>${inner.html}</blockquote>`);
      continue;
    }

    // Liste
    if (RE_LIST.test(line)) {
      const [list, next] = renderList(lines, i);
      out.push(list);
      i = next;
      continue;
    }

    // Paragraphe : tout jusqu'à la ligne vide ou le prochain bloc
    const paragraph = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !RE_HEADING.test(lines[i]) &&
      !RE_RULE.test(lines[i]) &&
      !RE_FENCE.test(lines[i]) &&
      !RE_LIST.test(lines[i]) &&
      !/^\s*>/.test(lines[i])
    ) {
      paragraph.push(lines[i++]);
    }
    out.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
  }

  return { html: out.join('\n'), headings };
}

function renderTable(lines, start) {
  const cells = (row) =>
    row
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());

  const header = cells(lines[start]);
  // La ligne de séparation porte l'alignement : « :--- », « ---: », « :---: ».
  const alignments = cells(lines[start + 1]).map((spec) => {
    const left = spec.startsWith(':');
    const right = spec.endsWith(':');
    return right && left ? 'center' : right ? 'right' : left ? 'left' : '';
  });

  let i = start + 2;
  const body = [];
  while (i < lines.length && lines[i].includes('|') && lines[i].trim()) body.push(cells(lines[i++]));

  const cell = (tag, value, index) => {
    const align = alignments[index] ? ` style="text-align:${alignments[index]}"` : '';
    return `<${tag}${align}>${renderInline(value ?? '')}</${tag}>`;
  };

  const parts = ['<div class="table-scroll"><table>'];
  // Un en-tête entièrement vide sert de mise en page : on ne l'affiche pas.
  if (header.some((value) => value !== '')) {
    parts.push(`<thead><tr>${header.map((value, index) => cell('th', value, index)).join('')}</tr></thead>`);
  }
  parts.push('<tbody>');
  for (const row of body) parts.push(`<tr>${row.map((value, index) => cell('td', value, index)).join('')}</tr>`);
  parts.push('</tbody></table></div>');
  return [parts.join(''), i];
}

/** Listes, avec un niveau d'imbrication géré par l'indentation. */
function renderList(lines, start) {
  const first = RE_LIST.exec(lines[start]);
  const baseIndent = first[1].length;
  const ordered = Boolean(first[3]);
  const items = [];
  let i = start;

  while (i < lines.length) {
    const match = RE_LIST.exec(lines[i]);
    if (match && match[1].length <= baseIndent) {
      if (Boolean(match[3]) !== ordered) break; // changement de type : nouvelle liste
      items.push({ content: [match[4]], nested: [] });
      i += 1;
      continue;
    }
    if (!items.length) break;

    // Ligne plus indentée : sous-liste ou suite du paragraphe de l'élément.
    if (match && match[1].length > baseIndent) {
      const [nested, next] = renderList(lines, i);
      items[items.length - 1].nested.push(nested);
      i = next;
      continue;
    }
    if (lines[i].trim() && lines[i].startsWith(' '.repeat(baseIndent + 1))) {
      items[items.length - 1].content.push(lines[i].trim());
      i += 1;
      continue;
    }
    if (!lines[i].trim() && RE_LIST.test(lines[i + 1] ?? '')) {
      i += 1; // ligne vide entre deux éléments : la liste continue
      continue;
    }
    break;
  }

  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && first[3] !== '1' ? ` start="${Number(first[3])}"` : '';
  const html = items
    .map((item) => `<li>${renderInline(item.content.join(' '))}${item.nested.join('')}</li>`)
    .join('');
  return [`<${tag}${startAttr}>${html}</${tag}>`, i];
}
