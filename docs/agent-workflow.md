# Travailler avec un agent

Adaptation de l’article OpenAI [Rethinking skills and prompts for GPT-6 Astra](https://developers.openai.com/blog/rethinking-skills-and-prompts-for-gpt-6-astra), réalisée le 12 septembre 2026.

## Demander une modification

Décrire le résultat attendu, les contraintes propres à la demande et les critères de fin. Laisser à l’agent le choix de la méthode.

Exemple à adapter :

> Corrige la perte de sélection du morceau après actualisation de la bibliothèque. Si le fichier existe encore, il doit rester sélectionné ; sinon, la sélection doit être effacée proprement. Préserve la file des visiteurs. Termine l’implémentation, vérifie ces deux parcours dans le navigateur et corrige les régressions introduites. Indique ce qui a été vérifié.

## Entretenir les consignes

Garder `AGENTS.md` court, avec des références conditionnelles. Retirer les règles obsolètes ou redondantes. Réserver les skills aux workflows spécialisés récurrents : description brève au déclenchement précis, puis références chargées selon le besoin. Éviter les recettes rigides et les obligations propres à un seul modèle.

## Résultat de l’audit

Le dépôt ne contenait ni `AGENTS.md`, ni skill local, ni prompt applicatif ou configuration de modèle à migrer. Le fichier ajouté rassemble les contraintes vérifiées du projet et les commandes existantes. Aucun skill supplémentaire n’est nécessaire actuellement.

Les skills personnels et ceux des plugins sont extérieurs au dépôt ; cet audit ne les modifie pas.
