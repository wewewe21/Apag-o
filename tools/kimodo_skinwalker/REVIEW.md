Fresh native Kimodo skinwalker motion audit
=========================================

This leaf retained25 genuinely generated candidates:5010 raw frames and2464920
bytes of original float streams. Recorded native inference totals218.973seconds,
excluding model hashing and process setup. Every candidate retains its exact
prompt, seed,100 denoising steps, native request, executable/model SHA256,
elapsed time and raw-stream hashes under raw/*/generation.json. All requests
ran sequentially through the already installed Vulkan --server worker with32
resident Q8 text layers,9000MiB text budget and8-layer motion chunks. Warm180f
requests took6.33–6.58seconds; warm240f requests took7.77–8.50seconds. There were
no model/source edits, installations, downloads or external generation APIs.

Pass1 implemented all13 original actions freshly and a14th native source
performance for the visual doorway layer. Three walk/run seeds, two creep,
stalk,limp,crawl seeds and four doorway seeds were generated and compared.
Dedicated fresh prompts/seeds cover idle,look,inspect,attack,roar,recoil,pain.
The original SOMA30 skeleton and30fps int16 quaternion/root contract remain.
guardianMotion.version=2 and profile=skinwalker select the new direction.
The doorway source lives in guardianMotion.visualLayers.doorway; the13 gameplay
clip IDs and procedural shield remain compatible. Only previous one-shot
rootXZ paths and frame counts are retained; all body rotations/hip heights are
new native output, with documented alignment, extraction/resampling and seam
closure. A small gameplay-envelope.json preserves that compatibility evidence.

Pass2 reviewed both candidate sheets and both selected-pose sheets at six
phases from front/profile views. Initial numerical selection accepted an overly
upright run and a doorway range that included standing entry/exit. Those were
replaced with source style requirements: a genuine25degree mean running hunch,
and a complete doorway cycle with mean hunch45degrees and minimum25degrees.
The final doorway crop in fact maintains at least45.47degrees of native hunch.
Two additional mechanical doorway prompts failed to retain the required shape;
they remain visible as rejected real inference, rather than being silently used.
Five candidates fail combined full-cycle/style requirements; their streams and
prompts remain intact. The rejected run is visibly upright, and the rejected
doorway clips include entry/exit or insufficient persistent bowing.

| Performance | Selected seed | Frames | Native m/s | Mean source hunch | Leading-foot switches |
|---|---:|---:|---:|---:|---:|
| walk |10103|55|1.0137|24.56deg|2|
| run |10201|37|2.8896|45.90deg|4|
| creep |10301|65|0.5616|38.23deg|2|
| stalk |10402|60|0.6849|19.85deg|2|
| limp |10502|135|0.3997|28.52deg|2|
| crawl |10601|59|0.6452|76.62deg|4|
| doorway layer |11401|58|0.8559|48.91deg|4|

The source is a human control skeleton, not the3m authored monster skin.
Walk deliberately has a narrow0.241m source foot separation and an unusual
outstretched arm; the target adapter must express long loose claws and crooked
proportions. Run has0.0727m shoulder asymmetry and a deeply forward spine.
Creep transfers slow weight with a low neck; crawl alternates hands/knees with
an arched back. Inspection folds/reaches down, look twists/scans asymmetrically,
roar lifts the head/chest, recoil retreats defensively, attack reaches into a
single strike, and pain selects the strongest real torso contraction.
Doorway palms are raised/bent ready for bracing; the actualskin adapter places
them on accessible jamb/wall surfaces with nail offsets. The producer does not
claim source bones alone prove final skin clearance. Root/rig/environment gates
measure that separately on the original authored monster.

Pass3 fixed an integration defect exposed by tightening independent FK
comparison: contacts measured before int16 quantization differed from the
actual game pose because1mm root quantization can change30fps velocity. The
producer now computes every confidence from decoded final quantized roots and
normalized quaternions at the stored rounded native speed. The independent
Node/Three oracle reconstructs ankle,ToeBase,oriented heel support and agrees
within0.000051 at every frame. Contacts require both low height and low world
horizontal velocity; no guessed phase schedule is used. Three-frame circular
smoothing gives bounded ramps. Both feet have complete forward/back excursions,
actual vertical swings and at least two2.5cm hysteresis leading-foot switches.
Both feet below0.2 confidence occur in3.6% of walk,0% creep,1.7% stalk,9.6% limp,
1.7% crawl,5.2% doorway and21.6% run (which can include genuine flight).

The independent oracle connects all25 compared raw hashes to manifests and
all14 selected packed performances back to native rotations/hipY. It measures
source speed directly, checks full cycles, final-pose contacts, seam closure,
distinct fresh rotations, old one-shot duration/rootXZ compatibility, source
leg lengths and the measured3m target/native strideScale1.75288162. Six
corruption controls mutate the accepted production walk: zero quaternion,
damaged seam, forged contacts, zero speed, changed provenance hash and wrong
frame count. Every corrupted pack must be rejected by the same clip oracle
that accepts the positive final pack. Additional root anatomy metadata is
permitted; a nativePayloadSha256 over fps/skeleton/clips/doorway stays stable
when that metadata is appended.

Pass4 preserves reproducible per-seed prompt variants and rejected candidates,
atomic pack writes, exact upperBodyMask names plus upperBodyBoneIndices, and
fps30 on the standalone doorway layer. The mask excludes hips and all leg/foot
bones, so world duck weight can layer it over continuously moving gait. The
generator never writes the native model/source, original FBX, audio, maps,
network protocol or other owners' runtime files. Final source-only render and
independent numerical checks pass. Parent verification reviews real monster
skin, doorway anticipation/IK and moving-body behavior before integration is
declared complete.

Reproduce using the existing installed native executable:

```text
python tools/generate-skinwalker-motion.py --generate-only
python tools/generate-skinwalker-motion.py --pack
node tools/test/kimodo-skinwalker-test.mjs
```

The generation command hashes/checks retained candidates before skipping them;
--force explicitly regenerates streams. The pack command performs no inference.
Diagnostic images are recreated by review-poses.py and review-candidates.py.
