#!/usr/bin/env bash
# À lancer depuis la racine du projet dans Google Cloud Shell.
set -euo pipefail

PIANO_PROJECT=piano-508604
PIANO_REGION=europe-west1
PIANO_SERVICE=piano
PIANO_BUCKET="${PIANO_PROJECT}-tracks"
PIANO_ACCOUNT="piano-runtime@${PIANO_PROJECT}.iam.gserviceaccount.com"
PIANO_IMAGE="${PIANO_REGION}-docker.pkg.dev/${PIANO_PROJECT}/piano/jukebox:$(date -u +%Y%m%d-%H%M%S)"

gcloud services enable run.googleapis.com artifactregistry.googleapis.com iam.googleapis.com storage.googleapis.com --project="$PIANO_PROJECT" --quiet

if ! gcloud iam service-accounts describe "$PIANO_ACCOUNT" --project="$PIANO_PROJECT" >/dev/null 2>&1; then
  gcloud iam service-accounts create piano-runtime --display-name='Serveur du piano' --project="$PIANO_PROJECT"
fi
if ! gcloud storage buckets describe "gs://$PIANO_BUCKET" --project="$PIANO_PROJECT" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://$PIANO_BUCKET" --project="$PIANO_PROJECT" --location="$PIANO_REGION" --uniform-bucket-level-access --public-access-prevention
fi
gcloud storage buckets add-iam-policy-binding "gs://$PIANO_BUCKET" --member="serviceAccount:$PIANO_ACCOUNT" --role=roles/storage.objectUser --quiet >/dev/null
# Les morceaux ajoutés sur le serveur ne sont jamais supprimés ou remplacés.
gcloud storage rsync tracks "gs://$PIANO_BUCKET" --recursive --no-clobber --quiet

if ! gcloud artifacts repositories describe piano --location="$PIANO_REGION" --project="$PIANO_PROJECT" >/dev/null 2>&1; then
  gcloud artifacts repositories create piano --repository-format=docker --location="$PIANO_REGION" --project="$PIANO_PROJECT"
fi
gcloud auth configure-docker "${PIANO_REGION}-docker.pkg.dev" --quiet
docker build -t "$PIANO_IMAGE" .
docker push "$PIANO_IMAGE"

# Fichier privé, exclu de l'image et de tout envoi des sources.
# Réutiliser le même code du stand lors des déploiements suivants.
if [[ ! -f .env.piano-cloud.json ]]; then
  if gcloud run services describe "$PIANO_SERVICE" --region="$PIANO_REGION" --project="$PIANO_PROJECT" --format=json > /tmp/piano-existing-service.json 2>/dev/null; then
    python3 - <<'PY'
import json, os
s = json.load(open('/tmp/piano-existing-service.json'))
env = {e['name']: e['value'] for e in s['spec']['template']['spec']['containers'][0].get('env', []) if 'value' in e}
assert env.get('STAND_CODE'), 'Code du stand existant introuvable : arrêt pour éviter son remplacement.'
with open('.env.piano-cloud.json', 'x') as f:
    os.chmod(f.name, 0o600)
    json.dump({'STAND_CODE': env['STAND_CODE']}, f)
PY
  else
    python3 - <<'PY'
import json, secrets, os
with open('.env.piano-cloud.json', 'x') as f:
    os.chmod(f.name, 0o600)
    json.dump({'STAND_CODE': secrets.token_hex(4).upper()}, f)
PY
  fi
fi

# Les anciennes versions conservaient aussi STAND_OPERATOR. Le serveur n'en a
# plus besoin : ne garder que le code visiteur dans le fichier transmis.
python3 - <<'PY'
import json, os
with open('.env.piano-cloud.json') as f:
    env = json.load(f)
assert env.get('STAND_CODE'), 'Code du stand introuvable.'
with open('.env.piano-cloud.json', 'w') as f:
    os.chmod(f.name, 0o600)
    json.dump({'STAND_CODE': env['STAND_CODE']}, f)
PY

gcloud run deploy "$PIANO_SERVICE" --project="$PIANO_PROJECT" --region="$PIANO_REGION" \
  --image="$PIANO_IMAGE" --service-account="$PIANO_ACCOUNT" \
  --execution-environment=gen2 --cpu=1 --memory=512Mi \
  --min=0 --max=1 --min-instances=0 --max-instances=1 \
  --concurrency=80 --timeout=3600 --cpu-throttling --no-cpu-boost \
  --port=8080 --env-vars-file=.env.piano-cloud.json \
  --add-volume="name=tracks,type=cloud-storage,bucket=$PIANO_BUCKET,mount-options=uid=1000;gid=1000" \
  --add-volume-mount=volume=tracks,mount-path=/app/tracks \
  --allow-unauthenticated --quiet

gcloud run services describe "$PIANO_SERVICE" --project="$PIANO_PROJECT" --region="$PIANO_REGION" --format='value(status.url)'
