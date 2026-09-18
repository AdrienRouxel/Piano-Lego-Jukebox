# LEGO Piano Jukebox

## Contraintes du projet

- Serveur Node.js ≥ 18 sans dépendance npm ; frontend en modules ES natifs, sans build. Les bibliothèques embarquées sont dans `web/vendor/`.
- Le son vient de l’ordinateur. Le piano LEGO 21323 possède un arbre à cames commun, pas de touches pilotables individuellement. Distinguer mesures matérielles, notes MIDI et estimations mécaniques dans les affichages.
- Conserver le fonctionnement local et les ressources embarquées. Le pilotage Web Bluetooth nécessite localhost ou HTTPS ; l’accès des visiteurs au stand est un usage distinct.
- L’interface et la documentation utilisateur sont en français.

## Références selon la tâche

- `PRODUCT.md` : usages, périmètre et contraintes produit.
- `DESIGN.md` : identité visuelle, composants et thèmes lors de changements d’interface.
- `README.md` : fonctionnement, musique, transcription et réglages ; `docs/guide.md` : parcours utilisateur.
- `docs/piano3d.md` : vue 3D ; `docs/firmware.md` : micrologiciel.
- `package.json` : commandes disponibles. `npm start` lance le serveur local ; `npm run stand` active l’accès réseau local.

## Réalisation et validation

Une tâche est terminée lorsque le comportement demandé fonctionne et que les problèmes introduits sont corrigés. Adapter les vérifications à la modification ; pour une interaction visuelle, vérifier aussi le résultat dans le navigateur quand il est disponible. Signaler les vérifications qui nécessitent le piano physique et restent à faire.

`npm test` exécute les tests locaux du protocole, du Markdown, du QR code, de la partition, du modèle 3D, des demandes et du stand (serveur lancé sur un port libre), sans connexion au hub. Ils peuvent être exécutés, corrigés et relancés sans confirmation intermédiaire. Chaque fichier `scripts/test-*.mjs` peut aussi être lancé séparément avec Node.

Une validation logicielle ne prouve pas le fonctionnement du moteur physique. Utiliser le matériel ou changer son micrologiciel lorsque la demande couvre cette opération.
