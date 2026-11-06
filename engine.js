/** Pure, deterministic puzzle rules. Coordinates are integer grid intersections. */
export const VERSION = 3;
export const pointKey = ([x,y]) => `${x},${y}`;
export function expandPath(points) {
  const out=[points[0]];
  for(let i=1;i<points.length;i++) {
    const [x,y]=out[out.length-1], [tx,ty]=points[i];
    if(x!==tx&&y!==ty) throw new Error('A path segment must be orthogonal');
    const dx=Math.sign(tx-x),dy=Math.sign(ty-y),length=Math.abs(tx-x)+Math.abs(ty-y);
    for(let s=1;s<=length;s++) out.push([x+dx*s,y+dy*s]);
  }
  return out;
}
export function direction(arrow) {
  const p=arrow.points, a=p[p.length-2], b=p[p.length-1];
  return [Math.sign(b[0]-a[0]),Math.sign(b[1]-a[1])];
}
export function blockers(arrow, arrows, removed=new Set()) {
  const [hx,hy]=arrow.points.at(-1), [dx,dy]=direction(arrow);
  const hits=[];
  for(const other of arrows) {
    if(other.id===arrow.id||removed.has(other.id)) continue;
    for(const [x,y] of (other.cells||expandPath(other.points))) {
      if((dx&&y===hy&&(x-hx)*dx>0)||(dy&&x===hx&&(y-hy)*dy>0)) {hits.push(other.id);break;}
    }
  }
  return hits;
}
export const COLOR_ORDER=['blue','yellow','red'];
export function activeColor(level,removed=new Set()) {return COLOR_ORDER.find(color=>level.arrows.some(a=>a.color===color&&!removed.has(a.id)))||null;}
export function iceState(level,id,removed=new Set()) {
 const keys=level.arrows.find(a=>a.id===id)?.iceKeys||[],missing=keys.filter(key=>!removed.has(key));
 return {total:keys.length,remaining:missing.length,cracks:keys.length-missing.length,missing};
}
export function bombState(level,removed=new Set()) {
 const armed=level.mode==='bomb',defused=armed&&removed.has(level.bombId),remaining=armed?Math.max(0,level.bombMoves-removed.size):0;
 return {armed,defused,remaining,exploded:armed&&!defused&&remaining===0};
}
export function gateState(level,removed=new Set()) {
 const switches=level.switchIds||[],used=switches.filter(id=>removed.has(id)).length,phase=used%2?'B':'A';
 return {phase,used,switchesLeft:switches.length-used,open:(level.gates||[]).filter(g=>g.group===phase&&!removed.has(g.id)).map(g=>g.id)};
}
export function switchProtected(level,id,removed=new Set()) {
 if(level.mode!=='gates'||!level.switchIds.includes(id)||removed.has(id))return false;
 const state=gateState(level,removed);return state.switchesLeft===1&&state.open.length>0;
}
export function moveGroup(level,id){return level.mode==='mirror'?(level.pairs.find(pair=>pair.includes(id))||[id]):[id];}
export function groupBlockers(level,id,removed=new Set()) {
 return moveGroup(level,id).filter(key=>!removed.has(key)).map(key=>({id:key,hits:blockers(level.arrows.find(a=>a.id===key),level.arrows,removed)})).filter(entry=>entry.hits.length);
}
export function isLocked(level,id,removed=new Set()) {
 if(level.mode==='color')return level.arrows.find(a=>a.id===id)?.color!==activeColor(level,removed);
 if(level.mode==='ice')return iceState(level,id,removed).remaining>0;
 if(level.mode==='gates'){const gate=level.gates.find(g=>g.id===id);return !!gate&&gate.group!==gateState(level,removed).phase;}
 return level.mode==='keys'&&id===level.lockId&&!removed.has(level.keyId);
}
export function isVictory(level,removed) {return level.mode==='golden'?removed.has(level.goalId):removed.size===level.arrows.length;}
/** All remaining paths that must escape before a particular target can leave. */
export function dependencies(level,id,removed=new Set()) {
 const result=new Set(),visited=new Set();
 function visit(target){if(visited.has(target))return;visited.add(target);const a=level.arrows.find(a=>a.id===target);if(!a)return;for(const b of blockers(a,level.arrows,removed)){result.add(b);visit(b);}}
 visit(id);return result;
}
export function legalArrows(level,removed=new Set()) {if(bombState(level,removed).exploded)return [];return level.arrows.filter(a=>!removed.has(a.id)&&!isLocked(level,a.id,removed)&&!switchProtected(level,a.id,removed)&&!(level.mode==='mirror'?groupBlockers(level,a.id,removed).length:blockers(a,level.arrows,removed).length));}
export function chooseExit(level,removed=new Set()) {
 const bomb=bombState(level,removed);if(bomb.armed&&!bomb.defused&&dependencies(level,level.bombId,removed).size+1>bomb.remaining)return null;
 const safe=legalArrows(level,removed);if(!safe.length)return null;
 let target=level.mode==='golden'?level.goalId:level.mode==='bomb'&&!removed.has(level.bombId)?level.bombId:level.mode==='keys'&&!removed.has(level.keyId)?level.keyId:null;
 if(level.mode==='gates'){
  const state=gateState(level,removed),open=safe.find(a=>state.open.includes(a.id));if(open)return open;
  if(level.gates.some(g=>!removed.has(g.id))){const switches=level.switchIds.filter(id=>!removed.has(id));switches.sort((a,b)=>dependencies(level,a,removed).size-dependencies(level,b,removed).size);target=switches[0]||null;}
 }
 if(level.mode==='keys'&&removed.has(level.keyId)){const lock=safe.find(a=>a.id===level.lockId);if(lock)return lock;}
 if(target&&!removed.has(target)){const direct=safe.find(a=>a.id===target);if(direct)return direct;const needed=dependencies(level,target,removed),helpful=safe.find(a=>needed.has(a.id));if(helpful)return helpful;}
 return safe[0];
}
export function solve(level,initialRemoved=[]) {
 const removed=new Set(initialRemoved),order=[];
 while(!isVictory(level,removed)){const a=chooseExit(level,removed);if(!a)return null;for(const id of moveGroup(level,a.id)){removed.add(id);order.push(id);}}
 return order;
}
export function validate(level) {
  const used=new Map(), ids=new Set();
  for(const a of level.arrows) {
    if(ids.has(a.id))throw new Error(`Duplicate id ${a.id}`);ids.add(a.id);
    const cells=expandPath(a.points), local=new Set();
    if(cells.length<2)throw new Error('Arrow too short');
    for(const p of cells) {
      const k=pointKey(p);
      if(p.some(n=>!Number.isInteger(n)||n<0||n>=level.size))throw new Error(`Out of bounds ${a.id}: ${k}`);
      if(local.has(k))throw new Error(`Self crossing ${a.id}: ${k}`);local.add(k);
      if(used.has(k))throw new Error(`Overlap ${a.id} with ${used.get(k)}: ${k}`);used.set(k,a.id);
    }
  }
  if(level.mode&&!['classic','golden','keys','color','mirror','ice','bomb','gates'].includes(level.mode))throw new Error('Unknown game mode');
  if(level.mode==='bomb'&&(!ids.has(level.bombId)||!Number.isInteger(level.bombMoves)||level.bombMoves<1||level.bombMoves>level.arrows.length))throw new Error('Invalid bomb objective');
  if(level.mode==='gates'){
   const gates=level.gates,switches=level.switchIds;
   if(!Array.isArray(gates)||gates.length<2||!Array.isArray(switches)||switches.length<2||new Set(switches).size!==switches.length||new Set(gates.map(g=>g.id)).size!==gates.length||!['A','B'].every(group=>gates.some(g=>g.group===group)))throw new Error('Invalid gate groups');
   const gated=new Set(gates.map(g=>g.id));
   if(gates.some(g=>!ids.has(g.id)||!['A','B'].includes(g.group)||blockers(level.arrows.find(a=>a.id===g.id),level.arrows).length)||switches.some(id=>!ids.has(id)||gated.has(id)||[...dependencies(level,id)].some(key=>gated.has(key))))throw new Error('Unsafe gate dependencies');
  }
  if(level.mode==='mirror'){
   const paired=new Set();if(!Array.isArray(level.pairs))throw new Error('Missing mirror pairs');
   for(const pair of level.pairs){if(pair.length!==2||pair.some(id=>!ids.has(id)||paired.has(id))||pair[0]===pair[1])throw new Error('Invalid mirror pair');pair.forEach(id=>paired.add(id));const[a,b]=pair.map(id=>direction(level.arrows.find(a=>a.id===id)));if(a[0]!==-b[0]||a[1]!==-b[1])throw new Error('Mirror directions must be opposite');}
   if(paired.size!==ids.size)throw new Error('Unpaired mirror arrow');
  }
  if(level.mode==='ice')for(const a of level.arrows){if(a.iceKeys&&(![2,3].includes(a.iceKeys.length)||new Set(a.iceKeys).size!==a.iceKeys.length||a.iceKeys.some(id=>id===a.id||!ids.has(id))))throw new Error('Invalid ice triggers');}
  if(level.mode==='color'){
   if(level.arrows.some(a=>!COLOR_ORDER.includes(a.color))||COLOR_ORDER.some(color=>!level.arrows.some(a=>a.color===color)))throw new Error('Invalid color phases');
   for(const a of level.arrows)for(const id of blockers(a,level.arrows))if(COLOR_ORDER.indexOf(level.arrows.find(b=>b.id===id).color)>COLOR_ORDER.indexOf(a.color))throw new Error('Color order dependency is blocked by a later phase');
  }
  if(level.mode==='golden'&&!ids.has(level.goalId))throw new Error('Missing golden objective');
  if(level.mode==='keys'&&(!ids.has(level.keyId)||!ids.has(level.lockId)||level.keyId===level.lockId))throw new Error('Invalid key-lock pair');
  if(!solve({...level,mode:'classic'})||!solve(level))throw new Error('Unsolvable board');
  return true;
}
export function rng(seed) {return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return ((t^t>>>14)>>>0)/4294967296;};}
const DIRS=[[1,0],[-1,0],[0,1],[0,-1]];
function compress(cells) {
  return cells.filter((p,i)=>i===0||i===cells.length-1||((p[0]-cells[i-1][0])!==(cells[i+1][0]-p[0]))||((p[1]-cells[i-1][1])!==(cells[i+1][1]-p[1])));
}
/** Reverse construction: every added arrow can escape past all earlier arrows. */
export function generateLevel(seed,size=23,target=42,mask=null,options={}) {
  const random=rng(seed), occupied=new Set(), arrows=[];
  const inside=([x,y])=>x>=0&&y>=0&&x<size&&y<size;
  for(let index=0;index<target;index++) {
    let best=null,bestScore=-Infinity;
    for(let attempt=0;attempt<280;attempt++) {
      const head=[Math.floor(random()*size),Math.floor(random()*size)],d=options.headDirections?options.headDirections[index%options.headDirections.length]:DIRS[Math.floor(random()*4)];
      if(!inside(head)||(mask&&!mask(...head))||occupied.has(pointKey(head)))continue;
      const onRay=([x,y])=>(d[0]&&y===head[1]&&(x-head[0])*d[0]>0)||(d[1]&&x===head[0]&&(y-head[1])*d[1]>0);
      let clear=true;
      for(let p=[head[0]+d[0],head[1]+d[1]];inside(p);p=[p[0]+d[0],p[1]+d[1]])if(occupied.has(pointKey(p))){clear=false;break;}
      if(!clear)continue;
      const cells=[head],local=new Set([pointKey(head)]), desired=(options.minLength||5)+Math.floor(random()*(options.lengthRange||10));
      let last=[-d[0],-d[1]],turns=0;
      while(cells.length<desired) {
        const p=cells.at(-1);
        let choices=DIRS.filter(v=>{
          if(cells.length===1&&(v[0]!==last[0]||v[1]!==last[1]))return false;
          const next=[p[0]+v[0],p[1]+v[1]],k=pointKey(next);
          return inside(next)&&(!mask||mask(...next))&&!occupied.has(k)&&!local.has(k)&&!onRay(next);
        });
        if(!choices.length)break;
        const straight=choices.find(v=>v[0]===last[0]&&v[1]===last[1]);
        const v=straight&&random()<.74?straight:choices[Math.floor(random()*choices.length)];
        if(v[0]!==last[0]||v[1]!==last[1])turns++;
        const next=[p[0]+v[0],p[1]+v[1]];cells.push(next);local.add(pointKey(next));last=v;
      }
      if(cells.length<(options.minAccepted||5))continue;
      const points=compress([...cells].reverse());
      let score=12-Math.abs(cells.length-(options.preferredLength||9))+Math.min(turns,4);
      // Prefer new paths that turn earlier exits into meaningful dependencies.
      for(const a of arrows) {
        const [hx,hy]=a.points.at(-1),[dx,dy]=direction(a);
        if(cells.some(([x,y])=>(dx&&y===hy&&(x-hx)*dx>0)||(dy&&x===hx&&(y-hy)*dy>0)))score+=2;
      }
      if(score>bestScore){bestScore=score;best={id:`a${index}`,points,cells};}
    }
    if(!best)break;
    for(const p of best.cells)occupied.add(pointKey(p));
    arrows.push(best);
  }
  return {size,arrows:arrows.map(({id,points})=>({id,points}))};
}

/** Distance in cells from the head to the nearest remaining blocker, or Infinity. */
export function collisionDistance(arrow,arrows,removed=new Set()) {
 const [hx,hy]=arrow.points.at(-1),[dx,dy]=direction(arrow);let distance=Infinity;
 for(const other of arrows){if(other.id===arrow.id||removed.has(other.id))continue;
  for(const[x,y]of(other.cells||expandPath(other.points))){if(dx&&y===hy&&(x-hx)*dx>0)distance=Math.min(distance,Math.abs(x-hx));if(dy&&x===hx&&(y-hy)*dy>0)distance=Math.min(distance,Math.abs(y-hy));}}
 return distance;
}
/** Sample a constant-length snake as its head advances beyond the existing bends. */
export function motionRoute(points,d,extension=3000){
 const last=points.at(-1),route=[...points,[last[0]+d[0]*extension,last[1]+d[1]*extension]],lengths=[0];
 for(let i=1;i<route.length;i++)lengths.push(lengths.at(-1)+Math.hypot(route[i][0]-route[i-1][0],route[i][1]-route[i-1][1]));
 const length=lengths.at(-2);
 const pointAt=distance=>{let i=1;while(i<lengths.length-1&&lengths[i]<distance)i++;const f=(distance-lengths[i-1])/(lengths[i]-lengths[i-1]);return[route[i-1][0]+(route[i][0]-route[i-1][0])*f,route[i-1][1]+(route[i][1]-route[i-1][1])*f];};
 return{length,slice(distance){const parts=[pointAt(distance)];for(let i=1;i<route.length;i++)if(lengths[i]>distance&&lengths[i]<distance+length)parts.push(route[i]);parts.push(pointAt(distance+length));return parts;}};
}
