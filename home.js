import {homeSnapshot} from './model.js';
/** Home presentation; progress remains owned by the game model. */
export function createHomeUI(options){
 const $=id=>document.getElementById(id),reduced=matchMedia('(prefers-reduced-motion: reduce)');let effects=[],tipIndex=0;
 const tips=['Every arrow has a way out.','Trace the arrowhead. Then tap!','One clear path opens another.','Gold is the goal. Find its way out.','Find the key. Open a new path.'];
 const adventureTips=['Bomb at 7. Switch Gates at 10.','Match the number. Check both exits.','Tap an ice shell to reveal its paths.','Defuse first. Then clear the maze.','Pinch to zoom into a crowded maze.'];
 const colorTips=['Clear blue. Then yellow. Then red.','B, Y and R mark each color.','A locked-color tap costs no heart.','Check the path ahead of each arrow.','Undo can bring an earlier color back.'];
 function visible(){return options.isVisible()&&!document.hidden;}
 function tip(manual=false){if(!visible())return;tipIndex=(tipIndex+1)%tips.length;$('homeTip').textContent=(options.getState().selectedMode==='adventure'?adventureTips:options.getState().selectedMode==='color'?colorTips:tips)[tipIndex];if(!reduced.matches){$('homeTip').animate([{opacity:0,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:250});if(manual)$('mascotButton').animate([{transform:'scale(1)'},{transform:'scale(1.06)'},{transform:'scale(1)'}],{duration:350});}if(manual)options.onNote();}
 function syncSound(){const enabled=options.getState().profile.settings.sound;$('homeSound').innerHTML=$('sound').innerHTML;$('homeSound').setAttribute('aria-pressed',String(enabled));$('homeSound').setAttribute('aria-label',`Turn sound ${enabled?'off':'on'}`);}
 function clearEffects(){effects.forEach(a=>a.cancel());effects=[];document.querySelectorAll('.home-star-flight').forEach(n=>n.remove());}
 function collectStars(delta,total){
  clearEffects();if(delta<=0||reduced.matches){$('homeStars').textContent=total;return;}
  const target=$('homeStarPill').getBoundingClientRect(),origin=$('mascotButton').getBoundingClientRect(),count=Math.min(delta,8),start=total-delta;
  $('homeStars').textContent=start;
  for(let i=0;i<count;i++){const n=document.createElement('i');n.className='home-star-flight';n.textContent='★';const x=origin.left+origin.width/2+(i-count/2)*10,y=origin.top+origin.height*.55;n.style.left=`${x}px`;n.style.top=`${y}px`;document.body.append(n);
   const a=n.animate([{transform:'translate(0,0) scale(.6)',opacity:0},{transform:'translate(0,-15px) scale(1.15)',opacity:1,offset:.2},{transform:`translate(${target.left+target.width/2-x}px,${target.top+target.height/2-y}px) scale(.5)`,opacity:0}],{duration:650,delay:i*95,easing:'cubic-bezier(.3,.1,.3,1)',fill:'both'});effects.push(a);
   a.onfinish=()=>{$('homeStars').textContent=Math.min(total,start+Math.ceil(delta*(i+1)/count));if(i===count-1)$('homeStarPill').animate([{transform:'scale(1)'},{transform:'scale(1.12)'},{transform:'scale(1)'}],{duration:280});};a.finished.catch(()=>{}).finally(()=>n.remove());
  }
 }
 function render(pendingStars=0){
  const{profile,levels,run,selectedMode,campaigns}=options.getState(),stats=homeSnapshot(profile,levels.length),target=levels[stats.resumeLevel-1];
  for(const mode of ['adventure','original','color']){const id=mode==='adventure'?'Adventure':mode==='color'?'Color':'Original',button=$('mode'+id),campaign=campaigns[mode],h=homeSnapshot(campaign.profile,campaign.levels.length),selected=mode===selectedMode;button.classList.toggle('selected',selected);button.setAttribute('aria-pressed',String(selected));$(mode+'ModeProgress').textContent=`${h.completed} / ${campaign.levels.length} cleared · Level ${h.resumeLevel}`;}
  $('homeTip').textContent=(selectedMode==='adventure'?adventureTips:selectedMode==='color'?colorTips:tips)[tipIndex];
  $('originalFeatures').hidden=selectedMode!=='original';$('homeColorGuide').hidden=selectedMode!=='color';$('homeAdventureGuide').hidden=selectedMode!=='adventure';$('homeJourneyLabel').textContent=selectedMode==='adventure'?'YOUR ADVENTURE':selectedMode==='color'?'COLOR ORDER JOURNEY':'ORIGINAL JOURNEY';$('homeStartText').textContent=selectedMode==='adventure'?'START ADVENTURE':selectedMode==='color'?'START COLORS':'START ORIGINAL';$('homeStart').setAttribute('aria-label',`Start ${selectedMode==='adventure'?'Adventure':selectedMode==='color'?'Color Order':'Original Game'}, Level ${stats.resumeLevel}`);
  $('adventurePreview').textContent=selectedMode==='adventure'?`${target.name} · ${target.difficulty} · World ${target.world} of 10`:'Longer paths. Clever pairs. Ice to break.';
  $('homeLevel').textContent=`Level ${stats.resumeLevel}`;$('homeCleared').textContent=`${stats.completed} / ${levels.length} cleared`;$('homeProgressFill').style.width=`${stats.progress}%`;$('homeProgressTrack').setAttribute('aria-valuenow',stats.progress);
  $('homeStarPill').setAttribute('aria-label',`${stats.stars} stars collected`);$('homeStars').textContent=stats.stars;
  const savedClassic=run.rules==='classic'&&['bomb','gates'].includes(target.mode);
  $('homeResumeCaption').textContent=savedClassic?`Resume Level ${stats.resumeLevel} · Saved Grand Maze rules`:stats.allComplete?'Every path conquered. Choose a favorite to replay.':stats.inProgress?`Resume Level ${stats.resumeLevel} · ${target.arrows.length-run.removed.length} arrows left`:`Level ${stats.resumeLevel} · ${target.name}`;
  for(const[kind,threshold]of [['gold',3],['key',6]]){const unlocked=profile.unlocked>=threshold,card=$(kind==='gold'?'homeGolden':'homeKeys');card.classList.toggle('feature-unlocked',unlocked);$(kind+'FeatureStatus').textContent=unlocked?`Play Level ${threshold}`:`Unlocks at Level ${threshold}`;$(kind+'FeatureState').textContent=unlocked?'↗':'⌑';card.setAttribute('aria-label',`${kind==='gold'?'Golden Arrow':'Key and Lock'}, ${unlocked?'play':'unlocks at'} Level ${threshold}`);}
  syncSound();for(const id of ['homeStart','homeHelp','homeSound','homeSettings','homeJourney','homeGolden','homeKeys','mascotButton','modeOriginal','modeColor','modeAdventure'])$(id).disabled=false;$('homeScreen').setAttribute('aria-busy','false');
  requestAnimationFrame(()=>{if(visible())collectStars(pendingStars,stats.stars);});
 }
 async function launch(){
  clearEffects();if(reduced.matches)return;$('homeScreen').classList.add('home-leaving');const overlay=$('launchTransition');overlay.hidden=false;overlay.classList.add('launching');
  const a=overlay.animate([{opacity:0},{opacity:1,offset:.16},{opacity:1,offset:.78},{opacity:0}],{duration:650,fill:'both'});try{await a.finished;}catch{}finally{overlay.hidden=true;overlay.classList.remove('launching');$('homeScreen').classList.remove('home-leaving');a.cancel();}
 }
 $('modeAdventure').onclick=()=>options.onMode('adventure');$('modeOriginal').onclick=()=>options.onMode('original');$('modeColor').onclick=()=>options.onMode('color');
 $('homeStart').onclick=()=>options.onStart();$('homeHelp').onclick=options.onHelp;$('homeSound').onclick=options.onSound;$('homeSettings').onclick=options.onSettings;$('homeJourney').onclick=options.onLevels;$('homeGolden').onclick=()=>options.onFeature('golden');$('homeKeys').onclick=()=>options.onFeature('keys');$('mascotButton').onclick=()=>tip(true);
 $('homeScreen').addEventListener('pointerdown',e=>{if(e.target.closest('button,a')||!visible()||reduced.matches)return;const box=$('homeScreen').getBoundingClientRect(),n=document.createElement('i');n.className='home-ripple';n.style.left=`${e.clientX-box.left}px`;n.style.top=`${e.clientY-box.top}px`;$('homeScreen').append(n);const a=n.animate([{transform:'translate(-50%,-50%) scale(.2)',opacity:.6},{transform:'translate(-50%,-50%) scale(8)',opacity:0}],{duration:650,easing:'ease-out',fill:'forwards'});a.finished.catch(()=>{}).finally(()=>n.remove());});
 setInterval(()=>tip(),8000);return{render,launch,syncSound,clearEffects};
}
