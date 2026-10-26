"""Render retained native candidates, including honest rejected comparisons."""
from pathlib import Path
import json
import numpy as np
from PIL import Image,ImageDraw
import pack

ROOT=Path(__file__).resolve().parents[2]
STORE=ROOT/'tools/kimodo_skinwalker'
data=json.loads((ROOT/'assets/anim/creature.json').read_text())
review=json.loads((STORE/'candidate-review.json').read_text())
sk=data['skeleton']
for group in [('walk','run'),('creep','stalk','crawl','doorway')]:
    rows=[(name,c) for name in group for c in review['candidates'][name]]
    canvas=Image.new('RGB',(1500,170*len(rows)+35),(18,24,27));draw=ImageDraw.Draw(canvas)
    draw.text((12,7),'Native candidate comparison. Rejected clips remain visible. Source control bones only; source metres.',fill=(230,238,241))
    for row,(name,candidate) in enumerate(rows):
        directory=ROOT/candidate['rawDirectory']
        r,q,_=pack.align(*pack.load(directory,sk),sk,name)
        p,_=pack.fk(r,q,sk);p[:,:,[0,2]]-=r[:,None,[0,2]]
        chosen=review['selected'][name]==directory.name
        label=f'{name} s{candidate["seed"]} '+('SELECTED' if chosen else 'REJECTED' if 'rejected' in candidate else 'COMPARED')
        if 'best' in candidate:
            best=candidate['best'];first,last=best['range'];label+=f' | {best["speed"]:.2f}m/s hunch{best["performance"]["meanHunchDegrees"]:.1f}deg'
        else:first,last=25,min(len(r)-1,180)
        top=35+row*170;base=top+150;draw.text((12,top),label,fill=(133,237,165) if chosen else (237,158,128) if 'rejected' in candidate else (223,222,191))
        for col,phase in enumerate([.02,.20,.38,.56,.74,.92]):
            frame=round(first+(last-first-1)*phase);center=150+col*225
            for view,shift in [(0,-50),(2,50)]:
                xy=[(center+shift+point[view]*64,base-point[1]*64) for point in p[frame]]
                draw.line((center+shift-46,base,center+shift+46,base),fill=(68,99,112))
                for j,parent in enumerate(sk['parents']):
                    if parent<0:continue
                    n=sk['names'][j];color=(101,214,163) if n.startswith('Left') else (240,132,109) if n.startswith('Right') else (236,210,110)
                    draw.line((*xy[parent],*xy[j]),fill=color,width=2)
    canvas.save(STORE/('candidate-'+('-'.join(group))+'.png'))
