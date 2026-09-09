/**
 * Gravure d'une partition de piano, à partir d'un MIDI déjà analysé.
 *
 * Le jukebox sait faire sonner un morceau et bouger les touches ; il lui
 * manquait de le donner à lire. Ce module transforme la liste plate de notes
 * rendue par `midi.js` en une vraie page de musique : deux portées reliées par
 * une accolade, une armure, des barres de mesure, des hauteurs placées sur
 * leur ligne — puis découpe le tout en systèmes et en pages.
 *
 * Ce n'est pas un graveur complet, et cela ne cherche pas à l'être : pas de
 * ligatures, pas de voix séparées, pas de silences écrits. L'espacement est
 * proportionnel au temps à l'intérieur de chaque mesure, ce qui a un avantage
 * décisif ici : la position d'une note sur la page se déduit de l'instant où
 * elle sonne, et réciproquement. C'est ce qui permet au curseur de lecture de
 * glisser exactement sur les notes qu'on entend.
 *
 *   MIDI ──parseMidi──► notes ──layoutScore──► pages ──renderPage──► <svg>
 *                                                 ▲
 *                                    ScoreView ───┘ curseur + tourne-page
 *
 * Tout est dessiné en SVG, sans police de musique : les clés sont des tracés,
 * et les altérations empruntent les caractères ♯ ♭ ♮, présents partout.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Interligne de la portée, unité de base de toute la gravure. */
export const SPACE = 10;
/** Hauteur d'une portée de cinq lignes. */
const STAFF = SPACE * 4;
/** Blanc entre la portée de sol et celle de fa, dans un même système. */
const STAFF_GAP = SPACE * 7;
/** Blanc réservé au-dessus et en dessous, pour les lignes supplémentaires. */
const SYSTEM_PAD_TOP = SPACE * 4.5;
const SYSTEM_PAD_BOTTOM = SPACE * 4.5;
/** Hauteur totale d'un système (les deux portées et leurs marges). */
const SYSTEM_HEIGHT = SYSTEM_PAD_TOP + STAFF * 2 + STAFF_GAP + SYSTEM_PAD_BOTTOM;
/** Blanc entre deux systèmes d'une même page. */
const SYSTEM_SPACING = SPACE * 3;

/** Marges de la page. */
const MARGIN_X = SPACE * 2.4;
const MARGIN_TOP = SPACE * 1.6;
const MARGIN_BOTTOM = SPACE * 1.6;

/** Place tenue en tête de système par l'accolade, les clés et l'armure. */
const BRACE_WIDTH = SPACE * 1.8;
const CLEF_WIDTH = SPACE * 3.6;
const KEY_STEP = SPACE * 1.15;

/** Do central : la frontière entre les deux mains, donc entre les deux portées. */
const SPLIT_PITCH = 60;

/** Largeurs minimales, en unités de portée : la respiration de la gravure. */
const MIN_ONSET_GAP = SPACE * 3;
const MIN_MEASURE_WIDTH = SPACE * 13;

/**
 * Au-delà, une note n'est plus dessinée : les partitions de démonstration
 * contiennent parfois des dizaines de milliers de notes, et un téléphone n'a
 * pas à en faire des tracés SVG.
 */
const MAX_NOTES = 12_000;

/* ------------------------------------------------------------------ */
/* Hauteurs : du numéro MIDI au nom de note                            */
/* ------------------------------------------------------------------ */

/** Degré (0 = do … 6 = si) et altération, en lecture par dièses. */
const SHARP_SPELL = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
/** La même chose, en lecture par bémols. */
const FLAT_SPELL = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];

/** Ordre des dièses à la clé — fa do sol ré la mi si — puis celui des bémols. */
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6];
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3];

/**
 * Devine l'armure du morceau.
 *
 * On n'a pas le luxe d'une indication de tonalité : la plupart des fichiers
 * MIDI n'en portent pas, et `midi.js` ne la lit pas. On procède donc comme le
 * ferait une oreille : on essaie les quinze armures, et on garde celle qui
 * demande le moins d'altérations accidentelles. À égalité, la plus simple
 * gagne — une partition en do majeur n'a aucune raison d'être écrite en si
 * dièse majeur.
 *
 * @returns {number} nombre de quintes : positif pour des dièses, négatif pour
 *   des bémols, zéro pour do majeur / la mineur.
 */
export function guessKey(notes) {
  const histogram = new Array(12).fill(0);
  for (const note of notes) histogram[((note.midi % 12) + 12) % 12] += 1;
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (!total) return 0;

  let best = 0;
  let bestCost = Infinity;
  for (let fifths = -7; fifths <= 7; fifths += 1) {
    const inScale = scalePitchClasses(fifths);
    let cost = 0;
    for (let pc = 0; pc < 12; pc += 1) if (!inScale.has(pc)) cost += histogram[pc];
    // Départage : une armure chargée doit gagner franchement pour l'emporter.
    cost += Math.abs(fifths) * total * 0.004;
    if (cost < bestCost) {
      bestCost = cost;
      best = fifths;
    }
  }
  return best;
}

/** Les sept hauteurs de la gamme majeure correspondant à une armure. */
function scalePitchClasses(fifths) {
  // Do majeur, puis on décale de quinte en quinte.
  const tonic = ((fifths * 7) % 12 + 12) % 12;
  const major = [0, 2, 4, 5, 7, 9, 11];
  return new Set(major.map((degree) => (tonic + degree) % 12));
}

/** Les degrés altérés par l'armure, et le sens de l'altération. */
function keyAlterations(fifths) {
  const map = new Map();
  const order = fifths >= 0 ? SHARP_ORDER : FLAT_ORDER;
  for (let i = 0; i < Math.abs(fifths); i += 1) map.set(order[i], fifths >= 0 ? 1 : -1);
  return map;
}

/**
 * Écrit une hauteur MIDI comme une note lisible : degré, altération, octave.
 * L'armure décide du sens de lecture — fa dièse dans un morceau en ré, sol
 * bémol dans un morceau en ré bémol, pour la même touche du piano.
 */
export function spellPitch(midi, fifths = 0) {
  const table = fifths < 0 ? FLAT_SPELL : SHARP_SPELL;
  const [step, alter] = table[((midi % 12) + 12) % 12];
  // L'octave se compte sur la note naturelle : si dièse appartient à l'octave
  // du si qu'il altère, pas à celle du do qu'il fait sonner.
  const octave = Math.floor((midi - alter) / 12) - 1;
  return { step, alter, octave, diatonic: octave * 7 + step };
}

/* ------------------------------------------------------------------ */
/* Le temps : une grille en noires                                     */
/* ------------------------------------------------------------------ */

/**
 * Convertisseur entre secondes et noires, dans les deux sens.
 *
 * `midi.beats` donne l'instant de chaque noire, tempo variable compris : il
 * suffit d'interpoler entre deux jalons. Au-delà du dernier, on prolonge au
 * dernier tempo connu — les fichiers s'arrêtent souvent une mesure trop tôt.
 */
function buildClock(midi) {
  const times = (midi.beats ?? []).map((beat) => beat.time);
  const fallback = 60 / (midi.averageBpm || 120);
  if (times.length < 2) {
    return {
      timeAt: (quarter) => quarter * fallback,
      quarterAt: (time) => time / fallback,
    };
  }
  const last = times.length - 1;
  const tail = times[last] - times[last - 1];

  return {
    timeAt(quarter) {
      if (quarter <= 0) return times[0] + quarter * (times[1] - times[0]);
      if (quarter >= last) return times[last] + (quarter - last) * tail;
      const index = Math.floor(quarter);
      return times[index] + (quarter - index) * (times[index + 1] - times[index]);
    },
    quarterAt(time) {
      if (time <= times[0]) return (time - times[0]) / (times[1] - times[0]);
      if (time >= times[last]) return last + (time - times[last]) / tail;
      // Recherche dichotomique : la grille peut compter des milliers de temps.
      let low = 0;
      let high = last;
      while (low < high - 1) {
        const mid = (low + high) >> 1;
        if (times[mid] <= time) low = mid;
        else high = mid;
      }
      const span = times[low + 1] - times[low] || fallback;
      return low + (time - times[low]) / span;
    },
  };
}

/** Durée d'une mesure, en noires. Un 6/8 en vaut trois, un 3/4 également. */
function measureQuarters(signature) {
  const numerator = Math.max(1, signature?.numerator ?? 4);
  const denominator = Math.max(1, signature?.denominator ?? 4);
  return (numerator * 4) / denominator;
}

/* ------------------------------------------------------------------ */
/* Mise en page                                                        */
/* ------------------------------------------------------------------ */

/**
 * Découpe un morceau en pages gravées.
 *
 * @param {object} midi partition rendue par `parseMidi`
 * @param {object} [options]
 * @param {number} [options.width] largeur utile de la page, en unités de portée
 * @param {number} [options.systemsPerPage] nombre de systèmes empilés par page
 * @returns {object|null} `null` si le morceau n'a aucune note à graver
 */
export function layoutScore(midi, { width = 1000, systemsPerPage = 2 } = {}) {
  const playable = (midi?.notes ?? []).filter((note) => !note.isDrum).slice(0, MAX_NOTES);
  if (!playable.length) return null;

  const fifths = guessKey(playable);
  const alterations = keyAlterations(fifths);
  const clock = buildClock(midi);
  const perMeasure = measureQuarters(midi.timeSignature);

  /* Les mesures, du début à la dernière note. -------------------------- */
  const lastQuarter = clock.quarterAt(midi.duration);
  const count = Math.max(1, Math.ceil((lastQuarter - 1e-6) / perMeasure));
  const measures = [];
  for (let index = 0; index < count; index += 1) {
    measures.push({
      index,
      startQuarter: index * perMeasure,
      endQuarter: (index + 1) * perMeasure,
      startTime: clock.timeAt(index * perMeasure),
      endTime: clock.timeAt((index + 1) * perMeasure),
      notes: [],
      /** Instants d'attaque distincts, dans l'ordre : les colonnes de la mesure. */
      onsets: new Map(),
    });
  }

  /* Chaque note dans sa mesure, sur sa portée, avec son nom. ----------- */
  for (const note of playable) {
    const quarter = clock.quarterAt(note.time);
    const index = Math.min(measures.length - 1, Math.max(0, Math.floor(quarter / perMeasure)));
    const measure = measures[index];
    const spelled = spellPitch(note.midi, fifths);
    measure.notes.push({
      time: note.time,
      duration: note.duration,
      midi: note.midi,
      velocity: note.velocity,
      quarters: Math.max(0.0625, clock.quarterAt(note.time + note.duration) - quarter),
      staff: note.midi >= SPLIT_PITCH ? 0 : 1,
      ...spelled,
    });
    // Deux attaques à moins de vingt millisecondes l'une de l'autre partagent
    // leur colonne : c'est un accord, pas une succession.
    const column = Math.round(note.time * 50);
    if (!measure.onsets.has(column)) measure.onsets.set(column, note.time);
  }

  /* Les altérations accidentelles, mesure par mesure. ------------------ */
  for (const measure of measures) {
    measure.notes.sort((a, b) => a.time - b.time || a.midi - b.midi);
    // Une altération vaut pour toute la mesure, à sa hauteur exacte : on ne la
    // réécrit pas à chaque fois, comme sur une vraie partition.
    const seen = new Map();
    for (const note of measure.notes) {
      const expected = alterations.get(note.step) ?? 0;
      const key = note.diatonic;
      const shown = seen.has(key) ? seen.get(key) : expected;
      note.accidental = note.alter === shown ? null : note.alter;
      seen.set(key, note.alter);
    }
  }

  /* Colonnes : une par attaque, larges selon ce qui les sépare. ------- */
  for (const measure of measures) {
    measure.columns = buildColumns(measure, perMeasure);
    measure.cost = Math.max(MIN_MEASURE_WIDTH, measure.columns.width);
  }

  /* Répartition en systèmes : au plus large de ce que la ligne accepte. */
  const headWidth = BRACE_WIDTH + CLEF_WIDTH + Math.abs(fifths) * KEY_STEP + SPACE * 1.2;
  const available = width - headWidth;
  const systems = [];
  let current = [];
  let need = 0;

  for (const measure of measures) {
    const cost = measure.cost;
    if (current.length && need + cost > available) {
      systems.push(current);
      current = [];
      need = 0;
    }
    current.push({ measure, cost });
    need += cost;
  }
  if (current.length) systems.push(current);

  /* Placement horizontal : chaque mesure prend sa part de la ligne. ---- */
  const laid = systems.map((entries, index) => {
    const total = entries.reduce((sum, entry) => sum + entry.cost, 0) || 1;
    // Tous les systèmes sont justifiés à la même largeur, sauf le dernier du
    // morceau : une ligne qui s'arrête au milieu de la page n'est juste qu'à
    // la fin d'un recueil. Le dernier, lui, garde sa taille naturelle plutôt
    // que d'étirer deux mesures sur toute la largeur.
    const justified = index < systems.length - 1;
    let x = headWidth;
    const cells = entries.map(({ measure, cost }) => {
      const share = justified
        ? (cost / total) * available
        : Math.min(cost * 1.8, (cost / total) * available);
      const cell = { measure, x, width: share };
      x += share;
      return cell;
    });
    return {
      cells,
      x: headWidth,
      width: x - headWidth,
      startTime: cells[0].measure.startTime,
      endTime: cells[cells.length - 1].measure.endTime,
    };
  });

  /* Les notes reçoivent enfin leur abscisse, celle de leur colonne. ---- */
  for (const system of laid) {
    for (const cell of system.cells) {
      const { measure } = cell;
      const from = cell.x + SPACE * 0.6;
      // Une marge à droite : sans elle, la dernière note collerait à la barre.
      const usable = cell.width - SPACE * 1.7;
      const scale = usable / (measure.columns.width || 1);

      // Table [instant, abscisse] de la mesure : les notes s'y posent, et le
      // curseur y lit sa position entre deux attaques.
      cell.points = measure.columns.entries.map((entry) => ({ time: entry.time, x: from + entry.offset * scale }));
      cell.points.push({ time: measure.endTime, x: from + usable });

      const xByColumn = new Map(measure.columns.entries.map((entry, i) => [entry.column, cell.points[i].x]));
      for (const note of measure.notes) note.x = xByColumn.get(Math.round(note.time * 50)) ?? from;

      cell.chords = groupChords(measure.notes);
    }
  }

  /* Pages. ------------------------------------------------------------- */
  const perPage = Math.max(1, systemsPerPage);
  const pages = [];
  for (let i = 0; i < laid.length; i += perPage) {
    const group = laid.slice(i, i + perPage);
    pages.push({
      index: pages.length,
      systems: group,
      startTime: group[0].startTime,
      endTime: group[group.length - 1].endTime,
    });
  }

  return {
    fifths,
    alterations,
    clock,
    width,
    height: MARGIN_TOP + perPage * SYSTEM_HEIGHT + (perPage - 1) * SYSTEM_SPACING + MARGIN_BOTTOM,
    systemsPerPage: perPage,
    pages,
    measures,
    duration: midi.duration,
    notes: playable,
  };
}

/**
 * Les colonnes d'une mesure, et la largeur qu'elles réclament.
 *
 * C'est ici que se joue la lisibilité d'un trait rapide. Espacer les notes
 * proportionnellement au temps semble naturel — et donne des paquets illisibles
 * dès qu'une mesure mêle une blanche et douze doubles croches : les douze se
 * tassent dans le dernier quart de la mesure.
 *
 * La gravure procède autrement, et depuis des siècles : chaque attaque reçoit
 * sa colonne, et l'espace qui la suit croît beaucoup plus lentement que sa
 * durée — une note deux fois plus longue prend une fois et demie la place, pas
 * le double. Les traits rapides respirent, les notes tenues ne creusent pas de
 * trou, et le rapport au temps reste lisible.
 *
 * Le curseur, lui, ne perd rien à ce changement : il interpole entre deux
 * colonnes et tombe donc exactement sur chaque note à l'instant où elle sonne.
 */
function buildColumns(measure, perMeasure) {
  const span = measure.endTime - measure.startTime;
  // Durée d'une noire dans cette mesure-ci : la référence des largeurs.
  const beat = span > 0 ? span / perMeasure : 0.5;

  const times = [...measure.onsets.entries()]
    .map(([column, time]) => ({ column, time }))
    .sort((a, b) => a.time - b.time)
    .filter((entry) => entry.time < measure.endTime);

  // Une mesure qui commence par un silence garde son début : le curseur doit
  // pouvoir y entrer avant que la première note ne sonne.
  if (!times.length || times[0].time > measure.startTime + 0.01) {
    times.unshift({ column: -1, time: measure.startTime });
  }

  const entries = [];
  let offset = 0;
  for (let i = 0; i < times.length; i += 1) {
    entries.push({ column: times[i].column, time: times[i].time, offset });
    const next = i + 1 < times.length ? times[i + 1].time : measure.endTime;
    const duration = Math.max(0.01, next - times[i].time);
    // L'exposant tient l'écart entre une ronde et une double croche dans un
    // rapport de trois, là où le temps les sépare d'un facteur seize.
    offset += MIN_ONSET_GAP * Math.max(0.62, (duration / beat) ** 0.5);
  }
  return { entries, width: offset };
}

/**
 * Rassemble en accords les notes qui tombent ensemble sur la même portée.
 *
 * Sans cela, chaque note d'un accord porterait sa propre hampe, et une simple
 * quinte ressemblerait à deux voix. On aligne aussi les têtes qui se touchent :
 * deux degrés voisins ne peuvent pas occuper la même colonne, la seconde se
 * décale d'une tête vers la droite — c'est la règle, et c'est ce qui rend un
 * accord lisible d'un coup d'œil.
 */
function groupChords(notes) {
  const chords = [];
  const byKey = new Map();
  for (const note of notes) {
    // Trois centièmes de seconde : au-delà, l'oreille entend deux attaques.
    const key = `${note.staff}:${Math.round(note.time * 33)}`;
    let chord = byKey.get(key);
    if (!chord) {
      chord = { staff: note.staff, time: note.time, x: note.x, quarters: note.quarters, notes: [] };
      byKey.set(key, chord);
      chords.push(chord);
    }
    chord.notes.push(note);
    chord.quarters = Math.max(chord.quarters, note.quarters);
    chord.x = Math.min(chord.x, note.x);
  }

  for (const chord of chords) {
    chord.notes.sort((a, b) => a.diatonic - b.diatonic);
    let previous = null;
    let shifted = false;
    for (const note of chord.notes) {
      shifted = previous !== null && note.diatonic - previous === 1 && !shifted;
      note.shift = shifted ? 1 : 0;
      previous = note.diatonic;
    }
  }
  return chords;
}

/**
 * Retrouve la page qui contient un instant donné.
 * @returns {number} index de page, borné aux pages existantes
 */
export function pageAt(score, time) {
  const pages = score.pages;
  for (let i = 0; i < pages.length; i += 1) if (time < pages[i].endTime) return i;
  return pages.length - 1;
}

/* ------------------------------------------------------------------ */
/* Rendu SVG                                                           */
/* ------------------------------------------------------------------ */

function svg(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
  return element;
}

/** Ordonnée de la ligne du bas de chaque portée, dans un système. */
function staffTops(top) {
  return [top + SYSTEM_PAD_TOP, top + SYSTEM_PAD_TOP + STAFF + STAFF_GAP];
}

/**
 * Ordonnée d'une hauteur diatonique sur une portée.
 *
 * La portée de sol pose mi4 sur sa ligne du bas, celle de fa y pose sol2 :
 * deux repères, et tout le reste se déduit d'un demi-interligne par degré.
 */
function pitchY(diatonic, staff, staffTop) {
  const bottom = staffTop + STAFF;
  const reference = staff === 0 ? 4 * 7 + 2 : 2 * 7 + 4; // mi4, puis sol2
  return bottom - (diatonic - reference) * (SPACE / 2);
}

/* ------------------------------------------------------------------ */
/* Les tracés : clés et accolade                                       */
/* ------------------------------------------------------------------ */

/**
 * Épaissit une courbe en ruban.
 *
 * Les caractères musicaux d'Unicode manquent à trop de téléphones pour qu'on
 * leur confie la première chose que le lecteur regarde : les clés sont donc
 * dessinées. Plutôt que de deviner des points de contrôle de Bézier, on décrit
 * chaque glyphe par la ligne que suivrait une plume — quelques points, et
 * l'épaisseur du trait à chacun — et cette fonction en tire le contour. La
 * courbe est lissée par une spline qui passe exactement par les points donnés,
 * ce qui rend chaque glyphe réglable en déplaçant un seul chiffre.
 *
 * @param {Array<[number, number, number]>} spine points `[x, y, épaisseur]`
 * @param {number} unit taille d'un interligne, en unités du dessin
 */
function ribbon(spine, unit = SPACE) {
  const points = spine.map(([x, y, w]) => ({ x: x * unit, y: y * unit, w: w * unit }));
  const at = (i) => points[Math.max(0, Math.min(points.length - 1, i))];

  /* Lissage : spline de Catmull-Rom, épaisseur comprise. */
  const dense = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const [p0, p1, p2, p3] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let step = 0; step < 12; step += 1) {
      const t = step / 12;
      const t2 = t * t;
      const t3 = t2 * t;
      const mix = (a, b, c, d) =>
        0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push({
        x: mix(p0.x, p1.x, p2.x, p3.x),
        y: mix(p0.y, p1.y, p2.y, p3.y),
        w: Math.max(0, mix(p0.w, p1.w, p2.w, p3.w)),
      });
    }
  }
  dense.push(points[points.length - 1]);

  /* Contour : un côté à l'aller, l'autre au retour. */
  const left = [];
  const right = [];
  for (let i = 0; i < dense.length; i += 1) {
    const before = dense[Math.max(0, i - 1)];
    const after = dense[Math.min(dense.length - 1, i + 1)];
    const length = Math.hypot(after.x - before.x, after.y - before.y) || 1;
    const nx = -(after.y - before.y) / length;
    const ny = (after.x - before.x) / length;
    const half = dense[i].w / 2;
    left.push(`${(dense[i].x + nx * half).toFixed(2)} ${(dense[i].y + ny * half).toFixed(2)}`);
    right.push(`${(dense[i].x - nx * half).toFixed(2)} ${(dense[i].y - ny * half).toFixed(2)}`);
  }
  return `M ${left.join(' L ')} L ${right.reverse().join(' L ')} Z`;
}

/**
 * Clé de sol, décrite autour du centre de sa spirale — c'est-à-dire autour du
 * sol qu'elle désigne, deuxième ligne en partant du bas. Le trait part du
 * crochet de la queue, sous la portée, monte tout droit jusqu'au sommet, puis
 * redescend en s'enroulant : une seule plume, du début à la fin.
 * Coordonnées en interlignes, y vers le bas.
 */
const G_CLEF = ribbon([
  [-1.15, 2.90, 0.06],
  [-0.35, 3.15, 0.16],
  [0.35, 2.80, 0.23],
  [0.55, 1.85, 0.23],
  [0.55, 0.20, 0.21],
  [0.50, -1.85, 0.20],
  [0.45, -3.30, 0.19],
  [0.15, -4.15, 0.19],
  [-0.55, -4.35, 0.20],
  [-1.15, -3.70, 0.22],
  [-1.20, -2.75, 0.25],
  [-0.80, -1.80, 0.28],
  [-0.05, -0.95, 0.32],
  [0.80, -0.20, 0.35],
  [1.20, 0.70, 0.33],
  [0.85, 1.55, 0.29],
  [0.00, 1.80, 0.25],
  [-0.75, 1.35, 0.20],
  [-0.90, 0.60, 0.15],
  [-0.55, 0.05, 0.10],
  [0.00, -0.05, 0.05],
]);

/**
 * Clé de fa, décrite autour du fa qu'elle désigne, quatrième ligne en partant
 * du bas : le gros bout d'abord, puis le croissant qui s'affine en descendant.
 */
const F_CLEF = ribbon([
  [-0.70, -0.20, 1.00],
  [0.30, -0.95, 0.85],
  [1.25, -0.15, 0.58],
  [1.45, 0.95, 0.46],
  [0.90, 2.05, 0.34],
  [-0.15, 2.80, 0.20],
  [-1.45, 3.15, 0.06],
]);

/**
 * L'accolade du système : deux pointes fines aux extrémités, un ventre au
 * milieu, et une taille fine au centre. Elle s'étire avec la hauteur du
 * système, ce qu'un tracé figé ne saurait pas faire.
 */
function brace(top, bottom) {
  const height = bottom - top;
  const right = BRACE_WIDTH * 0.95;
  const reach = BRACE_WIDTH * 0.8;
  const thickness = BRACE_WIDTH * 0.3;
  const spine = [];
  for (let i = 0; i <= 24; i += 1) {
    const s = i / 24;
    // Deux moitiés symétriques : `half` va de 0 à la pointe, 1 au centre.
    const half = s <= 0.5 ? s * 2 : (1 - s) * 2;
    spine.push([
      (right - (reach * (1 - Math.cos(Math.PI * half))) / 2) / SPACE,
      (top + s * height) / SPACE,
      (thickness * Math.sin(Math.PI * half) ** 0.7) / SPACE,
    ]);
  }
  return ribbon(spine);
}

/**
 * Dessine une page dans un `<svg>` neuf.
 *
 * Les notes reçoivent un `data-midi` et un `data-index` : c'est par là que le
 * suivi vient les allumer, sans jamais retoucher à la géométrie.
 */
export function renderPage(score, pageIndex) {
  const page = score.pages[pageIndex];
  const root = svg('svg', {
    class: 'score-page',
    viewBox: `0 0 ${score.width + MARGIN_X * 2} ${score.height}`,
    preserveAspectRatio: 'xMidYMid meet',
    'aria-hidden': 'true',
  });

  const noteElements = [];

  page.systems.forEach((system, position) => {
    const top = MARGIN_TOP + position * (SYSTEM_HEIGHT + SYSTEM_SPACING);
    const group = svg('g', { class: 'score-system', transform: `translate(${MARGIN_X} 0)` });
    const [trebleTop, bassTop] = staffTops(top);
    const right = system.x + system.width;

    /* Les dix lignes, et les traits qui relient les deux portées. */
    for (const staffTop of [trebleTop, bassTop]) {
      for (let line = 0; line < 5; line += 1) {
        group.append(svg('line', {
          class: 'score-staff-line',
          x1: 0, x2: right,
          y1: staffTop + line * SPACE, y2: staffTop + line * SPACE,
        }));
      }
    }
    group.append(svg('path', {
      class: 'score-brace',
      d: brace(trebleTop, bassTop + STAFF),
    }));
    group.append(svg('line', {
      class: 'score-barline',
      x1: 0, x2: 0, y1: trebleTop, y2: bassTop + STAFF,
    }));

    /* Les clés. */
    group.append(svg('path', {
      class: 'score-clef',
      d: G_CLEF,
      // La spirale s'enroule autour de sol4, deuxième ligne en partant du bas.
      transform: `translate(${BRACE_WIDTH + SPACE * 1.9} ${trebleTop + 3 * SPACE})`,
    }));
    group.append(svg('path', {
      class: 'score-clef',
      d: F_CLEF,
      // Le gros bout de la clé de fa se pose sur fa3, quatrième ligne.
      transform: `translate(${BRACE_WIDTH + SPACE * 2.3} ${bassTop + SPACE})`,
    }));
    for (const dot of [-0.5, 0.5]) {
      group.append(svg('circle', {
        class: 'score-clef-dot',
        cx: BRACE_WIDTH + SPACE * 4.4,
        cy: bassTop + SPACE + dot * SPACE,
        r: SPACE * 0.16,
      }));
    }

    /* L'armure, sur les deux portées. */
    drawKeySignature(group, score.fifths, trebleTop, 0, BRACE_WIDTH + CLEF_WIDTH);
    drawKeySignature(group, score.fifths, bassTop, 1, BRACE_WIDTH + CLEF_WIDTH);

    /* Les mesures : barre finale à droite de chacune, notes à l'intérieur. */
    for (const cell of system.cells) {
      const end = cell.x + cell.width;
      group.append(svg('line', {
        class: 'score-barline',
        x1: end, x2: end, y1: trebleTop, y2: bassTop + STAFF,
      }));
      for (const chord of cell.chords ?? []) {
        noteElements.push(...drawChord(group, chord, chord.staff === 0 ? trebleTop : bassTop));
      }
    }

    root.append(group);
  });

  return { svg: root, page, noteElements };
}

/**
 * Position des altérations à la clé, en demi-interlignes sous la ligne
 * supérieure de la portée. L'ordre alterne quarte montante et quinte
 * descendante : c'est ce qui les garde groupées sur la portée.
 */
const SHARP_ROWS = [0, 3, -1, 2, 5, 1, 4];
const FLAT_ROWS = [4, 1, 5, 2, 6, 3, 7];

function drawKeySignature(group, fifths, staffTop, staff, x) {
  const count = Math.abs(fifths);
  const rows = fifths >= 0 ? SHARP_ROWS : FLAT_ROWS;
  for (let i = 0; i < count; i += 1) {
    // En clé de fa, tout descend de deux degrés — sauf quand cela sortirait
    // par le bas, auquel cas l'altération remonte d'une octave, comme en
    // gravure traditionnelle.
    let row = rows[i] + (staff === 1 ? 2 : 0);
    if (row > 8) row -= 7;
    const text = svg('text', {
      class: 'score-key-accidental',
      x: x + i * KEY_STEP,
      y: staffTop + row * (SPACE / 2) + SPACE * 0.34,
    });
    text.textContent = fifths >= 0 ? '♯' : '♭';
    group.append(text);
  }
}

/**
 * Un accord : ses têtes, ses lignes supplémentaires, ses altérations, et la
 * hampe unique qui les relie.
 */
function drawChord(group, chord, staffTop) {
  const element = svg('g', { class: 'score-chord' });
  const heads = [];
  const middle = staffTop + STAFF / 2;
  const positions = chord.notes.map((note) => pitchY(note.diatonic, chord.staff, staffTop));

  // La hampe monte si l'accord est bas sur la portée, et inversement : c'est la
  // note la plus éloignée du milieu qui tranche.
  const lowest = Math.max(...positions);
  const highest = Math.min(...positions);
  const up = lowest - middle >= middle - highest;

  const headRadius = SPACE * 0.66;
  const hollow = chord.quarters >= 1.75;

  chord.notes.forEach((note, index) => {
    const y = positions[index];
    // Une seconde décale sa tête du côté de la hampe : elle ne peut pas
    // partager la colonne de sa voisine.
    const x = chord.x + note.shift * headRadius * (up ? 1.85 : -1.85);
    const head = svg('ellipse', {
      class: `score-head${hollow ? ' hollow' : ''}`,
      cx: x, cy: y, rx: headRadius, ry: SPACE * 0.47,
      transform: `rotate(-18 ${x} ${y})`,
      'data-midi': note.midi,
    });
    element.append(head);
    heads.push({ note, element: head });

    /* Lignes supplémentaires, au-dessus comme en dessous de la portée. */
    for (let offset = staffTop - SPACE; offset >= y - 0.1; offset -= SPACE) {
      element.append(svg('line', {
        class: 'score-ledger',
        x1: x - SPACE * 0.9, x2: x + SPACE * 0.9, y1: offset, y2: offset,
      }));
    }
    for (let offset = staffTop + STAFF + SPACE; offset <= y + 0.1; offset += SPACE) {
      element.append(svg('line', {
        class: 'score-ledger',
        x1: x - SPACE * 0.9, x2: x + SPACE * 0.9, y1: offset, y2: offset,
      }));
    }

    /* Altération accidentelle, à gauche de la tête. */
    if (note.accidental !== null && note.accidental !== undefined) {
      const text = svg('text', {
        class: 'score-accidental',
        x: x - SPACE * 1.2,
        y: y + SPACE * 0.34,
      });
      text.textContent = note.accidental > 0 ? '♯' : note.accidental < 0 ? '♭' : '♮';
      element.append(text);
    }
  });

  /* La hampe, et ses crochets. La ronde n'en a pas. */
  if (chord.quarters < 3.5) {
    const stemX = chord.x + (up ? headRadius : -headRadius) * 0.94;
    const from = up ? lowest : highest;
    const to = (up ? highest : lowest) + (up ? -SPACE * 3.2 : SPACE * 3.2);
    element.append(svg('line', { class: 'score-stem', x1: stemX, x2: stemX, y1: from, y2: to }));

    const flags = chord.quarters < 0.1875 ? 3 : chord.quarters < 0.4375 ? 2 : chord.quarters < 0.875 ? 1 : 0;
    const sign = up ? 1 : -1;
    for (let i = 0; i < flags; i += 1) {
      const start = to + sign * i * SPACE * 0.68;
      element.append(svg('path', {
        class: 'score-flag',
        d: `M ${stemX} ${start} C ${stemX + SPACE * 1.15} ${start + sign * SPACE * 0.75}, `
          + `${stemX + SPACE * 1.0} ${start + sign * SPACE * 1.6}, ${stemX + SPACE * 0.25} ${start + sign * SPACE * 2.2} `
          + `C ${stemX + SPACE * 1.0} ${start + sign * SPACE * 1.35}, ${stemX + SPACE * 0.85} ${start + sign * SPACE * 0.8}, ${stemX} ${start + sign * SPACE * 0.5} Z`,
      }));
    }
  }

  group.append(element);
  return heads;
}


/* ------------------------------------------------------------------ */
/* Suivi de la lecture                                                 */
/* ------------------------------------------------------------------ */

/**
 * Interligne visé à l'écran, en pixels : c'est lui qui fixe toute la densité
 * de la page — combien de mesures par ligne, combien de lignes par page. Un
 * peu plus généreux au doigt qu'à la souris, parce qu'un téléphone posé sur un
 * pupitre se regarde de plus loin qu'un écran d'ordinateur.
 */
const TARGET_SPACE_PX = { coarse: 8, fine: 9 };

/**
 * Une partition qui suit la musique.
 *
 * La vue ne détient aucune horloge : on lui donne un instant, elle place le
 * curseur, allume les notes qui sonnent, et tourne la page quand la musique
 * en sort. C'est ce qui lui permet de servir aussi bien le lecteur local, qui
 * connaît la seconde exacte, que le téléphone d'un visiteur, qui la déduit du
 * flux du stand.
 */
export class ScoreView {
  /**
   * @param {HTMLElement} container élément qui reçoit les pages
   * @param {object} [options]
   * @param {boolean} [options.coarse] vrai sur un écran tactile : gravure plus grande
   */
  constructor(container, { coarse = false } = {}) {
    this.container = container;
    this.coarse = coarse;
    this.midi = null;
    this.score = null;
    this.pageIndex = -1;
    this.notes = [];
    this._cursorIndex = 0;
    this._cursorTime = -1;
    this._active = new Set();
    this._cursor = null;
    this._svg = null;
    /** Dernière taille prise en compte, pour ne regraver qu'en cas de besoin. */
    this._size = { width: 0, height: 0 };
  }

  /** Nombre de pages de la partition en cours, zéro s'il n'y en a pas. */
  get pageCount() {
    return this.score?.pages.length ?? 0;
  }

  /** Numéro de la page affichée, à partir de 1. */
  get pageNumber() {
    return this.pageIndex + 1;
  }

  /**
   * Change de morceau. `null` vide la vue.
   * @param {object|null} midi partition rendue par `parseMidi`
   */
  setMidi(midi) {
    this.midi = midi;
    this.score = null;
    this.pageIndex = -1;
    this.container.textContent = '';
    this._size = { width: 0, height: 0 };
    if (midi) this.relayout();
  }

  /**
   * Regrave la partition pour la place disponible.
   * @returns {boolean} vrai si quelque chose a changé
   */
  relayout(force = false) {
    if (!this.midi) return false;
    const box = this.container.getBoundingClientRect();
    const width = Math.round(box.width);
    const height = Math.round(box.height);
    if (!width || !height) return false;
    // Quelques pixels de plus ne justifient pas de tout regraver : sur un
    // téléphone, la barre d'adresse suffirait à relancer la mise en page à
    // chaque défilement.
    if (!force && Math.abs(width - this._size.width) < 24 && Math.abs(height - this._size.height) < 24) return false;
    this._size = { width, height };

    const space = this.coarse ? TARGET_SPACE_PX.coarse : TARGET_SPACE_PX.fine;
    const inner = Math.max(620, Math.min(1400, (width * SPACE) / space - MARGIN_X * 2));
    // Autant de systèmes que la hauteur en accepte à cet interligne-là, et
    // jamais un de plus : mieux vaut du blanc en bas de page qu'une gravure
    // qu'il faut approcher de l'œil.
    const wanted = (height * SPACE) / space;
    const perPage = Math.max(1, Math.min(4, Math.floor((wanted - MARGIN_TOP - MARGIN_BOTTOM + SYSTEM_SPACING) / (SYSTEM_HEIGHT + SYSTEM_SPACING))));

    this.score = layoutScore(this.midi, { width: inner, systemsPerPage: perPage });
    this.pageIndex = -1;
    return Boolean(this.score);
  }

  /** Affiche une page, avec l'animation de tourne-page. */
  showPage(index, { animate = true } = {}) {
    if (!this.score) return;
    const bounded = Math.max(0, Math.min(this.score.pages.length - 1, index));
    if (bounded === this.pageIndex) return;
    const forward = bounded > this.pageIndex;
    this.pageIndex = bounded;

    const { svg: page, noteElements } = renderPage(this.score, bounded);
    this.notes = noteElements.sort((a, b) => a.note.time - b.note.time);
    this._cursorIndex = 0;
    this._cursorTime = -1;
    this._active.clear();

    this._cursor = svg('line', {
      class: 'score-cursor',
      x1: 0, x2: 0, y1: MARGIN_TOP, y2: this.score.height - MARGIN_BOTTOM,
      // Le curseur attend le premier `update()` pour se montrer : posé à
      // l'abscisse zéro, il clignoterait à chaque tourne-page.
      opacity: 0,
    });
    page.append(this._cursor);

    const previous = this._svg;
    this._svg = page;
    if (animate && previous) {
      page.dataset.turn = forward ? 'in' : 'back';
      previous.dataset.turn = forward ? 'out' : 'back-out';
      previous.addEventListener('animationend', () => previous.remove(), { once: true });
      // Filet : une animation qui ne se déclenche pas laisserait deux pages.
      setTimeout(() => previous.remove(), 700);
      this.container.append(page);
    } else {
      this.container.textContent = '';
      this.container.append(page);
    }
  }

  /**
   * Place le curseur et allume les notes qui sonnent à cet instant.
   * @param {number} time position dans le morceau, en secondes
   */
  update(time) {
    if (!this.score) return;
    const wanted = pageAt(this.score, time);
    if (wanted !== this.pageIndex) this.showPage(wanted, { animate: this.pageIndex >= 0 });

    const page = this.score.pages[this.pageIndex];
    if (!page) return;

    /* Le curseur : le système qui contient l'instant, puis la mesure. */
    const place = this._locate(page, time);
    if (place && this._cursor) {
      this._cursor.setAttribute('transform', `translate(${place.x + MARGIN_X} 0)`);
      this._cursor.setAttribute('y1', place.top);
      this._cursor.setAttribute('y2', place.bottom);
      this._cursor.setAttribute('opacity', '1');
    }

    /* Les notes qui sonnent. Un saut en arrière repart de zéro. */
    if (time < this._cursorTime - 0.05) {
      this._cursorIndex = 0;
      for (const entry of this._active) entry.element.dataset.on = '0';
      this._active.clear();
    }
    this._cursorTime = time;
    while (this._cursorIndex < this.notes.length && this.notes[this._cursorIndex].note.time <= time) {
      const entry = this.notes[this._cursorIndex];
      this._cursorIndex += 1;
      if (entry.note.time + entry.note.duration > time) {
        entry.element.dataset.on = '1';
        this._active.add(entry);
      }
    }
    for (const entry of this._active) {
      if (entry.note.time + entry.note.duration <= time - 0.04 || entry.note.time > time) {
        entry.element.dataset.on = '0';
        this._active.delete(entry);
      }
    }
  }

  /** Abscisse et hauteur du curseur pour un instant donné, sur la page affichée. */
  _locate(page, time) {
    let systemIndex = page.systems.findIndex((system) => time < system.endTime);
    if (systemIndex < 0) systemIndex = page.systems.length - 1;
    const system = page.systems[systemIndex];
    const top = MARGIN_TOP + systemIndex * (SYSTEM_HEIGHT + SYSTEM_SPACING);
    const [trebleTop, bassTop] = staffTops(top);

    let x = system.x;
    for (const cell of system.cells) {
      if (time >= cell.measure.endTime) {
        x = cell.points[cell.points.length - 1].x;
        continue;
      }
      // Entre deux attaques, le curseur glisse au prorata du temps : il tombe
      // ainsi sur chaque note exactement quand elle sonne.
      const points = cell.points;
      let index = 0;
      while (index < points.length - 2 && points[index + 1].time <= time) index += 1;
      const from = points[index];
      const to = points[index + 1];
      const ratio = Math.max(0, Math.min(1, (time - from.time) / (to.time - from.time || 1)));
      x = from.x + ratio * (to.x - from.x);
      break;
    }
    return { x, top: trebleTop - SPACE * 1.6, bottom: bassTop + STAFF + SPACE * 1.6 };
  }
}
