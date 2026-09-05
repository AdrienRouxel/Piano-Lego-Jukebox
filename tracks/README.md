# Ta bibliothèque

Dépose ici les morceaux que le jukebox doit proposer, puis clique sur
**Actualiser** dans la page. Rien à déclarer nulle part : le serveur relit ce
dossier à chaque fois.

## Les catégories

Chaque **sous-dossier est une catégorie**. Dans la page, elle devient une
section qu'on ouvre et qu'on ferme d'un clic, et qui retient son état d'une
visite à l'autre.

```
tracks/
├── Classique/     20 pièces du domaine public
├── Moderne/       10 pièces originales
├── Gaming/        vide — à toi de la remplir
├── Réglage/       la piste de calibration du moteur
└── Un morceau.mid  ← à la racine : catégorie « Mes morceaux »
```

Un sous-dossier vide **reste visible** dans la page : c'est fait exprès, pour
qu'on sache où déposer ses fichiers. Crée le tien quand tu veux, il apparaîtra
au prochain *Actualiser*.

Un seul niveau est exploré : un dossier dans un dossier est ignoré.

## Le format à privilégier : le MIDI

Un fichier `.mid` n'est pas de l'audio, c'est une **partition** : chaque note,
son instant, sa durée, sa nuance. Le jukebox sait donc exactement ce qui se
passe à chaque milliseconde et cale le moteur du piano au temps près. Un MP3
n'est qu'une onde sonore : il faut deviner.

| Ce que tu déposes | Son | Mouvement des touches |
|---|---|---|
| `Titre.mid` | synthétisé, avec des échantillons de vrai piano | calé sur la partition |
| `Titre.mid` + `Titre.mp3` | ton enregistrement, tel quel | calé sur la partition |
| `Titre.mp3` seul | ton enregistrement | déduit du niveau sonore, moins précis |

## Nommage

Le nom du fichier fait office de fiche, sous la forme `Interprète - Titre` :

```
Classique/Frédéric Chopin - Nocturne op.9 no.2.mid
Classique/Frédéric Chopin - Nocturne op.9 no.2.jpg   ← pochette, facultative
Classique/Scott Joplin - The Entertainer.mid
Classique/Scott Joplin - The Entertainer.mp3         ← un vrai enregistrement
Une improvisation.mid                                ← sans interprète, ça marche aussi
```

Les fichiers qui partagent le même nom de base, **dans le même dossier**,
forment **un seul morceau**. Deux catégories peuvent donc contenir un morceau
homonyme sans qu'ils se confondent.

- Partitions : `.mid`, `.midi`
- Audio : `.mp3`, `.m4a`, `.ogg`, `.opus`, `.wav`, `.flac`
- Pochettes : `.jpg`, `.png`, `.webp`, `.avif` — sans pochette, une couleur est
  tirée du titre.

## Où trouver des fichiers MIDI

- [Mutopia](https://www.mutopiaproject.org/) — partitions du domaine public
- [Piano-MIDI.de](http://www.piano-midi.de/) — le grand répertoire classique
- [MuseScore](https://musescore.org) — export MIDI depuis n'importe quelle partition
- ton séquenceur habituel (Logic, Ableton, GarageBand…) exporte aussi en MIDI

## La bibliothèque de départ

Au premier lancement, si ce dossier est vide, 31 morceaux y sont écrits — tous
générés localement à partir des partitions codées dans `scripts/scores/`, rien
n'est téléchargé.

- **Classique** (20) — Bach, Pachelbel, Vivaldi, Mozart, Beethoven, Chopin,
  Brahms, Offenbach, Grieg, Tchaïkovski, Satie, Joplin. Œuvres du domaine
  public, en **arrangement simplifié** : mélodie et accompagnement sur une
  trentaine de mesures, dans une tessiture lisible sur les 25 touches du
  modèle. Ce ne sont pas les partitions intégrales.
- **Moderne** (10) — des pièces **originales**, écrites pour ce projet dans les
  esthétiques du piano des cinq dernières années : lo-fi, piano minimaliste,
  synthwave, amapiano, drill, phonk, dance-pop, ballade, house, générique.
  Ce ne sont pas des transcriptions de chansons existantes : les tubes récents
  sont des œuvres protégées, et les recopier note à note en ferait des copies.
  Pour les entendre ici, dépose tes propres fichiers dans `Moderne/`.
- **Gaming** — vide, prête à remplir.
- **Réglage** (1) — *Gammes et arpèges*, conçue pour trouver la bonne puissance
  moteur : elle alterne notes isolées, silence franc, gamme, arpèges denses et
  accord tenu.

Supprime ce que tu veux ; rien ne revient tant que le dossier n'est pas
entièrement vide. Pour tout régénérer sans passer par là :

```bash
npm run make-library          # n'écrase aucun fichier existant
npm run make-library -- --force   # réécrit tout
```

---

*Le contenu de ce dossier n'est pas suivi par Git (voir `.gitignore`) : ta
musique reste chez toi.*
