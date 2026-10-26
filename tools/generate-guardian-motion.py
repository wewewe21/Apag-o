#!/usr/bin/env python3
"""Reproduce Guardiao's real local Kimodo motion and selected game pack.

Only this script drives the GPU; every request is sequential in one native worker.
Raw float streams, exact prompts, seed, model identities and measured timings are
retained under tools/kimodo_guardiao. --pack never invokes inference.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time

ROOT = Path(__file__).resolve().parents[1]
STORE = ROOT / 'tools' / 'kimodo_guardiao'
KIMODO = Path('C:/Users/WillianIA/Documents/kimodo-ai')
LOCOMOTION = ('walk', 'run', 'creep', 'stalk', 'limp', 'crawl')

# Concrete body mechanics are used because Kimodo predicts a human control rig.
# The actual creature's proportions, wide palms and finger performance are adapted
# on the imported rig; none of the generated rotations are copied from old clips.
PROMPTS = {
    'walk': 'A massive heavy creature walks slowly forward with a wide stance. The torso is broad and hunched slightly forward. Both elbows stay bent and spread outward, hands hanging away from the thighs. Each foot is lifted just enough to take a short deliberate step, then planted firmly. The body weight shifts visibly from side to side over the supporting leg, the shoulders lag behind the hips and settle after each heavy footfall. The head stays low and stares ahead. Continuous ponderous forward walking, balanced and grounded.',
    'run': 'A huge heavy creature charges forward with short forceful running steps and a wide stance. The knees stay bent, torso leaning forward. The elbows are held wide away from the body, hands curled in front and below the chest, with restrained arm movement. The shoulders twist against the hips as each foot drives into the floor. The body has great weight and momentum, not light or graceful. A continuous lumbering powerful forward charge with both legs alternating.',
    'creep': 'A large heavy creature creeps forward extremely slowly in a broad crouched stance. Bent knees, torso leaning forward, elbows held wide, hands extended low and away from the knees. It carefully transfers all its weight onto one leg before taking a short low step with the other. The head stays still and lowered, the shoulders roll slowly and the spine moves like a stalking predator. Continuous tense controlled forward creeping with planted feet.',
    'stalk': 'A heavy hulking creature stalks forward in slow deliberate alternating steps, crouching slightly, head lowered. Its elbows are bent and held far outward and hands hover away from its legs. The feet are set apart, each foot stays planted while weight rolls onto it, then the other foot reaches forward. The upper body is tense and still with small asymmetrical shoulder rolls. Continuous predatory stalking, menacing and grounded.',
    'limp': 'A heavy creature walks forward with a pronounced limp. It plants the left foot firmly, drags the right foot forward in a short low step, then shifts its heavy body onto the right leg reluctantly. The knees remain bent and feet widely spaced, shoulders tilting under the weight. The bent elbows stay spread outward with hands clear of the legs. A continuous slow asymmetric hobbling gait, balanced rather than falling.',
    'crawl': 'A massive creature crawls forward on both hands and knees. Its hands are planted far apart, elbows bent outward, chest kept low and broad. It advances the left hand with the right knee, then the right hand with the left knee. The torso shifts heavy weight between the supporting hands, the head hangs low and looks forward. Slow powerful continuous crawling with grounded limbs and a heavy rolling back.',
    'idle': 'A massive heavy creature stands almost still with feet wide apart and knees slightly bent. Both elbows remain bent and spread away from the broad torso, heavy hands held clear of the thighs. The lowered head faces forward. It breathes slowly with a subtle rising chest, one shoulder settling slightly lower than the other. Small tense weight shifts without stepping, a menacing restrained idle stance.',
    'look': 'A massive heavy creature stands planted with a broad stance, bent knees and elbows held wide. Without moving its feet it slowly turns its head and upper chest to look to the left, pauses, then looks to the right and finally forward. Its heavy shoulders lag behind the head, hands remain low away from the thighs. A tense suspicious scanning motion with restrained movement.',
    'inspect': 'A huge heavy creature stands with feet wide apart and elbows bent outward. It slowly bends the knees and lowers its broad torso toward the ground in front of it, reaching one hand forward as if examining something, while the other arm stays out for balance. It pauses, draws the hand back, and rises slowly into its original planted stance. Heavy deliberate curious movement, head leading and shoulders following.',
    'attack': 'A massive hunched creature attacks straight ahead. From a wide planted stance it draws both bent arms outward, lowers its weight, then lunges forward with one powerful step and swings both heavy arms inward and forward in a crushing grab at chest height. The torso and head drive forward behind the hands. It then recoils slightly and settles its weight with bent knees. A single brutal heavy attack with a clear anticipation, strike and recovery.',
    'roar': 'A huge heavy creature stands with feet far apart and bent knees, arms spread outward. It slowly pulls its shoulders back, raises its chest and head, then throws its head upward in a powerful roar while the bent arms tense wide. The body trembles briefly under the exertion, then the head lowers and the massive shoulders settle back into a hunched stance. A single heavy threatening display without walking.',
    'recoil': 'A huge heavy creature recoils backwards as if pushed forcefully in the chest. Its chest jerks back first, head and shoulders following, both elbows open outward and hands rise defensively. It takes heavy stumbling backward steps to recover balance, knees deeply bent, then lowers its hands and steadies itself in a broad stance. The body has great inertia and settles slowly. A single controlled backward recoil without falling.',
    'pain': 'A massive heavy creature flinches suddenly in pain while standing with feet planted wide. Its chest contracts, shoulders jerk inward, head lowers sharply and bent arms tense outward. Its torso then slowly untwists and recovers its broad hunched stance. A short forceful full body pain reaction, feet staying on the ground.',
}
SEEDS = {'walk':[101,102,103,104,105,106], 'run':[201,202,203,204,205,206], 'creep':[301,302,303,304], 'stalk':[401,402], 'limp':[501,502], 'crawl':[601,602], 'idle':[701], 'look':[801], 'inspect':[901], 'attack':[1001], 'roar':[1101], 'recoil':[1201], 'pain':[1301]}
FORWARD_PROMPTS = {
    'walk':'A hulking creature walks continuously straight forward at a brisk walking pace. It takes long strong alternating heel-to-toe strides with feet spaced wide apart and knees slightly bent, covering ground without pausing. Its massive torso leans forward a little, hips shift onto each supporting foot and heavy shoulders roll with delayed weight. Both elbows stay bent and spread out to the sides, hands hanging well away from the thighs with restrained arm swings. Head lowered and fixed ahead. Continuous powerful lumbering walking, each step landing heavily and decisively.',
    'run':'A hulking creature sprints fast straight forward in a powerful continuous charge, covering ground with long forceful alternating strides. It drives off each foot hard and lands heavily on the other, knees bent on impact. Its broad torso leans forward with great momentum, the hips rotate and shoulders twist against them. Both bent elbows are held wide away from the chest and hands held forward like claws with restrained arm swings. The head stays lowered looking ahead. A fast heavy bounding sprint with several complete strides, no pauses.',
    'creep':'A heavy crouching creature walks straight forward continuously in a deliberate predatory gait. Its feet stay separated, knees bent and broad torso leaning forward. It takes alternating steps with both legs, placing each foot firmly before shifting its weight over it. Its elbows are held outward and hands hover away from the thighs. The head is lowered and shoulders move slowly against the hips. It covers ground steadily without stopping, creeping with purposeful heavy steps.',
}
FRAMES = {name:180 for name in LOCOMOTION}
FRAMES.update(idle=150, look=180, inspect=120, attack=90, roar=120, recoil=120, pain=90)

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024), b''): digest.update(block)
    return digest.hexdigest()

def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(value, indent=2), encoding='utf-8')
    temporary.replace(path)

def generate(steps, force=False, only=None, text_chunk=8):
    STORE.mkdir(parents=True, exist_ok=True)
    exe = KIMODO/'build/debug/kmd-generate.exe'
    model = KIMODO/'models/kimodo-soma-rp-v1.1-f32.gguf'
    text = KIMODO/'Llama-3-Kimodo-Q8_0.gguf'
    identities = {key:{'path':str(path), 'sha256':sha(path)} for key,path in [('executable',exe),('motionModel',model),('textModel',text)]}
    plan = [(name,seed) for name in PROMPTS for seed in SEEDS[name] if not only or name in only]
    env = dict(os.environ, KIMODO_BACKEND='vulkan', KIMODO_TEXT_LAYER_CHUNK=str(text_chunk), KIMODO_TEXT_RESIDENT_LIMIT_MIB='9000', KIMODO_MOTION_LAYER_CHUNK='8')
    logpath = STORE/'native-generation.log'
    with logpath.open('a',encoding='utf-8') as native_log:
        worker = subprocess.Popen([str(exe),'--server',str(model),str(text)], cwd=KIMODO, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=native_log, text=True, bufsize=1)
        try:
            for index,(name,seed) in enumerate(plan):
                output = STORE/'raw'/f'{name}_s{seed}'
                prompt_text=FORWARD_PROMPTS.get(name,PROMPTS[name]) if (name=='walk' and seed>=104) or (name=='run' and seed>=204) or (name=='creep' and seed>=303) else PROMPTS[name]
                prompt = STORE/'prompts'/f'{name}_s{seed}.txt'
                prompt.parent.mkdir(parents=True,exist_ok=True)
                prompt.write_text(prompt_text,encoding='utf-8')
                manifest_path = output/'generation.json'
                if not force and manifest_path.exists():
                    previous=json.loads(manifest_path.read_text())
                    if previous['steps']==steps and previous['prompt']==prompt_text:
                        print(f'SKIP {name} seed {seed}',flush=True)
                        continue
                output.mkdir(parents=True,exist_ok=True)
                start=time.monotonic()
                command=f'8\t{steps}\t{seed}\t{output}\t{FRAMES[name]}\t{prompt}\n'
                worker.stdin.write(command);worker.stdin.flush()
                response=worker.stdout.readline().strip()
                elapsed=time.monotonic()-start
                if not response.startswith('OK\t'): raise RuntimeError(f'{name}: {response} (exit {worker.poll()}); inspect {logpath}')
                _,frames,joints=response.split('\t')
                manifest={'name':name,'seed':seed,'steps':steps,'frames':int(frames),'joints':int(joints),'prompt':prompt_text,'promptFile':prompt.relative_to(ROOT).as_posix(),'protocol':command.strip(),'elapsedSeconds':round(elapsed,3),'generatedUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'backend':'vulkan','textLayerChunk':text_chunk,'motionLayerChunk':8,'models':identities,'streams':{file:sha(output/file) for file in ['root_positions.f32','local_rotations_xyzw.f32']}}
                write_json(manifest_path,manifest)
                print(f'GENERATED {index+1}/{len(plan)} {name} seed {seed}: {frames} frames, {elapsed:.2f}s',flush=True)
        finally:
            worker.stdin.close()
            worker.wait(timeout=60)

def pack():
    spec=importlib.util.spec_from_file_location('guardian_motion_pack', STORE/'pack.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    module.pack(ROOT,STORE)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--steps',type=int,default=100)
    parser.add_argument('--text-layer-chunk',type=int,choices=(8,32),default=8,help='32 keeps the7.8GiB Q8 encoder resident; use only with sufficient GPU headroom')
    parser.add_argument('--force',action='store_true')
    parser.add_argument('--pack',action='store_true',help='Pack retained real streams without GPU inference')
    parser.add_argument('--generate-only',action='store_true')
    parser.add_argument('--only',nargs='+',choices=tuple(PROMPTS))
    args=parser.parse_args()
    if not args.pack: generate(args.steps,args.force,args.only,args.text_layer_chunk)
    if not args.generate_only:pack()

if __name__=='__main__':main()
