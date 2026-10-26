"""Render actual selected control-skeleton poses for a visual production audit.

This is a bone-only diagnostic. Final proportions/materials and IK are reviewed
on the real imported Guardiao by the root browser gate.
"""
from pathlib import Path
import base64
import json
import numpy as np
from PIL import Image,ImageDraw
import pack
ROOT=Path(__file__).resolve().parents[2]
data=json.loads((ROOT/'assets/anim/creature.json').read_text())
groups=[['idle','walk','run','creep','stalk','limp','crawl'],['attack','roar','look','inspect','recoil','pain']]
for sheet,actions in enumerate(groups):
    image=Image.new('RGB',(1550,len(actions)*220),(18,24,27));draw=ImageDraw.Draw(image)
    draw.text((12,3),'Real fresh Kimodo control rig; front and side views. Blue grid=0.5m. Actual Guardiao adaptation reviewed separately.',fill=(235,239,243))
    for row,name in enumerate(actions):
        clip=data['clips'][name]
        root=np.frombuffer(base64.b64decode(clip['root']),dtype='<i2').astype(float).reshape(-1,3)/1000
        root[:,[0,2]]=0
        rot=np.frombuffer(base64.b64decode(clip['rot']),dtype='<i2').astype(float).reshape(-1,30,4)/32767
        points,_=pack.fk(root,pack.normalized(rot),data['skeleton'])
        draw.text((10,row*220+30),f"{name} | seed{clip['sourceMotion']['seed']} | {clip['frames']}f | speed{clip['speed']:.2f}",fill=(239,239,220))
        for col,phase in enumerate([.05,.23,.41,.59,.77,.95]):
            frame=round((clip['frames']-1)*phase)
            center=150+col*230;top=row*220+45;base=top+165;scale=74
            for view in [0,1]:
                shift=-52 if view==0 else 52
                axis=0 if view==0 else 2
                xy=[(center+shift+p[axis]*scale,base-p[1]*scale) for p in points[frame]]
                draw.line((center+shift-50,base,center+shift+50,base),fill=(68,99,112))
                for j,parent in enumerate(data['skeleton']['parents']):
                    if parent<0:continue
                    bone=data['skeleton']['names'][j]
                    color=(101,214,163) if bone.startswith('Left') else (240,132,109) if bone.startswith('Right') else (236,210,110)
                    draw.line((*xy[parent],*xy[j]),fill=color,width=3)
                draw.text((center+shift-20,top),('front' if view==0 else '+Z >'),fill=(130,160,170))
            draw.text((center-22,base+8),f'{phase:.2f}',fill=(195,213,225))
    image.save(ROOT/f'tools/kimodo_guardiao/pose-review-{sheet+1}.png')

