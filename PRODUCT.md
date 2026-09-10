# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

**Le démonstrateur** — l'auteur du projet, enseignant/staff Epitech. Il installe le
jukebox sur un stand, connecte le piano en Bluetooth, choisit ce qui joue, et
s'en sert comme support de conversation avec les visiteurs. Chez lui, c'est aussi
son usage personnel : il explore la bibliothèque, convertit des morceaux, règle
le moteur.

**Le visiteur de stand** — lycéen, parent, curieux de salon. Il s'arrête entre
trente secondes et cinq minutes, souvent debout, dans le bruit. Il scanne un code
QR, demande un morceau depuis son téléphone, applaudit, et regarde le piano
bouger. Il ne lit aucune documentation et ne reviendra pas.

**Le visiteur technique** — celui qui demande « concrètement, il y a quoi
derrière ? ». Le geek mode existe pour lui : il veut voir la mesure, pas la
promesse.

## Product Purpose

Piloter le LEGO Ideas Grand Piano 21323 depuis un navigateur : le son sort de
l'ordinateur, le piano bouge ses touches en rythme via Bluetooth. Le succès se
mesure à une chose — un visiteur qui s'arrête, comprend en quelques secondes que
la machine devant lui est réellement commandée par la page, et repart avec l'idée
que du code écrit à l'école fait bouger un objet physique.

## Positioning

Le modèle n'a pas de touches adressables : un unique arbre à cames soulève les
touches, et la seule grandeur pilotable est sa vitesse de rotation. L'application
officielle LEGO module cette vitesse sur une boucle invariable. Ce jukebox déduit
d'une vraie partition l'intensité de chaque instant — densité des notes, nuances,
temps forts — et en tire une consigne moteur qui suit réellement la musique.

Le second axe, indissociable : **tout y est mesuré, jamais simulé**. Le code QR
est calculé sur place, la partition est gravée par le navigateur qui l'affiche,
la télémétrie vient d'API réelles. La seule grandeur déduite d'un modèle — la
vitesse de l'arbre à cames — est annoncée comme une estimation. Le projet perd sa
raison d'être le jour où il affiche un chiffre décoratif.

## Operating Context

**Trois scènes, qui ne demandent pas la même interface :**

- *Le bureau* — le démonstrateur devant l'écran, à un mètre. Densité, biblio-
  thèque parcourue, réglages ouverts, geek mode déplié.
- *Les portes ouvertes* — une demi-journée, une équipe derrière la table,
  l'écran comme support de conversation. Deux heures de moteur cumulées.
- *Le salon* — trois à cinq jours, neuf heures par jour, un hall de deux cents
  exposants, le stand parfois vide. L'écran devient une affiche à lire à dix
  mètres, un écran d'appel prend le relais après une minute d'inactivité, les
  réglages se verrouillent, le moteur s'accorde des pauses.

Le mode borne (touche `S`) est la bascule explicite entre le registre dense et le
registre monumental : plein écran, bibliothèque masquée, tout grossit, et la
musique ne s'arrête jamais.

Le poste du jukebox reste sur `localhost` ou `https://` — le Web Bluetooth exige
un contexte sécurisé. Les visiteurs, eux, arrivent sur leur forfait mobile.

## Capabilities and Constraints

- **Aucune dépendance, aucune étape de build, aucun compte.** Un serveur Node
  vanilla (`server.mjs`) et des modules ES natifs servis tels quels. Cette
  contrainte est structurante : pas de bundler, pas de framework, pas de CDN à
  l'exécution. Polices et logo servis depuis `web/assets/brand/`.
- **Fonctionne hors connexion.** Rien n'est téléchargé au chargement de la page.
- **Navigateur** : Chrome, Edge, Brave ou Arc pour le pilotage Bluetooth. La
  musique fonctionne partout ; Safari et Firefox n'ont pas le Web Bluetooth.
- **Toute la couleur passe par des variables CSS.** Un thème est un bloc
  `[data-theme="…"]` qui les redéfinit, posé sur `<html>` par un script du
  `<head>` avant le premier rendu.
- **Surfaces** : `index.html` (jukebox), `remote.html` (télécommande visiteur),
  le mode partition (pupitre plein écran, jukebox et téléphone), le geek mode et
  son second écran, `print.html` (chevalet), `geek.html` (télémétrie déportée).
- **Deux claviers à l'écran** : la *partition* (88 touches, les notes réellement
  jouées) et le *modèle LEGO* (25 touches, animées par une simulation de l'arbre
  à cames). Le second est un aperçu fidèle même sans hub connecté.
- **Terminologie** : hub, arbre à cames, mode borne, mode partition, geek mode,
  télécommande, demandes, file, profil (portes ouvertes / salon), jeton de
  pilotage, code du stand.
- **L'écran ne s'éteint jamais** en fonctionnement (Screen Wake Lock).
- Les prénoms saisis par les visiteurs sont du texte public filtré (lettres,
  quatorze caractères) affiché sur grand écran ; le réglage se décoche.

## Brand Commitments

- **Charte Epitech**, désormais le thème par défaut de l'application : bleu
  `#013afb`, titres en **Anton**, texte en **IBM Plex Sans**, angles francs,
  grille « blueprint », underscore en ponctuation de titre, triptyque
  *Tech / Together / Tomorrow* pour les états. Le logo est fourni
  (`web/assets/brand/epitech-logo.png`).
- **Trois thèmes coexistent et doivent rester cohérents entre eux** : *Epitech*
  (défaut), *Piano* (bois sombre, laiton, ivoire) et *LEGO* (plaque à tenons,
  bandeau rouge/orange/jaune/vert/bleu, une couleur de brique par demi-ton).
- **Aucune marque LEGO n'est reproduite** — seulement la palette et la matière du
  plastique. Cette limite est délibérée et se maintient.
- **Voix** : française, précise, sans jargon commercial. Elle nomme les
  contraintes plutôt que de les masquer, et dit ce que le produit ne fait pas.
  Le README en est la référence.

## Evidence on Hand

- Une bibliothèque de 25 morceaux en quatre catégories, générés localement note
  à note, écrite dans `tracks/` au premier lancement.
- Le matériel réel : hub Powered Up 88009, moteur linéaire simple, capteur de
  distance WeDo 2.0 — leurs mesures (tension, courant, RSSI, latence GATT)
  alimentent le geek mode.
- `docs/guide.md`, lisible dans l'application, et un README de référence.
- `npm test` vérifie le protocole, le markdown, le code QR et la partition.
- **Pas de témoignages, pas de chiffres de fréquentation, pas de captures
  officielles Epitech** : rien de tel ne doit être inventé.

## Product Principles

1. **Le matériel est le sujet.** Tout ce que l'écran montre doit renvoyer au
   piano qui bouge à côté. L'interface qui prend la vedette a échoué.
2. **Mesuré, jamais simulé.** Aucun chiffre décoratif, aucune jauge qui bouge
   pour faire joli. Ce qui est déduit est annoncé comme déduit.
3. **Trente secondes suffisent.** Un visiteur qui n'a rien lu doit comprendre
   quoi faire. Aucune fonction essentielle ne dépend d'une explication.
4. **Ça doit tenir neuf heures.** Le stand parfois vide, le moteur qui chauffe,
   le curieux qui touche à tout : la robustesse prime sur l'élégance quand les
   deux s'opposent.
5. **Rien à installer, rien à télécharger.** Chaque ajout se paie en dépendances
   et en poids ; le budget est nul.

## Accessibility & Inclusion

- L'écran du stand doit rester lisible **à trois mètres en portes ouvertes, à
  dix mètres en salon** : c'est la contrainte de lisibilité dimensionnante.
- Environnement bruyant et debout : les cibles tactiles de la télécommande
  doivent tolérer un doigt pressé.
- Le pilotage Bluetooth est indisponible sur Safari et Firefox ; l'interface doit
  le dire clairement plutôt que de laisser un bouton mort.
- Les raccourcis d'une seule lettre se taisent quand le clavier jouable est
  actif ; la cartographie clavier suit `event.code` (AZERTY, QWERTY, QWERTZ).
