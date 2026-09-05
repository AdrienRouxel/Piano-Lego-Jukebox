# Guide — connecter le piano et se servir du jukebox

Ce guide part de zéro : le piano sur son étagère, l'ordinateur éteint. Il décrit
chaque geste, **sur le modèle** et **sur l'ordinateur**, et surtout ce que tu
dois voir à chaque étape pour savoir que ça se passe bien.

Compte dix minutes la première fois, trente secondes les suivantes.

---

## La check-list

| | |
|---|---|
| 🎹 | Le LEGO Ideas Grand Piano 21323 monté, avec son hub, son moteur et son capteur branchés |
| 🔋 | **6 piles AAA** neuves (le moteur consomme : des piles fatiguées font caler l'arbre à cames) |
| 💻 | Un Mac ou un PC avec **Chrome**, **Edge**, **Brave** ou **Arc** — ni Safari ni Firefox, qui n'ont pas le Web Bluetooth |
| 📦 | **Node.js 18 ou plus** (`node --version` dans un terminal) |
| 📶 | Bluetooth allumé sur l'ordinateur |

---

## Étape 1 · Préparer le piano

**Sur le modèle.**

1. **Retire le clavier.** Il est amovible : soulève-le doucement vers toi. Le hub
   Powered Up apparaît, à l'intérieur de la caisse.

2. **Vérifie les deux fiches.** Le hub a deux prises, marquées **A** et **B** :
   - l'une reçoit le câble du **moteur**, celui qui entraîne l'axe des cames
     derrière les touches ;
   - l'autre reçoit le câble du **capteur** de distance.

   Peu importe laquelle : le jukebox découvre tout seul qui est branché où.
   Enfonce chaque fiche à fond — c'est la panne numéro un.

3. **Mets les 6 piles AAA** dans le hub, en respectant les polarités.

4. **Appuie brièvement sur le bouton vert** du hub.

   👉 **Ce que tu dois voir : le bouton clignote en blanc.** Le hub est allumé et
   annonce sa présence. C'est le seul moment où l'ordinateur peut le trouver.

5. Tu peux **remettre le clavier** en place : le bouton reste accessible, et la
   liaison ne dépend pas de la position du clavier.

> ⏱️ **Le hub ne clignote pas éternellement.** Au bout de quelques minutes sans
> connexion, il s'éteint pour économiser les piles. Si tu as traîné, rappuie
> simplement sur le bouton vert avant de reprendre.

---

## Étape 2 · Préparer l'ordinateur

**Une seule fois, à la première utilisation.**

1. **Installe Node.js** s'il n'est pas là : <https://nodejs.org> (version LTS).
   Vérifie dans un terminal :

   ```bash
   node --version
   ```

2. **Autorise Chrome à utiliser le Bluetooth** — sur macOS uniquement, et
   seulement la première fois. Deux façons :
   - laisse macOS te le demander tout seul au premier essai de connexion, et
     clique sur **Autoriser** ;
   - ou va le régler à l'avance : **Réglages Système → Confidentialité et
     sécurité → Bluetooth**, puis active le curseur en face de **Google Chrome**.

3. **N'appaire pas le piano dans les réglages Bluetooth du système.** Le hub
   utilise le Bluetooth basse consommation : c'est le navigateur qui s'y connecte
   directement, sans passer par l'appairage du système. Si tu le vois traîner
   dans la liste des appareils appairés de macOS, supprime-le.

4. **Ferme l'application LEGO Powered Up**, sur le téléphone comme sur
   l'ordinateur. Le hub n'accepte **qu'un seul maître à la fois** : tant que
   l'application officielle est connectée, le jukebox ne le trouvera pas.

---

## Étape 3 · Lancer le jukebox

**Sur l'ordinateur, dans un terminal.**

```bash
cd ~/Code/piano
npm start
```

👉 **Ce que tu dois voir :**

```
  🎹  Jukebox LEGO Grand Piano
  ────────────────────────────────────────────
  Ouvre  http://localhost:4173  dans Chrome ou Edge.
```

Ouvre **<http://localhost:4173>** dans Chrome.

> ⚠️ **Utilise bien `localhost`.** Le Web Bluetooth n'existe que dans un
> « contexte sécurisé » : `https://` ou `localhost`. Un fichier ouvert en
> `file://`, ou l'adresse IP de la machine (`192.168.…`), ne marchera pas — le
> bouton de connexion restera inactif.

Au tout premier lancement, quatre morceaux de démonstration sont créés dans
`tracks/`. La bibliothèque n'est donc jamais vide.

---

## Étape 4 · Connecter le piano

C'est l'étape qui compte. Suis-la dans l'ordre.

### 4.1 — Sur le piano

**Appuie brièvement sur le bouton vert.** Le bouton doit **clignoter en blanc**.
S'il ne clignote pas, le hub est éteint : rappuie. S'il est allumé fixe, il est
déjà connecté à autre chose — coupe l'autre application.

### 4.2 — Sur l'ordinateur

**Clique sur « Connecter le piano »**, en haut à droite de la page.

### 4.3 — Dans la fenêtre de Chrome

Une fenêtre système s'ouvre, intitulée quelque chose comme
*« localhost:4173 souhaite se connecter »*, avec la liste des appareils
Bluetooth trouvés.

👉 **Ce que tu dois voir : une seule ligne apparaît**, portant un nom du genre
`Grand Piano`, `HUB NO.4`, `Smart Hub` ou `LEGO Hub`. Le nom exact dépend du
micrologiciel et de ce que l'application LEGO a pu y écrire.

**Comment être sûr que c'est le bon** : le jukebox ne montre que les appareils
qui annoncent le service LEGO. S'il y a plusieurs lignes, éteins le piano (appui
long sur le bouton vert) : celle qui disparaît est la bonne. Rallume-le et
recommence.

**Sélectionne la ligne, puis clique sur « Associer ».**

### 4.4 — Vérifier que tout est en place

Trois signes, dans cet ordre :

| Où | Ce que tu dois voir |
|---|---|
| **Sur le piano** | Le bouton **arrête de clignoter** et s'allume en **bleu foncé fixe**. C'est le jukebox qui lui a donné cette couleur : c'est la preuve que la liaison fonctionne dans les deux sens. |
| **En haut de la page** | La pastille passe au **vert**, affiche le nom du hub, puis le **pourcentage de batterie** apparaît à côté. |
| **Dans le journal** | ⚙︎ → **Journal**, tout en bas du tiroir : trois lignes vertes, `Hub connecté.`, `Moteur détecté sur le Port A (Moteur simple).`, `Capteur détecté sur le Port B (Capteur de distance WeDo 2.0).` |

Si la ligne « Moteur détecté » manque, **la fiche du moteur est mal enfoncée** :
retire le clavier et réenfonce-la, le hub le signalera tout seul.

> 💡 **Les fois suivantes**, si Chrome a gardé l'autorisation, la liaison se
> rétablit **toute seule** au chargement de la page — il suffit d'avoir appuyé
> sur le bouton vert. Tu peux désactiver ce comportement dans ⚙︎ → **Le hub**.

---

## Étape 5 · Le premier réglage

**À faire une fois, ça change tout.** Le moteur doit vaincre la charge de l'arbre
à cames : en dessous d'un certain seuil il bourdonne sans rien faire, et il
chauffe. Ce seuil dépend de ton montage et de tes piles.

1. Ouvre ⚙︎ (en haut à droite) → **Essai du moteur**.
2. **Pousse lentement le curseur « Puissance d'essai »** depuis 0.
3. Regarde les touches du piano. Note la valeur à laquelle **elles se mettent
   franchement en mouvement** — pas le premier frémissement, le moment où la
   vague est nette. Chez la plupart des montages c'est entre **35 et 45**.
4. Clique sur **Roue libre** pour arrêter.
5. Remonte à **Mouvement des touches** et reporte cette valeur dans
   **Puissance minimale**.
6. Clique sur **Séquence d'essai** : le piano enchaîne démarrage doux, palier
   lent, silence, palier rapide, arrêt. Si tout est fluide et que le silence est
   vraiment silencieux, c'est réglé.

Ensuite, joue le morceau **« Démo — Gammes et arpèges »** : il est écrit pour
ça. Il alterne notes isolées, silence franc, gamme, arpèges denses et accord
tenu — de quoi juger d'une seule écoute si les réglages tiennent.

**Si les touches semblent en retard sur la musique**, augmente **Avance** (⚙︎ →
Mouvement des touches). 140 ms convient à la plupart des machines ; une liaison
Bluetooth encombrée peut demander 250 ms ou plus.

---

## Étape 6 · Écouter de la musique

**Clique sur un morceau** dans la bibliothèque, à droite. C'est tout : il se
charge et démarre.

Au premier morceau, le navigateur télécharge les échantillons de piano (environ
2 Mo, une seule fois). Le titre affiche brièvement *« Chargement du piano… »*.

Pendant la lecture :

- le **son sort des haut-parleurs de l'ordinateur** — c'est lui qui joue, comme
  avec l'application officielle ;
- le **piano fait onduler ses touches** au rythme de la musique ;
- la **LED du hub pulse** avec l'intensité du morceau.

---

## L'écran, élément par élément

### En haut

- **La pastille d'état** — gris : déconnecté ; orange clignotant : connexion ou
  reconnexion en cours ; vert : connecté, avec le nom du hub et la batterie.
- **« Connecter le piano »** — ouvre le sélecteur Bluetooth.
- **⚙︎** — ouvre le tiroir de réglages.

### La scène

- **La pochette et le titre** — la pochette vient d'une image déposée à côté du
  fichier, ou d'une couleur tirée du titre.
- **Les pastilles** sous le titre disent d'où vient le son : *MIDI synthétisé*,
  *Audio + partition MIDI* ou *Audio seul*, puis le nombre de notes, le tempo et
  la mesure.
- **Clavier « Partition »** — les 88 touches d'un vrai piano. S'allument les
  notes réellement jouées par le fichier.
- **Clavier « Modèle LEGO »** — les 25 touches du 21323, animées par une
  simulation de l'arbre à cames. C'est un aperçu fidèle de ce que fait le modèle
  à cet instant, **même sans hub connecté** : pratique pour régler avant de
  brancher quoi que ce soit. La barre en dessous montre la puissance envoyée.
- **Le transport** — précédent / lecture / suivant, la barre de position (on
  peut cliquer dedans pour se déplacer) et le volume.

### La bibliothèque

La liste des morceaux, avec un champ pour filtrer et un bouton **Actualiser**
qui relit le dossier `tracks/`. Les étiquettes **MIDI** et **Audio** disent quels
fichiers existent pour chaque morceau.

### Raccourcis clavier

| Touche | Effet |
|---|---|
| `Espace` | Lecture / pause |
| `⇧ →` | Morceau suivant |
| `⇧ ←` | Morceau précédent |
| `G` | Ouvre ou ferme le Geek mode |
| `Échap` | Ferme le tiroir de réglages (ou annule la mise en route) |

---

## Ajouter tes propres morceaux

Dépose tes fichiers dans le dossier **`tracks/`**, puis clique sur
**Actualiser** dans la page. Rien à déclarer nulle part.

**Préfère le MIDI.** Un `.mid` est une partition : le jukebox sait exactement
quelle note tombe à quelle milliseconde, et cale le moteur au temps près. Un MP3
n'est qu'une onde : il faut deviner.

| Ce que tu déposes | Son | Mouvement des touches |
|---|---|---|
| `Titre.mid` | synthétisé, échantillons de vrai piano | calé sur la partition |
| `Titre.mid` + `Titre.mp3` | ton enregistrement | calé sur la partition |
| `Titre.mp3` seul | ton enregistrement | déduit du niveau sonore, moins précis |

Nomme les fichiers `Interprète - Titre` ; une image du même nom sert de pochette :

```
tracks/
├── Frédéric Chopin - Nocturne op.9 no.2.mid
├── Frédéric Chopin - Nocturne op.9 no.2.jpg
└── Scott Joplin - The Entertainer.mid
```

Où trouver des MIDI : [Mutopia](https://www.mutopiaproject.org/),
[Piano-MIDI.de](http://www.piano-midi.de/), ou l'export MIDI de
[MuseScore](https://musescore.org).

---

## Le tiroir de réglages, section par section

| Section | À quoi ça sert |
|---|---|
| **Apparence** | Bascule entre l'habillage *Piano* et l'habillage *Epitech*. |
| **Mouvement des touches** | Les réglages de la chorégraphie : puissances, avance, accents, sensibilité, freinage, démarrage progressif, sens de rotation. C'est là qu'on passe du temps. |
| **Mise en route** | Facultatif : un chef d'orchestre demande au piano s'il est prêt avant chaque morceau. Un clic passe l'introduction. |
| **Démonstration** | Le *Geek mode* : un bandeau de télémétrie en bas de l'écran. Tout y est mesuré en direct. |
| **Essai du moteur** | Le curseur de calibration, plus freinage, rampe et séquence d'essai. Lancer un essai met la lecture en pause. |
| **Le hub** | Les informations de la brique, le renommage, la reconnexion automatique, l'extinction à distance, et les quatre pastilles d'alerte matérielle. |
| **Capteur de touche** | Le mode de lecture (distance ou comptage des passages) et la valeur en direct. |
| **Alimentation** | Tension et courant mesurés à l'intérieur du hub. |
| **Console LWP3** | Toutes les trames Bluetooth, décodées en clair. Pour comprendre ou déboguer. |
| **Journal** | L'historique des événements de connexion. **Le premier endroit à regarder quand quelque chose cloche.** |

Le détail de chaque réglage est dans le [README](../README.md#régler-le-mouvement-des-touches).

---

## Éteindre proprement

1. **Arrête la lecture** (`Espace`). Le moteur s'arrête et freine.
2. **Éteins le hub** — au choix :
   - ⚙︎ → **Le hub** → **Éteindre le hub** ;
   - ou **appui long sur le bouton vert** du piano, jusqu'à extinction.
3. Ferme l'onglet, puis `Ctrl-C` dans le terminal pour arrêter le serveur.

> 🛟 **L'arrêt d'urgence, dans tous les cas : appui long sur le bouton vert.**
> La page envoie une consigne d'arrêt en se fermant, mais si tu fermes l'onglet
> brutalement pendant que le moteur tourne, le hub peut garder sa dernière
> consigne. Le bouton vert reprend toujours la main.

---

## Ça ne marche pas

| Symptôme | Cause la plus probable | Quoi faire |
|---|---|---|
| Le bouton « Connecter » est grisé | Navigateur sans Web Bluetooth | Ouvre la page dans Chrome, Edge, Brave ou Arc |
| La fenêtre Chrome ne montre aucun appareil | Le hub ne clignote pas | Appuie sur le bouton vert, puis relance la recherche dans les 2 minutes |
| Toujours aucun appareil | L'application LEGO est connectée | Ferme-la complètement, y compris sur le téléphone |
| Toujours aucun appareil | Bluetooth refusé à Chrome | Réglages Système → Confidentialité et sécurité → Bluetooth → active Chrome |
| Toujours aucun appareil | Page ouverte en `file://` ou par l'IP | Utilise `http://localhost:4173` |
| Connecté, mais aucune ligne « Moteur détecté » | Fiche mal enfoncée | Retire le clavier, réenfonce le câble du moteur |
| Connecté, les touches ne bougent pas | Puissance minimale trop basse | Monte-la à 45 dans ⚙︎ → Mouvement des touches, ou refais l'étape 5 |
| Connecté, les touches ne bougent pas | Pilotage désactivé | ⚙︎ → Mouvement des touches → coche « Piloter le moteur du piano » |
| Le moteur bourdonne sans tourner | Piles fatiguées, ou puissance trop basse | Change les piles ; regarde la tension dans ⚙︎ → Alimentation |
| Les touches sont en retard sur la musique | Latence Bluetooth | Augmente **Avance** jusqu'à 250 ms |
| Le mouvement hoquette entre les notes | Sensibilité trop basse | Monte **Sensibilité**, ou baisse **Accent** |
| La liaison tombe régulièrement | Distance, obstacles, ou piles faibles | Rapproche l'ordinateur ; la pastille *Tension basse* de ⚙︎ → Le hub te le dira |
| Pas de son | Contexte audio pas encore démarré | Clique sur un morceau (les navigateurs exigent un clic avant tout son) |
| Le dossier `tracks/` a changé, pas la liste | Rien de grave | Clique sur **Actualiser** |

**Dans tous les cas, ouvre ⚙︎ → Journal.** Chaque étape de la connexion y laisse
une ligne, et les erreurs y sont écrites en clair.

---

## Annexe · le bouton et le voyant du hub

| Voyant | Signification |
|---|---|
| Éteint | Hub hors tension, ou piles vides |
| **Clignote en blanc** | Allumé, en attente de connexion — c'est là qu'il faut chercher depuis le navigateur |
| **Bleu foncé fixe** | Connecté au jukebox, au repos |
| **Pulse en orange** | Connecté, un morceau est en cours (la LED suit l'intensité) |
| Autre couleur fixe | Connecté à une autre application |

| Geste sur le bouton vert | Effet |
|---|---|
| **Appui bref** | Allume le hub et le rend visible |
| **Appui long** | Éteint le hub — l'arrêt d'urgence |

---

*Le détail technique — mécanique du modèle, protocole Bluetooth, chorégraphie —
est dans le [README](../README.md). Pour remplacer le micrologiciel du hub, voir
[`firmware.md`](firmware.md).*
