"""Measure native candidates, select complete alternating cycles and encode.

All source rotations and hip heights originate in the recorded Kimodo streams.
Loop processing aligns direction, removes steady travel and closes the seam.
One-shot XZ paths are the previous gameplay envelope, explicitly documented;
their body performance and vertical motion are freshly generated.
"""
import base64
import hashlib
import json
import math
from pathlib import Path
import numpy as np

LOCOMOTION=('walk','run','creep','stalk','limp','crawl')
IDLES=('idle','look')
FPS=30

def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def normalized(q):return q / np.maximum(np.linalg.norm(q,axis=-1,keepdims=True),1e-12)
def qmul(a,b):
    av,bv=a[...,:3],b[...,:3]
    return np.concatenate((a[...,3:4]*bv+b[...,3:4]*av+np.cross(av,bv),a[...,3:4]*b[...,3:4]-np.sum(av*bv,axis=-1,keepdims=True)),axis=-1)
def qrot(q,v):
    cross=2*np.cross(q[...,:3],v)
    return v+q[...,3:4]*cross+np.cross(q[...,:3],cross)
def yaw(theta):return np.array([0,math.sin(theta/2),0,math.cos(theta/2)])
def slerp(a,b,t):
    d=np.sum(a*b,axis=-1,keepdims=True)
    b=np.where(d<0,-b,b);d=np.clip(abs(d),0,1)
    t=np.asarray(t)
    if t.ndim: t=t.reshape(t.shape+(1,))
    th=np.arccos(d);sin=np.sin(th)
    wa=np.sin((1-t)*th)/np.maximum(sin,1e-9);wb=np.sin(t*th)/np.maximum(sin,1e-9)
    return normalized(np.where(d>.9995,a*(1-t)+b*t,a*wa+b*wb))
def continuous(rot):
    rot=rot.copy()
    for frame in range(1,len(rot)):
        dots=np.sum(rot[frame]*rot[frame-1],axis=-1)
        rot[frame]*=np.where(dots<0,-1,1)[:,None]
    return rot
def fk(root,rot,sk):
    frames,joints=rot.shape[:2]
    position=np.zeros((frames,joints,3));orientation=np.zeros_like(rot)
    for j,parent in enumerate(sk['parents']):
        if parent<0:position[:,j]=root;orientation[:,j]=rot[:,j]
        else:
            position[:,j]=position[:,parent]+qrot(orientation[:,parent],np.array(sk['offsets'][j]))
            orientation[:,j]=qmul(orientation[:,parent],rot[:,j])
    return position,orientation
def align(root,rot,sk,name):
    delta=root[-1]-root[0]
    if name in LOCOMOTION and np.linalg.norm(delta[[0,2]])>.25:theta=math.atan2(delta[0],delta[2])
    else:
        f=qrot(rot[0,0],np.array([0,0,1]));theta=math.atan2(f[0],f[2])
    turn=yaw(-theta)
    root=root.copy();root[:,[0,2]]-=root[0,[0,2]]
    root=qrot(turn,root)
    rot=rot.copy();rot[:,0]=qmul(turn,rot[:,0])
    return root,continuous(normalized(rot)),theta
def load(directory,sk):
    root=np.fromfile(directory/'root_positions.f32',dtype='<f4').reshape(-1,3).astype(float)
    rot=np.fromfile(directory/'local_rotations_xyzw.f32',dtype='<f4').reshape(len(root),len(sk['names']),4).astype(float)
    if not np.isfinite(root).all() or not np.isfinite(rot).all():raise ValueError(f'Nonfinite motion in {directory}')
    return root,normalized(rot)
def angles(a,b):return 2*np.arccos(np.clip(abs(np.sum(a*b,axis=-1)),0,1))
def transitions(values):
    return int(np.count_nonzero(np.diff((values>0).astype(np.int8))))

def loop_options(name,root,rot,sk):
    position,_=fk(root,rot,sk)
    li,ri=(sk['names'].index(n) for n in ['LeftFoot','RightFoot'])
    hip=position[:,0]
    feet=position[:,[li,ri]]
    relative=feet-hip[:,None]
    bounds={'walk':(54,140),'run':(36,110),'creep':(60,145),'stalk':(60,145),'limp':(60,145),'crawl':(54,140)}
    low,high=bounds[name]
    choices=[]
    for first in range(6,len(root)-low-3):
        for length in range(low,min(high,len(root)-first-3)+1):
            last=first+length
            segment=relative[first:last,:,2]
            left=segment[:,0];right=segment[:,1]
            # A cycle must include both forward/back extremes of each leg and
            # at least two switches of which foot is ahead, rejecting halfsteps.
            differential=left-right
            crosses=transitions(differential)
            if crosses<2:continue
            span=np.ptp(segment,axis=0)
            if min(span)<(.035 if name=='crawl' else .085):continue
            height=feet[first:last,:,1]
            swing=np.ptp(height,axis=0)
            if min(swing)<(.016 if name=='crawl' else .023):continue
            pose=float(np.mean(angles(rot[first],rot[last])**2))
            seam_foot=float(np.linalg.norm(relative[first]-relative[last]))
            velocities=np.linalg.norm((relative[first+1]-relative[first])-(relative[last+1]-relative[last]))
            bounce=float(np.ptp(root[first:last,1]))
            speed=float(np.linalg.norm(root[last,[0,2]]-root[first,[0,2]])/(length/FPS))
            # Pose/velocity continuity first; avoid overlarge vertical bounce
            # and prefer short grounded swings for a creature with great mass.
            wanted_min={'walk':1.2,'run':3,'creep':.7,'stalk':.45,'limp':.55,'crawl':.16}[name]
            speed_penalty=max(0,wanted_min-speed)*1.5
            score=pose+seam_foot*1.1+float(velocities)*1.2+abs(root[first,1]-root[last,1])*2+bounce*.2+speed_penalty
            choices.append({'score':score,'range':[first,last],'speed':speed,'legExcursion':span.tolist(),'footSwing':swing.tolist(),'alternatingSwitches':crosses,'hipBounce':bounce,'meanArmSpan':float(np.mean(np.linalg.norm(position[first:last,13]-position[first:last,19],axis=1))),'poseErrorDegrees':float(np.degrees(np.sqrt(pose))),'seamFootDistance':seam_foot})
    if not choices:raise ValueError(f'{name}: no complete two-foot cycle in real source')
    choices.sort(key=lambda x:x['score'])
    return choices[0],choices[:6]

def close_loop(root,rot):
    """Distribute small endpoint correction, preserving the measured full cycle."""
    n=len(root)
    # Only the final quarter is corrected; zero derivative at either end.
    blend=min(18,max(10,n//4))
    start=n-blend
    for k in range(blend):
        f=start+k
        t=(k+1)/blend
        t=t*t*(3-2*t)
        rot[f]=slerp(rot[f],rot[0],t)
        root[f]=root[f]*(1-t)+root[0]*t
    return root,continuous(rot)

def contacts(root,rot,sk,speed):
    world=root.copy();world[:,2]+=np.arange(len(root))*speed/FPS
    position,orientation=fk(world,rot,sk)
    result={};report={}
    for side,bone in [('left','LeftFoot'),('right','RightFoot')]:
        joint=sk['names'].index(bone)
        foot=position[:,joint]
        toe=position[:,sk['names'].index(bone.replace('Foot','ToeBase'))]
        # An ankle rises and moves even while the toe stays planted during a
        # heel-to-toe roll. Measure the generated toe and a bone-oriented heel
        # sole anchor, accepting the lower stable support instead of mistaking
        # ordinary foot roll for flight. Both positions follow real Kimodo FK.
        heel=foot+qrot(orientation[:,joint],np.array([0,-.05,-.045]))
        anchors=np.stack((foot,toe,heel),axis=1)
        height=anchors[:,:,1]
        floor=np.percentile(height,5,axis=0)
        velocity=np.linalg.norm(np.gradient(anchors[:,:,[0,2]],axis=0)*FPS,axis=-1)
        velocity_limit=max(.30,float(np.percentile(np.min(velocity,axis=1),30))*1.6)
        # Continuous confidence requires both real low height and low world
        # horizontal velocity, never a synthetic phase-based plant schedule.
        height_conf=np.clip(1-(height-floor-.012)/.075,0,1)
        speed_conf=np.clip(1-(velocity-.18)/max(.50,velocity_limit),0,1)
        values=np.max(height_conf*speed_conf,axis=1)
        # Three-frame confidence ramp; circular because the source is a loop.
        values=(np.roll(values,1)+2*values+np.roll(values,-1))/4
        result[side]=[round(float(v),4) for v in values]
        report[side]={'floorHeights':[round(float(v),5) for v in floor],'velocityThreshold':round(velocity_limit,4),'maxConfidence':round(float(max(values)),4),'plantedFrames':int(np.count_nonzero(values>.4)),'heightSwing':round(float(np.ptp(np.min(height,axis=1))),4),'supportAnchors':'generated ankle, ToeBase and oriented heel; each own height baseline'}
    return result,report

def encode(values,scale):
    return base64.b64encode(np.clip(np.rint(values*scale),-32767,32767).astype('<i2').tobytes()).decode('ascii')
def decode(value,scale):return np.frombuffer(base64.b64decode(value),dtype='<i2').astype(float)/scale
def resample(values,n):
    idx=np.linspace(0,len(values)-1,n);lo=np.floor(idx).astype(int);hi=np.minimum(lo+1,len(values)-1);t=(idx-lo).reshape((-1,)+(1,)*(values.ndim-1))
    return values[lo]*(1-t)+values[hi]*t
def resample_rot(rot,n):
    idx=np.linspace(0,len(rot)-1,n);lo=np.floor(idx).astype(int);hi=np.minimum(lo+1,len(rot)-1);t=idx-lo
    return slerp(rot[lo],rot[hi],t[:,None])

def pack(root_path,store):
    original=json.loads((root_path/'.unlazy/guardian-motion/original-creature.json').read_text(encoding='utf-8-sig'))
    sk=original['skeleton']
    reports={};processed={};selected={}
    for directory in sorted((store/'raw').iterdir()):
        if not (directory/'generation.json').exists():continue
        manifest=json.loads((directory/'generation.json').read_text())
        name=manifest['name'];root,rot=load(directory,sk)
        root,rot,theta=align(root,rot,sk,name)
        report={'rawDirectory':directory.relative_to(root_path).as_posix(),'seed':manifest['seed'],'frames':len(root),'sha256':manifest['streams'],'alignmentYaw':theta}
        if name in LOCOMOTION:
            try:best,alternatives=loop_options(name,root,rot,sk)
            except ValueError as error:
                report['rejected']=str(error)
                reports.setdefault(name,[]).append(report)
                continue
            report.update(best=best,alternatives=alternatives)
            score=best['score']
        else:score=0
        reports.setdefault(name,[]).append(report)
        processed[directory.name]=(root,rot,manifest,report)
        if name not in selected or score<selected[name][0]:selected[name]=(score,directory.name)
    required=set(LOCOMOTION+IDLES+('inspect','attack','roar','recoil','pain'))
    if set(selected)!=required:raise ValueError(f'Missing or unexpected actions: {set(selected)^required}')
    clips={}
    for name in original['clips']:
        if name not in required:continue
        _,key=selected[name];root,rot,manifest,report=processed[key]
        prompt_file=store/'prompts'/f'{name}_s{manifest["seed"]}.txt'
        prompt_file.write_text(manifest['prompt'],encoding='utf-8')
        source={'rawDirectory':report['rawDirectory'],'promptFile':prompt_file.relative_to(root_path).as_posix(),'seed':manifest['seed'],'steps':manifest['steps'],'rawFrames':len(root),'alignmentYaw':report['alignmentYaw'],'rawSha256':manifest['streams'],'generationManifest':f"{report['rawDirectory']}/generation.json"}
        info={'name':name,'src':key,'srcFrames':len(root),'sourceMotion':source}
        if name in LOCOMOTION:
            first,last=report['best']['range'];source['range']=[first,last]
            displacement=root[last]-root[first]
            speed=report['best']['speed']
            n=last-first;section=root[first:last].copy()
            section[:,[0,2]]-=root[first,[0,2]]+np.arange(n)[:,None]/n*displacement[[0,2]]
            root,rot=close_loop(section,rot[first:last].copy())
            info.update(loop=True,rootMotion=False,speed=round(speed,4),range=[first,last],loopScore=round(report['best']['score'],5),cycle=report['best'])
            info['contacts'],info['contactMeasurement']=contacts(root,rot,sk,speed)
        elif name in IDLES:
            root[:,[0,2]]=0
            root,rot=close_loop(root,rot)
            info.update(loop=True,rootMotion=False,speed=0)
        else:
            old=original['clips'][name]
            n=old['frames']
            if name=='pain':
                # Select the strongest genuine torso contraction, keeping the
                # same short additive pain duration used by the game.
                movement=np.mean(angles(rot[1:,[1,2,3,6]],rot[:-1,[1,2,3,6]]),axis=1)
                peak=int(np.argmax(movement));first=max(0,min(len(rot)-n,peak-5))
                root=root[first:first+n].copy();rot=rot[first:first+n].copy();source['range']=[first,first+n]
            else:
                root=resample(root,n);rot=resample_rot(rot,n)
            gameplay=decode(old['root'],1000).reshape(-1,3)
            root[:,[0,2]]=resample(gameplay[:,[0,2]],n)
            info.update(loop=False,rootMotion=True,speed=0,travel=[round(float(root[-1,0]),3),round(float(root[-1,2]),3)],gameplayXZ='previous envelope resampled; new hipsY and body')
        rot=continuous(normalized(rot))
        info.update(frames=len(rot),rot=encode(rot,32767),root=encode(root,1000))
        if info['loop']:
            info['seamMeasurement']={'maximumBoneDegrees':round(float(np.degrees(np.max(angles(rot[0],rot[-1])))),6),'rootDistance':round(float(np.linalg.norm(root[-1]-root[0])),7)}
        clips[name]=info
        print(f"PACKED {name}: seed{manifest['seed']}, {len(root)}frames, {info['speed']:.3f}m/s, contacts{info.get('contactMeasurement',{})}",flush=True)
    output={'source':'Fresh local Kimodo SOMA RP v1.1 / Guardiao heavyweight direction','fps':FPS,'skeleton':sk,'guardianMotion':{'version':1,'style':'heavy planted predatory Guardiao; broad stance and spread bent arms','generator':'tools/generate-guardian-motion.py','candidateReport':'tools/kimodo_guardiao/candidate-review.json','nativeLog':'tools/kimodo_guardiao/native-generation.log','model':processed[next(iter(processed))][2]['models']['motionModel'],'textModel':processed[next(iter(processed))][2]['models']['textModel'],'contactMethod':'real FK ankle, ToeBase and oriented heel sole height baselines plus horizontal world velocities, circular threeframe smoothing','preservedGameplayXZ':['inspect','attack','roar','recoil','pain'],'originalPackSha256':digest(root_path/'.unlazy/guardian-motion/original-creature.json')},'clips':clips}
    review={'selected':{name:key for name,(_,key) in selected.items()},'candidates':reports,'notes':['Candidate scores use actual generated FK, full forward/back leg excursions, both feet swinging and at least two switches of the leading leg.',f"Walk compares {len(reports['walk'])} fresh seeds, run {len(reports['run'])}, creep {len(reports['creep'])}; stalk, limp and crawl each compare two.",'The final quarter seam correction preserves the extracted full alternating cycle.','One-shot rootXZ envelopes alone are intentionally preserved for gameplay compatibility; new local rotations and hipY are Kimodo output.']}
    def atomic(path,obj):
        temp=path.with_suffix(path.suffix+'.tmp');temp.write_text(json.dumps(obj,separators=(',',':')),encoding='utf-8');temp.replace(path)
    atomic(store/'candidate-review.json',review)
    atomic(root_path/'assets/anim/creature.json',output)

