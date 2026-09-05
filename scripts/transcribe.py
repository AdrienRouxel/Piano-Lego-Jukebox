#!/usr/bin/env python3
"""Transcrit un extrait audio en notes, et les rend en JSON sur la sortie standard.

Appelé par le serveur du jukebox quand le moteur Python est installé ; sinon
c'est le navigateur qui s'en charge, avec le même réseau mais en plus lent.

    python3 transcribe.py <fichier> [--start SECONDES] [--end SECONDES]

Le moteur de calcul n'est pas choisi d'avance : il dépend de la machine. Sur un
Mac à puce Apple, CoreML passe par le Neural Engine ; ailleurs — Windows, Linux,
Mac Intel — ONNX Runtime fait le travail sur le processeur. Le premier disponible
dans l'ordre de préférence est retenu.
"""

import argparse
import contextlib
import importlib.util
import io
import json
import os
import platform
import sys
import tempfile
import warnings

warnings.filterwarnings("ignore")

# (nom du modèle chez basic-pitch, module Python qui doit être installé)
BACKENDS = (
    ("coreml", "coremltools"),
    ("onnx", "onnxruntime"),
    ("tflite", "tflite_runtime"),
    ("tf", "tensorflow"),
)


def available(module):
    try:
        return importlib.util.find_spec(module) is not None
    except (ImportError, ValueError):
        return False


def preference():
    """L'ordre dans lequel essayer les moteurs, selon la machine.

    CoreML n'existe que sur macOS, et n'accélère vraiment que sur puce Apple :
    le proposer ailleurs n'aurait aucun sens. Partout ailleurs ONNX Runtime est
    le choix portable — il s'installe sur Windows, Linux et Mac Intel.
    """
    apple_silicon = platform.system() == "Darwin" and platform.machine() == "arm64"
    order = [name for name, _ in BACKENDS]
    if not apple_silicon:
        order.remove("coreml")
    return order


def pick_backend(forced=None):
    modules = dict(BACKENDS)
    if forced:
        if not available(modules.get(forced, "")):
            raise SystemExit(f"Moteur « {forced} » demandé mais son runtime n'est pas installé.")
        return forced
    for name in preference():
        if available(modules[name]):
            return name
    raise SystemExit(
        "Aucun moteur de transcription installé. Lance « npm run setup-transcriber »."
    )


def describe():
    """Ce que la machine sait faire — sert au serveur pour décider."""
    modules = dict(BACKENDS)
    return {
        "system": platform.system(),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "preference": preference(),
        "installed": [name for name in preference() if available(modules[name])],
    }


def transcribe(path, start, end, backend):
    # Les imports sont tardifs : « --describe » doit répondre même sans basic-pitch.
    import librosa
    import soundfile
    from basic_pitch import FilenameSuffix, build_icassp_2022_model_path
    from basic_pitch.inference import Model, predict

    duration = None if end is None else max(0.0, end - (start or 0.0))
    audio, rate = librosa.load(path, sr=22050, mono=True, offset=start or 0.0, duration=duration)
    if audio.size < rate // 2:
        raise SystemExit("L'extrait est trop court (moins d'une demi-seconde).")

    # basic-pitch prend un chemin de fichier : on lui écrit l'extrait au propre.
    handle, excerpt = tempfile.mkstemp(suffix=".wav")
    os.close(handle)
    try:
        soundfile.write(excerpt, audio, rate)
        model = Model(build_icassp_2022_model_path(FilenameSuffix[backend]))
        # `predict` bavarde sur la sortie standard, que l'on réserve au JSON.
        with contextlib.redirect_stdout(io.StringIO()):
            _, _, notes = predict(excerpt, model)
    finally:
        os.unlink(excerpt)

    # (début, fin, hauteur MIDI, amplitude, pitch bends) → le format du jukebox.
    return [
        {
            "midi": int(pitch),
            "start": round(float(note_start), 4),
            "duration": round(float(note_end) - float(note_start), 4),
            "amplitude": round(float(amplitude), 4),
        }
        for note_start, note_end, pitch, amplitude, *_ in notes
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audio", nargs="?", help="fichier audio à transcrire")
    parser.add_argument("--start", type=float, default=0.0, help="début de l'extrait, en secondes")
    parser.add_argument("--end", type=float, default=None, help="fin de l'extrait, en secondes")
    parser.add_argument("--backend", default=None, help="forcer un moteur (coreml, onnx, tflite, tf)")
    parser.add_argument("--describe", action="store_true", help="décrire la machine et sortir")
    args = parser.parse_args()

    if args.describe:
        json.dump(describe(), sys.stdout)
        return

    if not args.audio:
        parser.error("il faut un fichier audio (ou --describe)")

    backend = pick_backend(args.backend)
    notes = transcribe(args.audio, args.start, args.end, backend)
    json.dump({"backend": backend, "notes": notes}, sys.stdout)


if __name__ == "__main__":
    main()
