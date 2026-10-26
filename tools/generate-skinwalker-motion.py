#!/usr/bin/env python3
"""Generate fresh skinwalker performances in one sequential local Kimodo worker.

No external services or downloads. The exact native requests, source streams,
prompts, seeds and executable/model hashes are retained for independent review.
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
STORE = ROOT / 'tools' / 'kimodo_skinwalker'
KIMODO = Path('C:/Users/WillianIA/Documents/kimodo-ai')
PROMPTS = {
    'walk': 'A gaunt crooked humanoid creature walks continuously straight forward. Its knees stay softly bent and its narrow feet take clear alternating strides, advancing steadily without pausing. Its upper back is hunched sharply, neck reaching low forward from the rounded shoulders. The left shoulder hangs lower than the right, the head tilts slightly to one side while staring ahead. Long thin arms dangle loosely with elbows slightly bent and tense claw hands below the waist. Each foot places quietly heel to toe, followed by an unsettling delayed sideways roll through the crooked spine. A sustained asymmetric predatory walking gait with both legs moving fully, balanced and grounded.',
    'run': 'A very thin long limbed crooked humanoid creature runs continuously straight forward with fast clear alternating running strides. Its torso folds forward into a sharp hunch and its neck projects low ahead of the shoulders. One shoulder is raised and the other hangs lower. The dangling arms swing unevenly close beside its narrow body, elbows bent slightly and tense hands reaching like claws. Its hips drive the legs forward, knees bending fully during each swing and each foot pushing off decisively. The head stays eerily steady while the hunched shoulders ripple against the hips. A sustained unsettling predatory chase, no pauses, covering ground rapidly.',
    'creep': 'A gaunt twisted humanoid creeps continuously straight forward in a deeply hunched crouch. It takes slow clear alternating steps with both legs, each knee bending and foot reaching before the weight transfers onto it. The feet are narrowly separated and the hips stay low. Its spine rounds strongly forward, long neck stretched ahead and head tilted sideways, one shoulder lower than the other. Thin arms hang low with bent elbows, tense claw hands hovering close to the floor. Its chest rolls slowly out of rhythm with the hips as it advances without stopping. An uncanny cautious stalking creep with complete alternating steps and grounded foot placements.',
    'stalk': 'A thin crooked humanoid creature stalks continuously straight forward with deliberate alternating steps. The upper back is sharply hunched, head low and tilted to the right, neck extending ahead. One shoulder trails behind the other as the narrow torso twists. Both knees bend, one foot reaches past the other and plants, then the opposite foot advances, continuously covering ground. Long arms hang slack beside the body with the elbows slightly bent and clawlike hands tense. The shoulders and spine settle a little later than each quiet footfall. An eerie asymmetric stalking walk, alert, grounded and uninterrupted.',
    'limp': 'A gaunt hunched humanoid hobbles continuously forward with a clear limp. It advances and plants the left foot, bends its left knee to accept the weight, then drags and advances the right foot in a shorter but visible step, and repeats without stopping. The narrow torso bows forward and tilts to the right, one shoulder hanging low, neck stretched out and head tilted. Thin arms dangle unevenly, one bent closer to the chest and the other reaching down with tense claw hands. Complete alternating uneven steps, balancing over each planted foot rather than falling.',
    'crawl': 'A gaunt crooked humanoid creature crawls continuously straight forward on hands and knees. Its upper back is arched high and rounded like a hunch, head and long neck stretched low ahead. It moves the left hand and right knee forward together, plants them, then advances the right hand and left knee, repeating complete alternating cycles without stopping. Thin bent arms support the narrow torso, long hands spread on the floor. The shoulders are uneven and the head stays tilted as its spine rolls with each deliberate transfer of weight. An unsettling grounded low predatory crawl with continuous forward travel.',
    'doorway': 'A gaunt long limbed hunched humanoid walks continuously forward beneath a low doorway. It keeps taking clear alternating walking steps with bent knees throughout. The narrow torso folds steeply forward and twists slightly left, rounded upper back ducking beneath the lintel, head lowered with the long neck reaching forward. Both arms reach outward and slightly forward, elbows bent, palms facing the walls on each side as though lightly bracing against the doorway jambs while advancing. One shoulder is lower, fingers spread tensely. It remains deeply ducked and braced during several complete forward strides without stopping or standing tall.',
    'idle': 'A gaunt crooked humanoid stands almost motionless with narrow planted feet and softly bent knees. Its upper back is sharply hunched, thin neck extending low ahead and head tilted to one side. One shoulder is lower than the other. Its long arms dangle close beside the narrow body, elbows slightly bent, tense claw hands hanging below the waist. The chest expands slowly with an eerie breath, followed by a delayed small shoulder tremor and tiny asymmetric weight shifts. A restrained unsettling hunched idle, without stepping.',
    'look': 'A gaunt hunched crooked humanoid stands with narrow planted feet and bent knees. Its head first tilts unnaturally to the left and turns to look behind that shoulder, the rounded upper spine following slowly. It pauses, then turns its head to the right and scans there before looking ahead again. The long neck reaches low out of sharply hunched uneven shoulders, long thin arms hanging slack with tense claw hands. Delayed upper body twists and eerie head tilts, feet staying planted throughout.',
    'inspect': 'A gaunt crooked hunched humanoid examines something on the floor. Keeping its feet planted, it bends its knees deeply and bows its rounded spine forward, long neck and tilted head reaching down first. One thin arm reaches low forward with an open tense claw hand, the other hangs bent beside it for balance. It pauses very low as though studying a scent, then slowly draws the reaching hand back and rises into the original sharply hunched asymmetric stance. A single unsettling deliberate inspection.',
    'attack': 'A thin long limbed crooked humanoid attacks straight ahead once. From a sharply hunched uneven stance it coils by twisting its rounded torso left and drawing one claw hand back near the shoulder. It suddenly takes one lunging forward step, snaps its head and long neck ahead and whips that thin arm forward and downward in a vicious raking strike, the other claw reaching to grab. Its bent knees catch the weight, then the arms recoil and it settles back into its crooked hunch. Clear anticipation, explosive long reaching strike and recovery.',
    'roar': 'A gaunt crooked humanoid makes a single unnatural threatening scream. Its narrow feet stay planted with bent knees, shoulders uneven and spine sharply hunched. It draws its thin elbows back and lifts its long neck and tilted head abruptly, chest unfolding briefly as the claw hands spread tensely beside the torso. The upper body shudders and twists asymmetrically while the jaw opens as though screaming. It then folds its spine and drops the head forward into the original low hunch, arms dangling again. A disturbing tense display without walking.',
    'recoil': 'A gaunt crooked humanoid recoils backwards from a force striking its chest. The narrow chest snaps backward and twists to one side, long neck and tilted head lagging behind. Its thin arms fly up defensively with bent elbows and open claw hands. It takes two visible stumbling backward steps with alternating feet and bent knees to regain balance, then lowers its arms and folds into its sharply hunched uneven stance. A single sudden off balance retreat and controlled recovery, without falling.',
    'pain': 'A gaunt hunched crooked humanoid has a sudden short pain spasm. Its feet remain planted with bent knees. The narrow chest contracts sharply and twists right, one shoulder jerking up while the other drops, tilted head and long neck snapping down. Thin elbows draw inward, claw hands tensing near the ribs. Its rounded spine trembles briefly then unwinds and returns toward its original asymmetric hunch. A distinct sudden full body flinch with grounded feet.',
}
SEEDS = {'walk':[10101,10102,10103], 'run':[10201,10202,10203], 'creep':[10301,10302], 'stalk':[10401,10402], 'limp':[10501,10502], 'crawl':[10601,10602], 'doorway':[11401,11402,11403,11404], 'idle':[10701], 'look':[10801], 'inspect':[10901], 'attack':[11001], 'roar':[11101], 'recoil':[11201], 'pain':[11301]}
ALTERNATE_PROMPTS = {
    11403:'A person walks straight forward continuously while bent deeply at the waist beneath a very low ceiling. The torso stays almost horizontal and the knees stay bent throughout all the walking steps. The head and neck stay low in front of the rounded back without rising. Both arms are held out to the left and right sides at chest height, elbows bent about ninety degrees, open palms facing outward to slide lightly along the narrow walls on either side. Both feet take complete alternating steps with continuous forward travel. Maintain the deeply bowed posture and sideways wall bracing arms for the whole sequence, no upright beginning or ending.',
    11404:'A thin hunched creature moves continuously straight forward in a deep crouching duck walk through a low narrow tunnel. Both knees remain bent, upper body folded steeply forward at the hips, rounded back low, neck stretched ahead and head looking forward close to chest height. The two thin arms reach sideways to opposite walls, elbows bent, palms raised beside the shoulders and facing outward as if sliding along the walls for balance. It takes many visible alternating forward steps without stopping, maintaining the low bowed twisted torso and braced arms from the first step to the last.',
}
FRAMES = {name:240 for name in ('walk','creep','stalk','limp','crawl','doorway')}
FRAMES.update(run=180,idle=150,look=180,inspect=120,attack=90,roar=120,recoil=120,pain=90)

def sha(path):
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()

def write_json(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_suffix(path.suffix+'.tmp')
    temporary.write_text(json.dumps(value,indent=2),encoding='utf-8');temporary.replace(path)

def generate(steps,force=False,only=None):
    STORE.mkdir(parents=True,exist_ok=True)
    exe=KIMODO/'build/debug/kmd-generate.exe';model=KIMODO/'models/kimodo-soma-rp-v1.1-f32.gguf';text=KIMODO/'Llama-3-Kimodo-Q8_0.gguf'
    identities={key:{'path':str(path),'sha256':sha(path)} for key,path in [('executable',exe),('motionModel',model),('textModel',text)]}
    plan=[(name,seed) for name in PROMPTS for seed in SEEDS[name] if not only or name in only]
    env=dict(os.environ,KIMODO_BACKEND='vulkan',KIMODO_TEXT_LAYER_CHUNK='32',KIMODO_TEXT_RESIDENT_LIMIT_MIB='9000',KIMODO_MOTION_LAYER_CHUNK='8')
    logpath=STORE/'native-generation.log'
    with logpath.open('a',encoding='utf-8') as native_log:
        worker=subprocess.Popen([str(exe),'--server',str(model),str(text)],cwd=KIMODO,env=env,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=native_log,text=True,bufsize=1)
        try:
            for index,(name,seed) in enumerate(plan):
                prompt_text=ALTERNATE_PROMPTS.get(seed,PROMPTS[name])
                output=STORE/'raw'/f'{name}_s{seed}';prompt=STORE/'prompts'/f'{name}_s{seed}.txt';manifest_path=output/'generation.json'
                prompt.parent.mkdir(parents=True,exist_ok=True);prompt.write_text(prompt_text,encoding='utf-8')
                if not force and manifest_path.exists():
                    previous=json.loads(manifest_path.read_text())
                    if previous['steps']==steps and previous['prompt']==prompt_text and previous['models']==identities and all(sha(output/file)==value for file,value in previous['streams'].items()):
                        print(f'SKIP verified {name} seed{seed}',flush=True);continue
                output.mkdir(parents=True,exist_ok=True);start=time.monotonic()
                command=f'8\t{steps}\t{seed}\t{output}\t{FRAMES[name]}\t{prompt}\n'
                worker.stdin.write(command);worker.stdin.flush();response=worker.stdout.readline().strip();elapsed=time.monotonic()-start
                if not response.startswith('OK\t'):raise RuntimeError(f'{name}: {response} (exit{worker.poll()}); inspect{logpath}')
                _,frames,joints=response.split('\t')
                manifest={'name':name,'seed':seed,'steps':steps,'frames':int(frames),'joints':int(joints),'profile':'skinwalker','prompt':prompt_text,'promptFile':prompt.relative_to(ROOT).as_posix(),'protocol':command.strip(),'elapsedSeconds':round(elapsed,3),'generatedUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'backend':'vulkan','textLayerChunk':32,'textResidentLimitMiB':9000,'motionLayerChunk':8,'models':identities,'streams':{file:sha(output/file) for file in ['root_positions.f32','local_rotations_xyzw.f32']}}
                write_json(manifest_path,manifest);print(f'GENERATED{index+1}/{len(plan)} {name} seed{seed}: {frames}frames {elapsed:.2f}s',flush=True)
        finally:
            worker.stdin.close()
            try:worker.wait(timeout=60)
            except subprocess.TimeoutExpired:worker.terminate();worker.wait(timeout=10)

def pack():
    spec=importlib.util.spec_from_file_location('skinwalker_motion_pack',STORE/'pack.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);module.pack(ROOT,STORE)

def main():
    parser=argparse.ArgumentParser();parser.add_argument('--steps',type=int,default=100);parser.add_argument('--force',action='store_true');parser.add_argument('--pack',action='store_true');parser.add_argument('--generate-only',action='store_true');parser.add_argument('--only',nargs='+',choices=tuple(PROMPTS));args=parser.parse_args()
    if args.steps!=100:parser.error('Production skinwalker clips require100 native denoising steps')
    if not args.pack:generate(args.steps,args.force,args.only)
    if not args.generate_only:pack()

if __name__=='__main__':main()
