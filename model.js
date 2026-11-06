import {isLocked,isVictory,chooseExit,dependencies,moveGroup,groupBlockers,bombState,switchProtected} from './engine.js';
export const DEFAULT_SETTINGS={sound:true,haptic:true,dark:false,dots:false,challenge:false};
export function newRun(level,timed=false,rules='current'){return {level,rules,rulesRevision:2,removed:[],history:[],lives:3,hints:3,mistakes:0,elapsed:0,timed,outcome:'playing'};}
export function rulesFor(level,run){return run.rules==='classic'?{...level,mode:'classic',...(['bomb','gates'].includes(level.mode)?{name:'Grand Maze'}:{})}:level;}
export function getSafeArrow(level,run){return chooseExit(rulesFor(level,run),new Set(run.removed));}
export function progressOf(level,run){
 const active=rulesFor(level,run),removed=new Set(run.removed);
 if(active.mode==='golden'){const required=dependencies(active,active.goalId);required.add(active.goalId);return Math.round([...required].filter(id=>removed.has(id)).length/required.size*100);}
 return Math.round(removed.size/active.arrows.length*100);
}
export function move(level,run,id){
 if(run.outcome!=='playing'||run.removed.includes(id))return {kind:'ignored',run};
 level=rulesFor(level,run);if(switchProtected(level,id,new Set(run.removed)))return {kind:'gate-order',run};if(isLocked(level,id,new Set(run.removed)))return {kind:'locked',run};
 const a=level.arrows.find(a=>a.id===id);if(!a)return {kind:'ignored',run};
 const impacts=groupBlockers(level,id,new Set(run.removed)),hits=[...new Set(impacts.flatMap(entry=>entry.hits))];
 if(hits.length){const lives=run.lives-1;return {kind:'blocked',hits,blockedIds:impacts.map(entry=>entry.id),run:{...run,lives,mistakes:run.mistakes+1,outcome:lives===0?'lost':'playing'}};}
 const ids=moveGroup(level,id),removed=[...run.removed,...ids],exploded=bombState(level,new Set(removed)).exploded;return {kind:'escaped',ids,run:{...run,removed,history:[...run.history,ids.length>1?[...ids]:id],outcome:exploded?'lost':isVictory(level,new Set(removed))?'won':'playing'}};
}
export function undo(run){if(run.outcome!=='playing'||!run.history.length)return run;const last=run.history.at(-1),ids=Array.isArray(last)?last:[last];return {...run,removed:run.removed.filter(x=>!ids.includes(x)),history:run.history.slice(0,-1)};}
export function shouldNudge(run,idleSeconds,guided=false){return run.outcome==='playing'&&run.hints>0&&!guided&&idleSeconds>=12;}
const int=(value,min,max,fallback)=>Number.isInteger(value)&&value>=min&&value<=max?value:fallback;
export function restoreProfile(raw,levels){
 const result={version:3,unlocked:1,current:1,guideSteps:0,results:{},settings:{...DEFAULT_SETTINGS},run:null};
 if(!raw||typeof raw!=='object'||![1,2,3].includes(raw.version))return result;
 const legacy=raw.version===1,mapLevel=n=>legacy?Math.max(1,levels.findIndex(l=>l.legacyIndex===n)+1):n;
 for(const key of Object.keys(DEFAULT_SETTINGS))if(typeof raw.settings?.[key]==='boolean')result.settings[key]=raw.settings[key];
 const oldMax=legacy?60:levels.length,oldUnlocked=int(raw.unlocked,1,oldMax,1),oldCurrent=int(raw.current,1,oldUnlocked,1);
 result.unlocked=mapLevel(oldUnlocked);result.current=mapLevel(oldCurrent);result.guideSteps=legacy?2:int(raw.guideSteps,0,2,0);
 for(const[key,value]of Object.entries(raw.results||{})){if(int(Number(key),1,oldMax,0)&&value&&typeof value==='object')result.results[mapLevel(Number(key))]={stars:int(value.stars,1,3,1),elapsed:Number.isFinite(value.elapsed)&&value.elapsed>=0?value.elapsed:0};}
 const r=raw.run,level=levels[result.current-1];
 if(r&&r.level===oldCurrent&&Array.isArray(r.removed)){
  const rules=raw.version<3||r.rules==='classic'||(['bomb','gates'].includes(level.mode)&&r.rulesRevision!==2)?'classic':'current';
  const valid=new Set(level.arrows.map(a=>a.id));let removed=[...new Set(r.removed.filter(x=>valid.has(x)))];
  if(level.mode==='mirror'&&rules!=='classic')removed=removed.filter(id=>moveGroup(level,id).every(key=>removed.includes(key)));
  const lives=int(r.lives,0,3,3),seen=new Set(),history=[];
  for(const entry of Array.isArray(r.history)?r.history:removed){const group=Array.isArray(entry)?entry:[entry];if(group.some(id=>!removed.includes(id)||seen.has(id)))continue;if(level.mode==='mirror'&&rules!=='classic'){const pair=moveGroup(level,group[0]);if(pair.length!==2||!pair.every(id=>removed.includes(id)))continue;history.push([...pair]);pair.forEach(id=>seen.add(id));}else{history.push(group[0]);seen.add(group[0]);}}
  const active=rulesFor(level,{rules});result.run={...newRun(result.current,!!r.timed,rules),removed,history,lives,hints:int(r.hints,0,3,3),mistakes:int(r.mistakes,0,10000,3-lives),elapsed:Number.isFinite(r.elapsed)&&r.elapsed>=0?Math.min(r.elapsed,864000):0,outcome:lives===0||bombState(active,new Set(removed)).exploded?'lost':isVictory(active,new Set(removed))?'won':'playing'};
 }
 // A never-started old profile can experience the new gentle introduction immediately.
 if(legacy&&oldUnlocked===1&&!Object.keys(result.results).length&&!result.run?.removed.length&&!result.run?.mistakes){result.current=1;result.run=null;result.guideSteps=0;}
 return result;
}
/** Derive the home screen from earned results and the current saved attempt. */
export function homeSnapshot(profile,total){
 const completed=Object.keys(profile.results).length,stars=Object.values(profile.results).reduce((n,r)=>n+r.stars,0),current=Math.min(total,Math.max(1,profile.current));
 const saved=profile.run,won=saved?.level===current&&saved.outcome==='won';
 const resumeLevel=won&&current<total?Math.min(current+1,profile.unlocked):current;
 const resume=saved?.level===resumeLevel&&saved.outcome==='playing';
 return {completed,stars,resumeLevel,restart:!resume,inProgress:!!resume&&(saved.removed.length>0||saved.mistakes>0||saved.elapsed>1),progress:Math.round(completed/total*100),allComplete:completed===total};
}
export function starGain(previous,current){return Math.max(0,Math.min(3,Math.max(0,current))-Math.min(3,Math.max(0,previous||0)));}
