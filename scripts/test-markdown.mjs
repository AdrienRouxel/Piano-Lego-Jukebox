#!/usr/bin/env node
/**
 * Vérifie le convertisseur Markdown utilisé par le lecteur intégré au site.
 *
 * Deux volets : des cas de formatage écrits à la main, puis un passage sur la
 * documentation réelle du dépôt pour s'assurer qu'aucun balisage ne subsiste.
 *
 *   npm test
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown, slugify } from '../web/js/markdown.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let ok = 0;
let ko = 0;

const check = (label, actual, expected) => {
  if (actual === expected) {
    ok += 1;
    console.log(`  ✔ ${label}`);
  } else {
    ko += 1;
    console.log(`  ✘ ${label}\n      attendu ${expected}\n      obtenu  ${actual}`);
  }
};
const html = (source) => renderMarkdown(source).html;

console.log('\nFORMATAGE EN LIGNE');
check('gras', html('un mot **important**'), '<p>un mot <strong>important</strong></p>');
check('italique', html('un mot *nuancé*'), '<p>un mot <em>nuancé</em></p>');
check(
  'une multiplication n’est pas de l’italique',
  html('3 * 4 * 5'),
  '<p>3 * 4 * 5</p>'
);
check(
  'les underscores d’un identifiant sont préservés',
  html('nom_de_variable'),
  '<p>nom_de_variable</p>'
);
check('code en ligne', html('la valeur `0x51`'), '<p>la valeur <code>0x51</code></p>');
check(
  'rien n’est interprété dans un segment de code',
  html('`**pas gras**`'),
  '<p><code>**pas gras**</code></p>'
);
check(
  'les gabarits d’octets restent littéraux',
  html('`08 00 81 <port> 10`'),
  '<p><code>08 00 81 &lt;port&gt; 10</code></p>'
);
check(
  'le HTML est échappé',
  html('<script>alert(1)</script>'),
  '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>'
);
check('la balise kbd traverse l’échappement', html('touche <kbd>G</kbd>'), '<p>touche <kbd>G</kbd></p>');
check(
  'lien externe, ouvert dans un onglet',
  html('[LEGO](https://lego.com)'),
  '<p><a href="https://lego.com" target="_blank" rel="noopener noreferrer">LEGO</a></p>'
);
check(
  'lien vers un autre document, capté par le lecteur',
  html('[le guide](docs/guide.md#étape-1)'),
  '<p><a href="#" data-doc="docs/guide.md" data-anchor="étape-1">le guide</a></p>'
);

console.log('\nBLOCS');
check('titre avec ancre', html('## Le hub'), '<h2 id="le-hub">Le hub</h2>');
check('filet', html('---'), '<hr />');
check(
  'liste à puces',
  html('- un\n- deux'),
  '<ul><li>un</li><li>deux</li></ul>'
);
check(
  'liste numérotée',
  html('1. un\n2. deux'),
  '<ol><li>un</li><li>deux</li></ol>'
);
check(
  'liste imbriquée',
  html('1. étape\n   - détail'),
  '<ol><li>étape<ul><li>détail</li></ul></li></ol>'
);
check(
  'citation',
  html('> attention'),
  '<blockquote><p>attention</p></blockquote>'
);
check(
  'bloc de code avec langage',
  html('```bash\nnpm start\n```'),
  '<pre><code class="language-bash">npm start</code></pre>'
);
check(
  'tableau',
  html('| a | b |\n|---|---|\n| 1 | 2 |'),
  '<div class="table-scroll"><table><thead><tr><th>a</th><th>b</th></tr></thead><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>'
);
check(
  'tableau sans en-tête visible',
  html('| | |\n|---|---|\n| 1 | 2 |'),
  '<div class="table-scroll"><table><tbody><tr><td>1</td><td>2</td></tr></tbody></table></div>'
);
check(
  'alignement des colonnes',
  html('| a |\n|---:|\n| 1 |'),
  '<div class="table-scroll"><table><thead><tr><th style="text-align:right">a</th></tr></thead><tbody><tr><td style="text-align:right">1</td></tr></tbody></table></div>'
);

console.log('\nANCRES (compatibles GitHub)');
check('accents conservés', slugify('Régler le mouvement'), 'régler-le-mouvement');
check('ponctuation retirée, espaces gardés', slugify('Étape 4 · Connecter le piano'), 'étape-4--connecter-le-piano');
check('formatage ignoré', slugify('**Le hub**'), 'le-hub');

console.log('\nDOCUMENTATION DU DÉPÔT');
for (const file of ['README.md', 'docs/guide.md', 'docs/firmware.md', 'tracks/README.md']) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const { html: rendered, headings } = renderMarkdown(source);
  // Les blocs de code contiennent du texte littéral : on les exclut de la
  // recherche de résidus, sinon un commentaire « # … » passerait pour un titre.
  const prose = rendered.replace(/<pre>[\s\S]*?<\/pre>/g, '');

  const residues = [];
  if (/(^|\n)#{1,6} /.test(prose)) residues.push('titre');
  if (/\*\*/.test(prose)) residues.push('gras');
  if (prose.includes('](')) residues.push('lien');
  if (/(^|\n)\s*\|/.test(prose.replace(/<[^>]+>/g, ''))) residues.push('tableau');
  if (rendered.includes(String.fromCharCode(0xe000))) residues.push('marqueur interne');

  const ids = headings.map((h) => h.id);
  const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);

  check(`${file} — aucun balisage résiduel`, residues.join(', ') || 'aucun', 'aucun');
  check(`${file} — ancres uniques`, duplicates.join(', ') || 'aucune', 'aucune');
}

console.log(`\n${ok} vérifications passées, ${ko} en échec\n`);
process.exit(ko ? 1 : 0);
