# Ta bibliothèque

Dépose ici les morceaux que le jukebox doit proposer, puis clique sur
**Actualiser** dans la page. Rien à déclarer nulle part : le serveur relit ce
dossier à chaque fois.

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
Frédéric Chopin - Nocturne op.9 no.2.mid
Frédéric Chopin - Nocturne op.9 no.2.jpg      ← pochette, facultative
Scott Joplin - The Entertainer.mid
Scott Joplin - The Entertainer.mp3            ← un vrai enregistrement
Une improvisation.mid                         ← sans interprète, ça marche aussi
```

Les fichiers qui partagent le même nom de base forment **un seul morceau**.

- Partitions : `.mid`, `.midi`
- Audio : `.mp3`, `.m4a`, `.ogg`, `.opus`, `.wav`, `.flac`
- Pochettes : `.jpg`, `.png`, `.webp`, `.avif` — sans pochette, une couleur est
  tirée du titre.

## Où trouver des fichiers MIDI

- [Mutopia](https://www.mutopiaproject.org/) — partitions du domaine public
- [Piano-MIDI.de](http://www.piano-midi.de/) — le grand répertoire classique
- [MuseScore](https://musescore.org) — export MIDI depuis n'importe quelle partition
- ton séquenceur habituel (Logic, Ableton, GarageBand…) exporte aussi en MIDI

## Les morceaux de démonstration

Au premier lancement, si ce dossier est vide, quatre morceaux y sont écrits :
trois pièces du domaine public et une piste de réglage (*Gammes et arpèges*)
conçue pour trouver la bonne puissance moteur — elle alterne notes isolées,
silence franc, gamme, arpèges denses et accord tenu.

Supprime-les quand tu veux ; ils ne reviendront que si le dossier redevient vide.

---

*Le contenu de ce dossier n'est pas suivi par Git (voir `.gitignore`) : ta
musique reste chez toi.*
