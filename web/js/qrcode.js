/**
 * Encodeur de code QR, écrit à la main.
 *
 * Le dépôt n'a aucune dépendance, et ce n'est pas pour en ajouter une ici :
 * un code QR est un objet parfaitement spécifié (ISO/IEC 18004), et le coder
 * soi-même tient en une page. C'est d'ailleurs une belle démonstration en
 * journée portes ouvertes — le carré noir et blanc que tout le monde scanne
 * sans y penser est un assemblage de motifs de repérage, d'un masquage choisi
 * pour éviter les grandes zones uniformes, et d'un code correcteur de
 * Reed-Solomon qui laisse arracher un coin de l'image sans perdre l'adresse.
 *
 * Portée volontairement réduite à ce dont le stand a besoin :
 *   • mode octet (le texte est encodé en UTF-8) ;
 *   • correction d'erreur de niveau M (~15 % de l'image peut être détruite) ;
 *   • versions 1 à 10, soit jusqu'à 213 caractères — une adresse comme
 *     « http://192.168.1.42:4173/r » tient dans la version 2.
 */

/* ------------------------------------------------------------------ */
/* Arithmétique de Galois GF(256)                                      */
/* ------------------------------------------------------------------ */

/**
 * Reed-Solomon travaille dans un corps fini à 256 éléments : les octets s'y
 * additionnent par ou-exclusif et se multiplient modulo le polynôme 0x11d.
 * Les deux tables ci-dessous ramènent la multiplication à une addition de
 * logarithmes, comme une règle à calcul.
 */
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = value;
    LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}

/** Polynôme générateur de degré `count`, produit des (x − α^i). */
function generatorPoly(count) {
  let poly = [1];
  for (let i = 0; i < count; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= poly[j] === 0 ? 0 : EXP[LOG[poly[j]] + i];
    }
    poly = next;
  }
  return poly;
}

/** Reste de la division du message par le polynôme générateur : les octets de correction. */
export function errorCorrection(data, count) {
  const generator = generatorPoly(count);
  const work = new Uint8Array(data.length + count);
  work.set(data);
  for (let i = 0; i < data.length; i += 1) {
    const lead = work[i];
    if (!lead) continue;
    const shift = LOG[lead];
    for (let j = 0; j < generator.length; j += 1) {
      if (generator[j]) work[i + j] ^= EXP[LOG[generator[j]] + shift];
    }
  }
  return work.subarray(data.length);
}

/* ------------------------------------------------------------------ */
/* Tables des versions (niveau de correction M)                        */
/* ------------------------------------------------------------------ */

/**
 * Pour chaque version 1 → 10 : octets de correction par bloc, puis la
 * répartition des blocs de données. Les versions élevées coupent le message
 * en blocs de deux tailles voisines — d'où les quatre nombres.
 */
export const VERSION_BLOCKS = {
  1: { ec: 10, groups: [[1, 16]] },
  2: { ec: 16, groups: [[1, 28]] },
  3: { ec: 26, groups: [[1, 44]] },
  4: { ec: 18, groups: [[2, 32]] },
  5: { ec: 24, groups: [[2, 43]] },
  6: { ec: 16, groups: [[4, 27]] },
  7: { ec: 18, groups: [[4, 31]] },
  8: { ec: 22, groups: [[2, 38], [2, 39]] },
  9: { ec: 22, groups: [[3, 36], [2, 37]] },
  10: { ec: 26, groups: [[4, 43], [1, 44]] },
};

/** Centres des motifs d'alignement, par version. La version 1 n'en a pas. */
const ALIGNMENT = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const MAX_VERSION = 10;

/** Nombre total d'octets de données utiles d'une version. */
function dataCapacity(version) {
  return VERSION_BLOCKS[version].groups.reduce((total, [count, size]) => total + count * size, 0);
}

/** Longueur, en bits, de l'indicateur de nombre de caractères en mode octet. */
const countBits = (version) => (version < 10 ? 8 : 16);

/** Plus petite version capable de porter `length` octets. */
function chooseVersion(length) {
  for (let version = 1; version <= MAX_VERSION; version += 1) {
    const available = dataCapacity(version) * 8 - 4 - countBits(version);
    if (length * 8 <= available) return version;
  }
  throw new Error(`Texte trop long pour un code QR de version ${MAX_VERSION} (${length} octets).`);
}

/* ------------------------------------------------------------------ */
/* Mise en forme du flux binaire                                       */
/* ------------------------------------------------------------------ */

/** Assemble les octets à inscrire : en-tête, données, remplissage, correction. */
function buildCodewords(bytes, version) {
  const capacity = dataCapacity(version);
  const bits = [];
  const push = (value, length) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };

  push(0b0100, 4); // mode octet
  push(bytes.length, countBits(version));
  for (const byte of bytes) push(byte, 8);

  // Terminateur, puis alignement sur l'octet.
  const room = capacity * 8 - bits.length;
  push(0, Math.min(4, room));
  while (bits.length % 8) bits.push(0);

  const data = new Uint8Array(capacity);
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte = (byte << 1) | bits[i + j];
    data[i / 8] = byte;
  }
  // Remplissage normalisé : deux octets qui alternent jusqu'au bout.
  for (let i = bits.length / 8, toggle = 0; i < capacity; i += 1, toggle ^= 1) {
    data[i] = toggle ? 0x11 : 0xec;
  }

  /* Découpage en blocs, chacun avec ses propres octets de correction. */
  const { ec, groups } = VERSION_BLOCKS[version];
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let i = 0; i < count; i += 1) {
      const block = data.subarray(offset, offset + size);
      offset += size;
      dataBlocks.push(block);
      ecBlocks.push(errorCorrection(block, ec));
    }
  }

  /* Entrelacement : un octet de chaque bloc à tour de rôle. Une rayure sur
     l'image abîme alors un peu de chaque bloc au lieu d'en détruire un seul. */
  const out = [];
  const longest = Math.max(...dataBlocks.map((block) => block.length));
  for (let i = 0; i < longest; i += 1) {
    for (const block of dataBlocks) if (i < block.length) out.push(block[i]);
  }
  for (let i = 0; i < ec; i += 1) {
    for (const block of ecBlocks) out.push(block[i]);
  }
  return Uint8Array.from(out);
}

/* ------------------------------------------------------------------ */
/* Motifs fixes                                                        */
/* ------------------------------------------------------------------ */

/**
 * Dessine tout ce qui ne dépend pas du message : les trois cibles de
 * repérage, les motifs d'alignement, les lignes de synchronisation, et les
 * emplacements réservés aux informations de format et de version.
 *
 * Exporté pour les tests, qui relisent le code produit dans l'autre sens.
 *
 * @returns {{size:number, modules:Uint8Array, reserved:Uint8Array}}
 */
export function functionPatterns(version) {
  const size = version * 4 + 17;
  const modules = new Uint8Array(size * size);
  const reserved = new Uint8Array(size * size);
  const set = (row, col, dark) => {
    if (row < 0 || col < 0 || row >= size || col >= size) return;
    modules[row * size + col] = dark ? 1 : 0;
    reserved[row * size + col] = 1;
  };

  // Cibles de repérage : le carré 7×7 des trois coins, et leur séparateur blanc.
  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let row = -1; row <= 7; row += 1) {
      for (let col = -1; col <= 7; col += 1) {
        // Distance de Tchebychev au centre : 0-1 le cœur sombre, 2 l'anneau
        // clair, 3 le cadre sombre, 4 le séparateur — clair lui aussi.
        const distance = Math.max(Math.abs(row - 3), Math.abs(col - 3));
        set(top + row, left + col, distance !== 2 && distance <= 3);
      }
    }
  }

  // Motifs d'alignement : de petits carrés 5×5 qui aident à corriger la
  // déformation quand la photo est prise de biais.
  const centres = ALIGNMENT[version];
  for (const row of centres) {
    for (const col of centres) {
      // Sauf aux trois coins, déjà occupés par les cibles de repérage.
      const corner =
        (row === 6 && col === 6) ||
        (row === 6 && col === size - 7) ||
        (row === size - 7 && col === 6);
      if (corner) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          set(row + dr, col + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  // Lignes de synchronisation : une alternance qui donne l'échelle au lecteur.
  for (let i = 8; i < size - 8; i += 1) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }

  // Le module toujours noir, et les zones réservées au format.
  set(size - 8, 8, true);
  for (let i = 0; i <= 8; i += 1) {
    if (i !== 6) {
      set(8, i, false);
      set(i, 8, false);
    }
  }
  for (let i = 0; i < 8; i += 1) {
    set(8, size - 1 - i, false);
    if (size - 1 - i !== size - 8) set(size - 1 - i, 8, false);
  }

  // À partir de la version 7, le numéro de version est inscrit deux fois.
  if (version >= 7) {
    let rest = version;
    for (let i = 0; i < 12; i += 1) {
      rest <<= 1;
      if (rest & 0x1000) rest ^= 0x1f25;
    }
    const bits = (version << 12) | rest;
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = (i % 3) + size - 11;
      set(b, a, dark);
      set(a, b, dark);
    }
  }

  return { size, modules, reserved };
}

/* ------------------------------------------------------------------ */
/* Masquage                                                            */
/* ------------------------------------------------------------------ */

/**
 * Les huit masques normalisés. On inverse un module sur deux selon une règle
 * géométrique : sans cela, une adresse pleine de caractères identiques
 * produirait de grands aplats que les lecteurs confondent avec les motifs
 * de repérage.
 */
const MASKS = [
  (row, col) => (row + col) % 2 === 0,
  (row) => row % 2 === 0,
  (row, col) => col % 3 === 0,
  (row, col) => (row + col) % 3 === 0,
  (row, col) => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
  (row, col) => ((row * col) % 2) + ((row * col) % 3) === 0,
  (row, col) => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
  (row, col) => (((row + col) % 2) + ((row * col) % 3)) % 2 === 0,
];

/** Informations de format : niveau de correction et masque, protégés par un code BCH. */
function formatBits(mask) {
  const data = (0b00 << 3) | mask; // 00 = niveau M
  let rest = data;
  for (let i = 0; i < 10; i += 1) {
    rest <<= 1;
    if (rest & 0x400) rest ^= 0x537;
  }
  return ((data << 10) | rest) ^ 0x5412;
}

function drawFormat(modules, size, mask) {
  const bits = formatBits(mask);
  const bit = (i) => (bits >> i) & 1;
  const set = (row, col, value) => { modules[row * size + col] = value; };

  for (let i = 0; i <= 5; i += 1) set(i, 8, bit(i));
  set(7, 8, bit(6));
  set(8, 8, bit(7));
  set(8, 7, bit(8));
  for (let i = 9; i < 15; i += 1) set(8, 14 - i, bit(i));

  for (let i = 0; i < 8; i += 1) set(8, size - 1 - i, bit(i));
  for (let i = 8; i < 15; i += 1) set(size - 15 + i, 8, bit(i));
  set(size - 8, 8, 1);
}

/**
 * Pénalités normalisées : on essaie les huit masques et on garde celui qui
 * donne l'image la moins piégeuse — longues séries d'une même couleur, blocs
 * uniformes, motifs qui imitent une cible de repérage, déséquilibre global.
 */
function penalty(modules, size) {
  const at = (row, col) => modules[row * size + col];
  let score = 0;

  for (let a = 0; a < size; a += 1) {
    for (const horizontal of [true, false]) {
      let run = 1;
      let history = 0;
      for (let b = 1; b < size; b += 1) {
        const previous = horizontal ? at(a, b - 1) : at(b - 1, a);
        const current = horizontal ? at(a, b) : at(b, a);
        if (current === previous) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else {
          run = 1;
        }
        history = ((history << 1) | current) & 0x7ff;
        // 1011101 encadré de quatre modules clairs : la signature d'une cible.
        if (b >= 10 && (history === 0b10111010000 || history === 0b00001011101)) score += 40;
      }
    }
  }

  for (let row = 0; row + 1 < size; row += 1) {
    for (let col = 0; col + 1 < size; col += 1) {
      const value = at(row, col);
      if (value === at(row, col + 1) && value === at(row + 1, col) && value === at(row + 1, col + 1)) score += 3;
    }
  }

  let dark = 0;
  for (const value of modules) dark += value;
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;
  return score;
}

/* ------------------------------------------------------------------ */
/* Assemblage                                                          */
/* ------------------------------------------------------------------ */

/**
 * Ordre de parcours des modules libres : deux colonnes à la fois, en
 * serpentin depuis le coin inférieur droit. Exporté pour les tests.
 *
 * @returns {number[]} indices dans la matrice, dans l'ordre d'écriture
 */
export function dataPath(size, reserved) {
  const path = [];
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // la colonne 6 porte la synchronisation
    for (let step = 0; step < size; step += 1) {
      for (let offset = 0; offset < 2; offset += 1) {
        const col = right - offset;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - step : step;
        const index = row * size + col;
        if (!reserved[index]) path.push(index);
      }
    }
  }
  return path;
}

/**
 * Encode un texte en code QR.
 *
 * @param {string} text
 * @returns {{version:number, size:number, modules:Uint8Array, mask:number}}
 *   `modules` contient `size * size` valeurs, 1 pour un module sombre.
 */
export function encodeQr(text) {
  const bytes = new TextEncoder().encode(String(text));
  const version = chooseVersion(bytes.length);
  const codewords = buildCodewords(bytes, version);

  const { size, modules: base, reserved } = functionPatterns(version);
  const path = dataPath(size, reserved);

  const filled = Uint8Array.from(base);
  for (let i = 0; i < path.length; i += 1) {
    // Les derniers modules d'une version peuvent ne porter aucune donnée :
    // la norme demande alors des modules clairs, c'est déjà le cas.
    const byte = codewords[i >> 3];
    filled[path[i]] = byte === undefined ? 0 : (byte >> (7 - (i & 7))) & 1;
  }

  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const candidate = Uint8Array.from(filled);
    for (let row = 0; row < size; row += 1) {
      for (let col = 0; col < size; col += 1) {
        const index = row * size + col;
        if (!reserved[index] && MASKS[mask](row, col)) candidate[index] ^= 1;
      }
    }
    drawFormat(candidate, size, mask);
    const score = penalty(candidate, size);
    if (!best || score < best.score) best = { score, mask, modules: candidate };
  }

  return { version, size, modules: best.modules, mask: best.mask };
}

/**
 * Rend le code sous forme de SVG, prêt à être inséré dans la page.
 *
 * @param {string} text
 * @param {{margin?:number, label?:string}} [options] `margin` en modules —
 *   la norme en demande quatre, c'est la marge qui rend le code lisible.
 */
export function qrSvg(text, { margin = 4, label = '' } = {}) {
  const { size, modules } = encodeQr(text);
  const span = size + margin * 2;

  // Un seul chemin pour tous les modules sombres : le SVG reste léger même
  // sur une version élevée, et le rendu ne montre aucun liseré entre carrés.
  const parts = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (modules[row * size + col]) parts.push(`M${col + margin} ${row + margin}h1v1h-1z`);
    }
  }

  const title = label ? `<title>${label.replace(/[<>&]/g, '')}</title>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}" ` +
    `shape-rendering="crispEdges" role="img" aria-label="${label ? label.replace(/["<>&]/g, '') : 'Code QR'}">` +
    `${title}<rect width="${span}" height="${span}" fill="#fff"/>` +
    `<path d="${parts.join('')}" fill="#000"/></svg>`
  );
}
