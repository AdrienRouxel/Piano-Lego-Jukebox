# Étape 2 — remplacer le micrologiciel du hub

> **À lire avant de se lancer.** Ce document décrit ce qu'apporterait un
> micrologiciel personnalisé sur le hub du 21323, ce qu'il n'apportera jamais,
> la procédure d'installation, et **la procédure de retour au micrologiciel
> officiel LEGO**.

---

## En un paragraphe

Le hub du piano est un **Powered Up 2-port Hub** (réf. 88009). Il est pris en
charge par [**Pybricks**](https://pybricks.com), un micrologiciel libre qui fait
tourner du MicroPython directement dans la brique. L'installation se fait depuis
le navigateur, en Bluetooth, en trois minutes. **Le retour au micrologiciel LEGO
d'origine se fait de la même manière, par le même outil.**

Mais il faut être clair sur le gain : **cela ne changera pas d'un millimètre ce
que le piano sait faire.** Un seul moteur, un seul arbre à cames, aucune touche
adressable individuellement. Le seul intérêt réel est **l'autonomie** — faire
jouer le piano sans ordinateur allumé.

---

## Ce que ça change, ce que ça ne change pas

| | Micrologiciel LEGO (actuel) | Pybricks |
|---|---|---|
| Piloter le moteur depuis ce jukebox | ✅ | ❌ (protocole différent) |
| Application officielle LEGO Powered Up | ✅ | ❌ |
| Faire tourner un programme **dans** le hub, sans ordinateur | ❌ | ✅ |
| Démarrer une chorégraphie d'un appui sur le bouton vert | ❌ | ✅ |
| Lire le capteur de touche en local, réagir sans latence | ❌ | ✅ |
| **Actionner une touche précise** | ❌ | ❌ — *limite mécanique* |
| **Faire jouer au piano les bonnes notes** | ❌ | ❌ — *limite mécanique* |

Les deux dernières lignes sont les seules qui comptent vraiment, et la réponse
est la même des deux côtés. Derrière les 25 touches il n'y a **qu'un axe et des
leviers** : la seule grandeur pilotable est la vitesse de rotation. Aucun
logiciel ne peut créer 25 actionneurs qui n'existent pas.

Autre point : le moteur du piano est un *Simple Medium Linear Motor*, **sans
encodeur de rotation**. Sous Pybricks il devient un `DCMotor`, dont la seule
commande est… la puissance. Exactement ce que fait déjà `choreography.js`.

**Verdict : pour ce jukebox, l'installation de Pybricks est une perte nette.**
Elle vaut le coup si, et seulement si, tu veux que le piano joue tout seul,
sans ordinateur.

---

## Avant de commencer

### Le point de vigilance propre au 21323

Pour flasher un City Hub, **tous les moteurs et capteurs doivent être
débranchés**. C'est une exigence de l'outil Pybricks, pas un détail : le hub
refuse d'entrer en mode mise à jour autrement.

Sur le 21323, cela veut dire **débrancher les deux fiches du hub**, à
l'intérieur du piano. Le hub est accessible en retirant le clavier amovible.
Vérifie que tu peux atteindre les deux prises **avant** de commencer : rien
n'est pire que de s'arrêter à mi-chemin.

### Ce qui rend l'opération réversible

Le **chargeur d'amorçage** (*bootloader*) du hub occupe une zone de mémoire
distincte, que la mise à jour du micrologiciel ne touche pas. Il est donc
toujours possible d'y revenir — appui long sur le bouton — et de reflasher, y
compris après une mise à jour interrompue. C'est ce qui rend l'opération sûre.

### Prérequis

- **Chrome ou Edge** (Web Bluetooth, comme pour le jukebox)
- des **piles fraîches** — une coupure d'alimentation pendant l'écriture est le
  seul vrai risque
- l'application LEGO Powered Up **fermée** (un seul maître Bluetooth à la fois)

---

## Installer Pybricks

1. Débrancher le moteur et le capteur du hub.
2. Ouvrir **<https://code.pybricks.com>**.
3. Menu **⚙︎ → Install Pybricks Firmware**, puis choisir **City Hub**.
4. **Maintenir le bouton vert du hub enfoncé.** Attendre que la lumière
   clignote en **rose**.
5. Sans relâcher, cliquer sur le bouton de mise à jour dans la page, choisir
   **LEGO Bootloader** dans la liste du navigateur, puis *Pair*.
6. Attendre que la lumière s'éteigne puis clignote **rouge / vert / bleu**.
   Relâcher le bouton et laisser l'installation aller au bout.
7. Rebrancher le moteur et le capteur.

Source : [Installing Pybricks](https://pybricks.com/learn/getting-started/install-pybricks/).

## Revenir au micrologiciel officiel LEGO

Même outil, même séquence :

1. Débrancher le moteur et le capteur.
2. **<https://code.pybricks.com>** → menu **⚙︎ → Restore Official LEGO Firmware**.
3. Choisir **City Hub** et suivre les mêmes étapes de bouton (rose, puis
   rouge / vert / bleu).
4. Rebrancher, ouvrir l'application LEGO Powered Up : le piano y est reconnu
   comme au premier jour, avec ses quatre morceaux d'origine.

Pybricks embarque les micrologiciels LEGO d'origine pour cette restauration ;
aucun fichier n'est à récupérer à la main.

> Les procédures alambiquées qu'on trouve en ligne (application SPIKE, firmware
> V2 puis V3, `dfu.pybricks.com`) concernent les **hubs SPIKE Prime et
> MINDSTORMS**, pas le City Hub. Pour notre hub, la restauration se fait
> entièrement dans Pybricks Code.

---

## Bonus : un piano autonome sous Pybricks

Si tu franchis le pas, voici de quoi démarrer. Ce programme rejoue une
chorégraphie dans le hub, sans ordinateur : appui sur le bouton vert → le piano
s'anime ; nouvel appui → il s'arrête.

```python
# Piano autonome — LEGO Ideas Grand Piano 21323 sous Pybricks
# Le moteur et le capteur sont trouvés automatiquement, quel que soit le port.

from pybricks.hubs import CityHub
from pybricks.pupdevices import DCMotor, InfraredSensor
from pybricks.parameters import Port, Color
from pybricks.tools import wait, StopWatch

hub = CityHub()

# Détection : on essaie chaque port pour chaque type d'appareil.
motor = None
sensor = None
for port in (Port.A, Port.B):
    if motor is None:
        try:
            motor = DCMotor(port)
            continue
        except OSError:
            pass
    if sensor is None:
        try:
            sensor = InfraredSensor(port)
        except OSError:
            pass

# Chorégraphie : (durée en ms, puissance en %). 0 = touches immobiles.
# À composer à l'oreille, en écoutant le morceau que tu veux accompagner.
CHOREOGRAPHY = [
    (1200, 45), (400, 0), (1200, 55), (400, 0),
    (2400, 70), (600, 85), (2400, 60), (800, 0),
    (3200, 90), (1600, 45), (900, 0),
]

MIN_POWER = 40   # sous ce seuil l'arbre à cames ne tourne pas


def play():
    hub.light.on(Color.ORANGE)
    for duration, power in CHOREOGRAPHY:
        motor.dc(0 if power == 0 else max(MIN_POWER, power))
        # On interrompt dès que le bouton est pressé, sans attendre la fin du pas.
        clock = StopWatch()
        while clock.time() < duration:
            if hub.buttons.pressed():
                return
            wait(20)
    motor.stop()


hub.light.on(Color.BLUE)
while True:
    if hub.buttons.pressed():
        while hub.buttons.pressed():
            wait(10)          # attendre le relâchement
        play()
        motor.stop()
        hub.light.on(Color.BLUE)
        while hub.buttons.pressed():
            wait(10)
    wait(50)
```

Pour aller plus loin, `scripts/make-demo-tracks.mjs` et
`web/js/music/choreography.js` montrent comment une partition devient une courbe
d'activité : rien n'empêche d'exporter cette courbe en une liste
`(durée, puissance)` et de la coller dans le programme ci-dessus.

---

## Et un micrologiciel écrit de zéro ?

Techniquement possible — le chargeur d'amorçage du hub accepte n'importe quelle
image valide, c'est précisément ce qui permet à Pybricks d'exister. En pratique,
ce serait réécrire la pile Bluetooth, le protocole LPF2 des ports, la gestion de
la batterie et du bouton, pour arriver exactement là où Pybricks est déjà, sur
un matériel dont la mécanique reste la même. Le jeu n'en vaut pas la chandelle.

---

## Références

- [Installing Pybricks](https://pybricks.com/learn/getting-started/install-pybricks/) — installation et restauration
- [Pybricks Code](https://code.pybricks.com) — l'éditeur et les outils de flashage
- [Documentation du City Hub](https://docs.pybricks.com/en/latest/hubs/cityhub.html)
- [LEGO Wireless Protocol 3.0](https://lego.github.io/lego-ble-wireless-protocol-docs/) — le protocole du micrologiciel d'origine
