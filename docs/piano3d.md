# Atelier 3D du Grand Piano

Lancer le projet avec `npm start`, puis utiliser **Vue 3D**, à droite du header.
La vue est également accessible directement à `/piano3d.html`.

Sur l’accueil, le sélecteur **Touches / Piano 3D**, au-dessus du modèle LEGO,
remplace le clavier à 25 touches par le piano 3D assemblé. Le choix est mémorisé
dans ce navigateur. La partition reste visible au-dessus. La vue intégrée
permet de tourner, zoomer, recentrer et révéler la mécanique. Le bouton du
header conserve l’accès à l’atelier complet. Une seule scène est chargée à
la fois ; revenir aux touches libère les ressources 3D.

- Glisser pour tourner ; molette ou pincement pour zoomer.
- Le curseur écarte progressivement les sous-ensembles et les 25 touches.
- Cliquer une pièce la met en évidence et ouvre sa fiche. La liste permet aussi
  de choisir chaque composant au clavier, y compris les éléments cachés.
- Les raccourcis de découverte du moteur, du hub et de l’arbre rendent
  la carrosserie transparente si nécessaire, sans modifier l’écartement choisi.
- Les commandes de caméra recentrent, passent au-dessus, activent
  la rotation automatique, révèlent l’intérieur et règlent le zoom. Les flèches tournent la caméra lorsque le canevas
  a le focus ; `+` et `-` règlent le zoom.
- **Rejouer l’assemblage** relance l’animation. Le réglage système de réduction
  des animations est respecté.
- **Jukebox** ou `Échap` ferme la vue et rend le focus au bouton du header.
  La lecture du jukebox reste en place.

## Modélisation et sources

Reconstitution pédagogique procédurale de 43 éléments sélectionnables : les
25 touches individuelles, châssis, ceinture, table/cordes, support de clavier,
arbre à cames, marteaux, étouffoirs, couvercle, béquille, pupitre/rabat, moteur,
hub, capteur, pédale, trois pieds et banquette. Les sous-ensembles contiennent
des volumes, tenons, cordes, axes et leviers générés en JavaScript.

Les formes, rapports d’échelle et emplacements internes sont simplifiés.
Ce n’est ni un modèle CAO officiel ni une restitution brique par brique des
3 662 éléments du set. L’éclatement sert à comprendre les rôles, pas à suivre
une séquence de montage. Les touches sont nommées suivant une disposition
chromatique illustrative, sans promesse de notes détectées sur le matériel.

Les caractéristiques du set (nombre de pièces, clavier, parties mobiles,
dimensions fermé) proviennent de la [fiche officielle LEGO 21323](https://www.lego.com/en-us/product/grand-piano-21323),
consultée le 9 septembre 2026. Le détail électronique et la commande par arbre
à cames reprennent le [README du projet](../README.md), section matériel.

## Architecture et fonctionnement hors connexion

`web/js/piano3d-launcher.js` charge une iframe à la demande dans un dialogue
natif. La fermeture supprime l’iframe et libère les ressources WebGL. Les
messages de fermeture sont vérifiés par origine et fenêtre émettrice.

`web/js/piano3d-model.js` construit le modèle. `web/js/piano3d.js` gère scène,
éclairage studio, sélection par raycast, caméra orbitale, cadrage automatique,
animation et fiches. Les tenons répétitifs sont instanciés. Les géométries
simples sont partagées ; les matériaux de sélection restent indépendants.
Le rendu se suspend lorsque le document est masqué.

Three.js **0.180.0**, OrbitControls et RoomEnvironment sont inclus dans
`web/vendor/three/`, avec leur licence MIT. Aucune installation npm, compilation,
image, modèle, texture, police distante ou CDN n’est nécessaire. Les polices
Anton et IBM Plex Sans sont celles déjà fournies dans le projet. Le studio est
calculé localement ; aucune donnée n’est envoyée à un service externe.

La vue requiert WebGL 2. En cas d’échec du chargement ou de perte du contexte,
un message permet de réessayer ou de retourner au jukebox.

## Vérification

`npm test` inclut `scripts/test-piano3d.mjs` : nombre et types des touches,
bornes géométriques aux positions assemblée/intermédiaire/éclatée, sélection
effective du moteur par raycast et indépendance des matériaux de surbrillance.
La vérification visuelle couvre l’ouverture depuis le header, la caméra,
l’éclatement, les fiches et la fermeture, sur bureau et à 390 px de large.
La vue d’accueil a aussi été vérifiée à ces deux tailles : choix mémorisé après
rechargement, retour aux touches, animation active dès la lecture, arrêt à la
pause et passage à l’atelier sans conserver une deuxième scène WebGL.

## Mécanique pendant la lecture

Les touches sont animées par défaut pendant la lecture, dans la vue intégrée
comme dans l’atelier. Le bouton **Arrêter l’animation** de l’atelier permet de
suspendre ce mouvement, puis **Animer le piano** le réactive pendant la lecture.
Ce choix agit uniquement sur la visualisation : il ne démarre pas un autre
lecteur, ne commande pas le hub et ne modifie pas les réglages du moteur.

La vue reçoit à 25 Hz l’état courant du jukebox, avec un envoi immédiat lors
d’une pause, d’une reprise, d’un changement de morceau ou d’un arrêt moteur.
Avec un hub connecté, la puissance provient de `hub.currentPower`, mise à jour
après l’écriture Bluetooth. Sans hub, l’interface annonce explicitement un
aperçu fondé sur la consigne calculée. La direction, les silences et le freinage
sont conservés. La phase et la levée des touches sont communes aux vues 2D et
3D via `music/camshaft.js` ; la vue 3D interpole entre les états reçus, puis
s’arrête si la liaison cesse de publier pendant 300 ms.

Le moteur du 21323 n’a pas d’encodeur. Sa vitesse réelle, l’angle absolu de
l’arbre et les positions exactes des touches physiques ne sont donc pas
mesurés. Le calage des cames et la transmission restent une représentation
pédagogique ; aucune synchronisation physique touche par touche n’est promise.
Les touches virtuelles suivent les cames, pas directement les hauteurs MIDI.

Le zoom rapproché, le déplacement par clic droit (ou deux doigts), le recentrage
sur un composant et la carrosserie transparente restent utilisables pendant
l’animation, même à 0 % d’éclatement. Désactiver l’animation ne coupe pas la
musique ni le piano physique.

## Fidélité et régression du moteur

La [notice officielle LEGO 21323](https://www.lego.com/cdn/product-assets/product.bi.core.pdf/6590095.pdf),
pages 81–85 (moteur central et hub voisin) et 510 (couvercle et renforts), a été
consultée pour cette révision. Le moteur, ses axes, le hub et leurs câbles sont
replacés dans la caisse, au-dessus du châssis et sous la table. Le couvercle
s’arrête derrière le clavier ; les renforts suivent son contour. Le rapport
largeur/hauteur du couvercle fermé a été corrigé d’après les dimensions du set.
La notice n’est pas embarquée ; la vue reste intégralement locale.

Les tests vérifient l’inclusion des trois éléments électroniques dans le
contour courbe à 0 %, les pivots de touches/marteaux, le sens de rotation,
l’arrêt sur pause et perte de liaison, ainsi que l’abonnement/désabonnement au
flux. Le fonctionnement a été essayé avec une lecture réelle du jukebox sans
hub connecté ; la concordance avec un piano physique n’a pas été mesurée.

## Montage accéléré

Le bouton **Montage accéléré**, à côté de Réassembler, ouvre une lecture en
16 séquences. Les pages ont été vérifiées dans la [notice officielle 21323,
révision 6590095](https://www.lego.com/cdn/product-assets/product.bi.core.pdf/6590095.pdf).
Les séquences suivent ses grandes phases (pages 18 à 543) : châssis,
transmission, électronique, étouffoirs, table, caisse, cordes, pieds, pédale,
clavier, pupitre, ceinture extérieure, couvercle, banquette.

Chaque séquence affiche son titre, son explication et un lien vers les pages
correspondantes. Les formes procédurales arrivent progressivement ; elles
peuvent représenter plusieurs briques. Leur ordre interne est illustratif.
Il ne s’agit donc pas d’une reproduction des étapes numérotées de la notice,
ni d’un modèle complet des 3 662 pièces. Cette limite figure dans l’interface.
Le PDF n’est pas distribué et n’est chargé que si le visiteur ouvre son lien.
Le montage 3D lui-même ne nécessite aucune ressource distante.

Lecture/pause, précédent/suivant, curseur et menu de séquences sont accessibles
au clavier. Une navigation manuelle affiche la séquence achevée et met en pause.
La vitesse (0,25× à 8×) change sans remise à zéro ; à 1×, le parcours dure
96 secondes. La fin propose de rejouer. Avec réduction des animations, le mode
s’ouvre en pause et les formes apparaissent sans déplacement vertical.
Le temps ne s’écoule pas lorsque le document est masqué.

Tourner, zoomer et sélectionner restent disponibles ; cliquer sur une forme
met le montage en pause pour lire sa fiche. Les formes futures sont exclues du
picking. Quitter restaure l’écartement, la sélection, la transparence et le choix
d’animation musicale. La lecture audio et les commandes du hub continuent ;
seule l’animation mécanique de la vue 3D est suspendue pendant la construction.

`piano3d-assembly.js` porte les séquences, l’horloge indépendante du rendu et
la répartition des meshes. Les tests vérifient couverture unique de toutes les
formes, séquences non vides, pause, changement de vitesse, retour arrière,
fin complète, rejeu et indépendance de la fréquence du rendu.
