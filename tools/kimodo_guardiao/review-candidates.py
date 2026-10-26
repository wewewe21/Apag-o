"""Print candidate metrics without waiting for or mutating GPU generation."""
import json
from pathlib import Path
import pack
root=Path(__file__).resolve().parents[2]
sk=json.loads((root/'.unlazy/guardian-motion/original-creature.json').read_text())['skeleton']
for directory in sorted((root/'tools/kimodo_guardiao/raw').iterdir()):
    if not (directory/'generation.json').exists():continue
    name=directory.name.split('_s')[0]
    r,q=pack.load(directory,sk);r,q,_=pack.align(r,q,sk,name)
    if name in pack.LOCOMOTION:
        try:best,_=pack.loop_options(name,r,q,sk);print(directory.name,json.dumps(best),flush=True)
        except ValueError as error:print(directory.name,'REJECTED',error,flush=True)
