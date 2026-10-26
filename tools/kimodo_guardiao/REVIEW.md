# Guardiao Kimodo production audit

The retained streams are real outputs of the installed native Kimodo SOMA RP
v1.1 model and Q8 Llama text encoder. There are **29 candidates, 4,830 raw frames**,
and 2,376,360 bytes of raw float motion. Recorded native generation time totals
528.51 seconds, excluding model hashing and process setup. Every candidate has
the exact prompt, seed, 100 diffusion steps, model/executable SHA256, protocol,
actual elapsed time and raw-stream SHA256 in `raw/*/generation.json`.

## Pass 1: complete delivery

- Fresh inference covers all 13 required actions. Walk and run each compare six
  seeds; creep compares four; stalk, limp and crawl each compare two. Seven
  non-locomotion actions each use a fresh dedicated prompt and seed.
- One persistent sequential Vulkan worker produced the first 21 candidates with
  eight-layer text chunks. The first 180-frame request took 31.59 seconds; warm
  requests took about 20–25 seconds. The extra eight candidates used the existing
  Q8 encoder in 32-layer resident mode with a 9,000 MiB residency limit; warm
  generation took 6.55–7.39 seconds. No model download or native rebuild occurred.
- `assets/anim/creature.json` is written atomically. Its original 30-joint SOMA
  schema is unchanged. All actions have `sourceMotion` links to actual streams.
  `guardianMotion.version` is 1. Old one-shot XZ travel and duration are explicit
  gameplay envelopes; local rotations and hip height come from the new inference.

## Pass 2: animation direction and candidate comparison

The initial slow walk candidates looked grounded but moved at about 0.22 m/s;
they could not support the existing game's walking velocities. Revised physical
prompts asked for a continuous brisk lumbering walk and a powerful forward charge.
The real candidate report compares body-pose continuity, FK foot continuity,
vertical bounce, complete leg excursions and forward speed. Two initially
stationary/incomplete candidates are rejected rather than silently looped.

Selected native speed and cycle length:

| Action | Seed | Frames | Native m/s |
|---|---:|---:|---:|
| walk | 105 | 136 | 1.2021 |
| run | 206 | 37 | 3.7980 |
| creep | 304 | 77 | 0.9567 |
| stalk | 402 | 96 | 1.2899 |
| limp | 502 | 84 | 0.6698 |
| crawl | 602 | 59 | 0.7237 |

`pose-review-1.png` and `pose-review-2.png` were rendered directly from the
selected quantized control skeleton and visually reviewed at six phases in both
front and profile views. Walk has restrained low foot lift, spread bent elbows
and alternating support; run has clear forward drive; crawl alternates the
hands/knees. Roar expands chest/arms, recoil braces defensively, pain contracts
the upper body, and inspection/head look remain restrained. These are bone-only
diagnostics: final proportions, fingers, anatomical clearance and planted-foot
adaptation are verified separately on the imported Guardiao by the parent.

Native Kimodo predicts a human control skeleton. Source idle includes a hand
toward the hip and source attack resembles a guarded forward strike. The actual
Guardiao adapter opens the elbows/palms and shapes the striking reach; production
does not claim the model was trained without motion capture.

## Pass 3: defects and integration evidence

- A plain ankle-height contact estimator falsely treated heel-to-toe roll as
  flight. It was replaced by the maximum supported confidence among the actual
  generated ankle, toe and oriented heel anchor. Every anchor uses its own real
  height baseline and horizontal world velocity; the final confidence ramps are
  circular three-frame smoothing. No guessed phase-based contacts are stored.
- Both feet below 0.2 contact confidence occur in 4.4% of walk frames, 6.5% of
  creep, 5.2% of stalk, 3.6% of limp and 1.7% of crawl. The longest interval is
  four frames for walk, three for creep, five for stalk, two for limp and one for
  crawl. Run can contain genuine flight, with 27.0% low-support frames.
- The independent Node oracle verifies every raw hash, actual stream shape,
  prompt/seed/steps connection, normalized packed rotations, source-to-pack
  rotation/hip-height agreement, independent real FK contact reconstruction,
  complete two-foot cycles using a 2.5 cm leading-foot hysteresis, quantized seam
  closure, unchanged one-shot XZ/duration and non-reuse of old rotation data.
  Known malformed quaternion and out-of-range contact controls must fail.
- The producer uses retained native streams only; it never reads old rotations.
  The previous pack supplies the skeleton and explicit one-shot XZ envelope.
  No audio, AI, world, networking or original FBX files are written by this leaf.

## Pass 4: polish and final repeat

- Prompt files are per seed, so revised candidate descriptions remain exact.
- Binary streams remain untouched, and model identities are recorded once per
  worker. The generator documents bounded VRAM defaults and optional residency.
- Packing is reproducible without GPU inference using
  `python tools/generate-guardian-motion.py --pack`.
- Native reproduction uses
  `python tools/generate-guardian-motion.py --force --generate-only`.
- The final independent test exits zero and emits `KIMODO_GUARDIAN_VERIFIED`.
  The final pack SHA256 is
  `9243b3388bf17b92ad78cc4392c0677c322b3b43988c175f2ca9b6555cdae758`.

After the complete reread, physical mechanics review, defect fixes, independent
checks and low-cost polish, no remaining defect was found in this leaf's data
production scope. The parent owns the live full-character visual acceptance.
