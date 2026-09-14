# Hébergement Google Cloud

Projet : `piano-508604`. Service : `piano`, région `europe-west1` (Belgique).

URL publique : https://piano-14453786320.europe-west1.run.app

## Déploiement automatique GitHub

Chaque push sur `main` du dépôt `AdrienRouxel/Piano-Lego-Jukebox` lance
`.github/workflows/deploy-google-cloud.yml` : tests, construction de l'image,
publication, mise à jour de Cloud Run et test de l'URL publique. Un commit local
doit être poussé (`git push origin main`) pour déclencher ce parcours.
Un lancement manuel est également disponible dans l'onglet Actions de GitHub.

L'authentification utilise Workload Identity Federation : aucune clé Google
privée n'est stockée dans GitHub. Le fournisseur est limité à l'identifiant du
dépôt, à son propriétaire, à `main` et à ce fichier de workflow. Le compte
`piano-deploy` peut mettre à jour le seul service `piano`, utiliser son compte
d'exécution et publier dans le seul dépôt d'images `piano`.

Le workflow conserve les variables, les limites de ressources et le montage du
bucket existants. Il n'accède pas directement au bucket : les morceaux ajoutés
en ligne restent conservés. Pour ajouter des fichiers de `tracks/` depuis le
dépôt, utiliser le déploiement manuel ci-dessous ou l'application.

## Ressources

- Cloud Run : 1 vCPU, 512 Mio, facturation à la requête, 0 instance minimale,
  1 instance maximale, concurrence 80 et délai maximal de requête d'une heure.
- Cloud Storage : bucket privé `piano-508604-tracks`, monté dans `/app/tracks`.
  Les morceaux ajoutés depuis l'application survivent aux redémarrages.
- Artifact Registry : dépôt Docker `piano` dans la même région.
- Compte `piano-runtime` : accès aux objets du seul bucket des morceaux.

Les flux d'événements du stand occupent plusieurs requêtes simultanées : une
fraction de CPU, qui impose une concurrence de 1 dans Cloud Run, ne convient
pas. La mémoire de 512 Mio permet l'environnement de seconde génération et le
montage du stockage. Aucune VM, aucun équilibreur externe ni base de données.

Quand aucun navigateur ne garde de connexion ouverte, le service peut revenir
à zéro instance. Une connexion du jukebox ou de la télécommande maintient une
requête active et entraîne de la facturation. Le stockage, le trafic et les
images peuvent aussi être facturés : ces réglages ne garantissent pas la gratuité.

## Déployer une nouvelle version

Importer les sources dans Cloud Shell, se placer à la racine puis exécuter :

```bash
bash scripts/deploy-google-cloud.sh
```

Docker construit l'image dans Cloud Shell. Aucun paquet npm ni étape de build
du frontend n'est nécessaire. Les modifications locales des morceaux sont
copiées seulement si le fichier n'existe pas déjà dans le bucket ; aucun morceau
distant n'est supprimé par le déploiement.

Le fichier privé `.env.piano-cloud.json` conserve `STAND_CODE`. Il est exclu de
Git et des images. En son absence, le script récupère le code du service
existant, ou en crée un pour le premier déploiement. Ne pas publier ce fichier.
Le code QR fournit l'adresse de la télécommande. La page principale du jukebox
est réservée aux administrateurs et pilote directement le stand.

## Limites

La file des demandes reste en mémoire : un redémarrage ou un déploiement la
réinitialise. Les morceaux et les jetons restent conservés. Déployer hors des
séances ; le maximum d'instances n'est pas une garantie de continuité d'état
pendant le remplacement d'une révision.

Le piano Bluetooth et la sortie audio restent sur l'ordinateur qui ouvre le
site HTTPS. Le conteneur léger ne comprend pas le moteur Python facultatif de
transcription. Le fonctionnement du moteur LEGO demande un essai physique.

Références : [limites CPU](https://docs.cloud.google.com/run/docs/configuring/services/cpu),
[volumes Cloud Storage](https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts),
[facturation Cloud Run](https://cloud.google.com/run/pricing).
