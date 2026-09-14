FROM node:22-bookworm-slim

ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 \
    PYTHONDONTWRITEBYTECODE=1 PIP_NO_CACHE_DIR=1
WORKDIR /app

COPY --chown=node:node package.json server.mjs README.md ./
COPY --chown=node:node scripts/ ./scripts/

# Cloud Run transcrit lui-même les demandes des visiteurs. Basic Pitch déclare
# TensorFlow comme dépendance sous Python 3.11, même lorsqu'on choisit ONNX ; on
# installe donc ses dépendances explicitement, puis le paquet sans TensorFlow.
# Cela garde une image et une empreinte mémoire raisonnables pour un seul CPU.
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 python3-venv ffmpeg libsndfile1 \
    && python3 -m venv /app/.venv-transcriber \
    && /app/.venv-transcriber/bin/pip install --upgrade pip \
    && /app/.venv-transcriber/bin/pip install \
      numpy==1.26.4 scipy==1.12.0 scikit-learn==1.5.1 \
      librosa==0.11.0 mir_eval==0.8.2 pretty_midi==0.2.11.post0 \
      resampy==0.4.2 onnxruntime==1.19.2 typing_extensions==4.16.0 \
    && /app/.venv-transcriber/bin/pip install --no-deps basic-pitch==0.4.0 \
    && /app/.venv-transcriber/bin/python scripts/transcribe.py --describe \
    && rm -rf /var/lib/apt/lists/*

COPY --chown=node:node docs/ ./docs/
COPY --chown=node:node web/ ./web/
COPY --chown=node:node tracks/ ./tracks/

# Le serveur initialise la bibliothèque et conserve sa session sur disque.
RUN chown node:node /app
USER node
EXPOSE 8080
CMD ["node", "server.mjs"]
