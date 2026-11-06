import {createHomeUI} from './home.js';
import {analytics} from './analytics.js';
import {direction,collisionDistance,motionRoute,isLocked,blockers,activeColor,COLOR_ORDER,iceState,moveGroup,bombState,gateState,switchProtected} from './engine.js';
import {newRun,getSafeArrow,move,undo,shouldNudge,rulesFor,progressOf,homeSnapshot,starGain} from './model.js';
import {readCampaigns,writeCampaign,MODE_SELECTION_KEY} from './modes.js';
const $=id=>document.getElementById(id),NS='http://www.w3.org/2000/svg';
let campaigns,selectedMode='adventure',levels,profile,run,level,busy=false,token=0,scale=1,pan={x:0,y:0},lastFocus,saveAvailable=true,view='home',homeUI=null,enteringHomeGame=false,pendingHomeStars=0;
let modalType='',hinted=null,flashTimer,toastTimer,audioContext,pointStep=28,idleSeconds=0,introAnimations=[];
const travelFrames=new Set(),travelResolvers=new Set();
const motion=matchMedia('(prefers-reduced-motion: reduce)'),elements=new Map();
const heart='<svg viewBox="0 0 24 24" class="heart" aria-hidden="true"><path d="M12 21s-9-5.6-9-12a5.1 5.1 0 0 1 9-3.4A5.1 5.1 0 0 1 21 9c0 6.4-9 12-9 12Z"/></svg>';
const fmt=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const svgNode=(tag,attrs)=>{const n=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))n.setAttribute(k,v);return n;};
const project=p=>[52+p[0]*pointStep,52+p[1]*pointStep];
const pathD=p=>p.map((v,i)=>`${i?'L':'M'}${v[0]},${v[1]}`).join(' ');
const timeLimit=()=>180+level.arrows.length*4;
function save(){if(!profile||!run)return;profile.run=run;try{writeCampaign(localStorage,selectedMode,profile);}catch{saveAvailable=false;}}
function say(text,error=false){clearTimeout(toastTimer);$('message').textContent=text;$('message').classList.toggle('error',error);if(error)toastTimer=setTimeout(()=>say('Look ahead of the arrowhead. Find a clear exit.'),3200);}
function vibrate(pattern){if(profile.settings.haptic&&navigator.vibrate)navigator.vibrate(pattern);}
function tone(kind){
 if(!profile.settings.sound)return;
 try{audioContext??=new(window.AudioContext||window.webkitAudioContext)();if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});const now=audioContext.currentTime;
 const notes=kind==='boom'?[110,65]:kind==='defuse'?[660,880,1046]:kind==='gate'?[330,440,660]:kind==='win'?[523,659,784]:kind==='ice'?[720,1120,1480]:kind==='unlock'?[440,660,880]:kind==='blocked'?[155,130]:[420,560];
 notes.forEach((hz,i)=>{const o=audioContext.createOscillator(),g=audioContext.createGain();o.type='sine';o.frequency.value=hz;g.gain.setValueAtTime(0,now+i*.085);g.gain.linearRampToValueAtTime(.045,now+i*.085+.012);g.gain.exponentialRampToValueAtTime(.001,now+i*.085+.14);o.connect(g);g.connect(audioContext.destination);o.start(now+i*.085);o.stop(now+i*.085+.15);});}catch{}
}
function applySettings(){document.body.classList.toggle('dark',profile.settings.dark);$('dotGrid').setAttribute('display',profile.settings.dots?'block':'none');$('sound').setAttribute('aria-pressed',String(profile.settings.sound));$('sound').setAttribute('aria-label',`Turn sound ${profile.settings.sound?'off':'on'}`);$('sound').innerHTML=profile.settings.sound?'<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5m4 3a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></svg>':'<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5m5 4 5 6m0-6-5 6"/></svg>';document.querySelector('meta[name="theme-color"]').content=profile.settings.dark?'#171a20':'#fafaf8';homeUI?.syncSound();}
function drawHead(node,p,d){const [x,y]=p,[dx,dy]=d,px=-dy,py=dx;node.setAttribute('points',`${x+dx*3},${y+dy*3} ${x-dx*12+px*7},${y-dy*12+py*7} ${x-dx*12-px*7},${y-dy*12-py*7}`);}
function renderBoard(){
 $('paths').replaceChildren();$('boardDecor').replaceChildren();$('pairLinks').replaceChildren();elements.clear();pointStep=616/(level.size-1);document.querySelector('#dots').setAttribute('width',pointStep);document.querySelector('#dots').setAttribute('height',pointStep);document.querySelector('#dots').setAttribute('x',52);document.querySelector('#dots').setAttribute('y',52);
 for(const a of level.arrows){if(run.removed.includes(a.id))continue;const points=a.points.map(project),d=direction(a),g=svgNode('g',{'class':'arrow','data-arrow':a.id,tabindex:'0',role:'button','aria-label':`Arrow ${Number(a.id.slice(1))+1}, points ${d[0]===1?'right':d[0]===-1?'left':d[1]===1?'down':'up'}. Press Enter to release.`});
 const hit=svgNode('path',{'class':'hit',d:pathD(points)}),line=svgNode('path',{'class':'line',d:pathD(points)}),head=svgNode('polygon',{'class':'arrowhead'});drawHead(head,points.at(-1),d);g.append(hit,line,head);g.addEventListener('click',e=>{if(e.detail===0)attempt(a.id);});g.addEventListener('pointerenter',()=>previewPair(a.id));g.addEventListener('pointerleave',()=>previewPair(null));g.addEventListener('focus',()=>previewPair(a.id));g.addEventListener('blur',()=>previewPair(null));$('paths').append(g);elements.set(a.id,{g,line,head,points,baseLabel:g.getAttribute('aria-label'),marker:null});}
 syncMechanics();
}
function updateStatus(deferHearts=false){
 const count=level.arrows.length-run.removed.length;$('remaining').textContent=level.mode==='mirror'?count/2:count;$('remainingUnit').textContent=level.mode==='mirror'?'pairs':'arrows';
 if(!deferHearts){$('hearts').innerHTML=heart.repeat(3);[...$('hearts').children].forEach((h,i)=>h.classList.toggle('lost',i>=run.lives));$('hearts').setAttribute('aria-label',`${run.lives} lives remaining`);}
 $('hintCount').textContent=run.hints;$('hint').disabled=run.hints===0||run.outcome!=='playing'||busy;$('undo').disabled=run.history.length===0||run.outcome!=='playing'||busy;
 const progress=progressOf(level,run);$('progress').style.width=`${progress}%`;document.querySelector('.progress-track').setAttribute('aria-valuenow',progress);updateClock();
}
function updateClock(){const remaining=run.timed?Math.max(0,timeLimit()-run.elapsed):run.elapsed;$('clock').textContent=fmt(remaining);$('clockLabel').textContent=run.timed?'TIME LEFT':'TAKE YOUR TIME';$('clock').style.color=run.timed&&remaining<30?'var(--heart)':'';}
function loadLevel(number,restart=false,present=true){
 token++;cancelTravel();introAnimations.forEach(a=>a.cancel());introAnimations=[];busy=false;clearTimeout(flashTimer);hinted=null;interaction();profile.current=number;level=levels[number-1];
 run=!restart&&profile.run?.level===number?profile.run:newRun(number,profile.settings.challenge);level=rulesFor(level,run);
 $('levelNumber').textContent=number;$('gameFootnote').textContent='A little focus. A clear way out.';$('app').classList.toggle('color-game',selectedMode==='color');$('app').classList.toggle('adventure-game',selectedMode==='adventure');$('app').classList.toggle('mirror-game',level.mode==='mirror');$('app').classList.toggle('ice-game',level.mode==='ice');$('app').classList.toggle('bomb-game',level.mode==='bomb');$('app').classList.toggle('gates-game',level.mode==='gates');$('chapter').textContent=selectedMode==='adventure'?`${level.name.toUpperCase()}`:level.mode==='color'?'COLOR ORDER':level.mode==='golden'?'GOLDEN ARROW':level.mode==='keys'?'KEY & LOCK':level.name.toUpperCase();document.title=`Level ${number} · Arrow Escape`;resetZoom();renderBoard();updateStatus();save();
 say(selectedMode==='adventure'?adventureInstruction():level.mode==='color'?colorInstruction():level.mode==='golden'?'Clear a path, then free the gold arrow. That is your goal.':level.mode==='keys'?'Find the key arrow. Release it to open the locked path.':run.rules==='classic'&&levels[number-1].mode?'Your saved attempt keeps its original rules. Restart to try the new challenge.':run.removed.length?'Welcome back. Your path is waiting.':level.shape?`A new ${level.shape} to untangle. One arrow at a time.`:'Tap a clear arrow. Let it find its way out.');
  if(present&&view==='game')analytics.levelStart({game_mode:selectedMode,level_number:number,level_name:level.name,puzzle_type:level.mode||'classic'});
  if(present){animateIntro();syncGuide();if(run.outcome==='won')showWin(false);else if(run.outcome==='lost')showLoss();}else if(run.outcome==='won')recordWin();
}
function clearHighlight(){clearTimeout(flashTimer);hinted=null;for(const{g}of elements.values())g.classList.remove('hinted','guided','blocked','obstacle','ice-trigger','pair-preview','gate-needed','switch-hint');$('guidance').replaceChildren();$('pairLinks').replaceChildren();$('coach').hidden=true;}
async function attempt(id){
 if(view!=='game'||busy||modalType||run.outcome!=='playing')return;const a=level.arrows.find(a=>a.id===id);if(!a)return;
 const guided=level.tutorial&&profile.guideSteps<2;unlockAudio();interaction();introAnimations.forEach(animation=>animation.cancel());introAnimations=[];clearHighlight();
 const previousRemoved=[...run.removed],previousColor=level.mode==='color'?activeColor(level,new Set(run.removed)):null,change=move(level,run,id);
 if(change.kind==='ignored')return;if(change.kind==='gate-order'){gateNotice(id,true);return;}if(change.kind==='locked'){lockedNotice(id);if(level.mode!=='ice')syncGuide();return;}
 run=change.run;busy=true;save();const group=moveGroup(level,id);if(level.mode==='mirror')previewPair(id);
 if(change.kind==='blocked'){
  (change.blockedIds||[id]).forEach(key=>elements.get(key)?.g.classList.add('blocked'));change.hits.forEach(key=>elements.get(key)?.g.classList.add('obstacle'));updateStatus(true);
  say(level.mode==='mirror'?'Both arrows need a clear exit. A blocked partner costs one heart.':'Another path is in the way. Follow the red arrow to find the obstruction.',true);
  const t=token;let impacted=false;const impact=()=>{if(impacted)return;impacted=true;updateStatus();heartPop(run.lives);tone('blocked');vibrate([25,35,25]);};
  await Promise.all((change.blockedIds||[id]).map(key=>animateBump(level.arrows.find(arrow=>arrow.id===key),impact)));
  if(t!==token)return;busy=false;updateStatus();if(run.outcome==='lost'){showLoss();return;}clearTimeout(flashTimer);flashTimer=setTimeout(()=>{clearHighlight();syncGuide();},800);return;
 }
 if(guided){profile.guideSteps=Math.min(2,profile.guideSteps+1);save();}
 updateStatus();tone('escape');vibrate(9);group.forEach(key=>positivePulse(level.arrows.find(arrow=>arrow.id===key)));
 say(level.mode==='mirror'?'In sync. Two paths, one escape.':profile.guideSteps===2&&guided?'You have got it! Now find the other clear paths.':run.removed.length%5===0?`${run.removed.length} arrows set free. Keep the flow going.`:'Nice! One clear path opens another.');
 const t=token;await Promise.all(group.map(key=>animateEscape(level.arrows.find(arrow=>arrow.id===key))));if(t!==token)return;
 busy=false;updateStatus();syncMechanics(a.id===level.keyId&&level.mode==='keys',previousColor,previousRemoved);syncGuide();
 if(run.outcome==='won')showWin(true);else if(run.outcome==='lost'){busy=true;if(bombState(level,new Set(run.removed)).exploded)await animateBombExplosion();if(t!==token)return;busy=false;showLoss();}else save();
}
function animateEscape(a){
 const entry=elements.get(a.id);if(!entry)return Promise.resolve();entry.g.classList.add('departing');entry.g.setAttribute('aria-hidden','true');entry.g.setAttribute('tabindex','-1');
 const d=direction(a),last=entry.points.at(-1),exit=d[0]===1?760-last[0]:d[0]===-1?last[0]+40:d[1]===1?760-last[1]:last[1]+40;
 if(!motion.matches){const trail=svgNode('path',{d:pathD(entry.points),class:'escape-trail'});if(level.mode==='golden'&&a.id===level.goalId)trail.style.stroke='var(--gold)';if(level.mode==='color')trail.style.stroke=`var(--color-${a.color})`;if(level.mode==='mirror')trail.style.stroke='var(--mirror)';if(level.mode==='bomb'&&a.id===level.bombId)trail.style.stroke='var(--bomb)';$('paths').prepend(trail);trail.animate([{opacity:.18},{opacity:0}],{duration:650,fill:'forwards'});setTimeout(()=>trail.remove(),700);}
 const route=motionRoute(entry.points,d);return animateTravel(a,route.length+exit,false);
}
function animateBump(a,impact){const distance=collisionDistance(a,level.arrows,new Set(run.removed))*pointStep;return animateTravel(a,Math.max(0,distance-13),true,impact);}
function cancelTravel(){for(const frame of travelFrames)cancelAnimationFrame(frame);travelFrames.clear();for(const resolve of [...travelResolvers])resolve();travelResolvers.clear();}
function scheduleTravel(callback){const frame=requestAnimationFrame(now=>{travelFrames.delete(frame);callback(now);});travelFrames.add(frame);}
function animateTravel(a,maxDistance,bounce=false,impact=()=>{}){
 const entry=elements.get(a.id);if(!entry){impact();return Promise.resolve();}const{g,line,head,points}=entry,d=direction(a),route=motionRoute(points,d);
 const finish=()=>{if(bounce){line.setAttribute('d',pathD(points));drawHead(head,points.at(-1),d);if(entry.marker)entry.marker.setAttribute('transform',`translate(${points[0]})`);}else{g.remove();elements.delete(a.id);}};
 if(motion.matches){if(bounce)impact();finish();return Promise.resolve();}
 return new Promise(resolve=>{const started=performance.now(),t=token,duration=bounce?Math.min(900,620+maxDistance*.3):Math.min(1050,470+route.length*.4);let impacted=false;
  const settle=()=>{travelResolvers.delete(settle);resolve();};travelResolvers.add(settle);
  function frame(now){if(t!==token){settle();return;}const f=Math.min(1,(now-started)/duration),distance=bounce?maxDistance*(f<.46?1-Math.pow(1-f/.46,3):1-Math.pow((f-.46)/.54,2)):maxDistance*f*f;
   if(bounce&&!impacted&&f>=.46){impacted=true;impact();}const part=route.slice(distance);line.setAttribute('d',pathD(part));drawHead(head,part.at(-1),d);if(entry.marker)entry.marker.setAttribute('transform',`translate(${part[0]})`);
   if(!bounce)g.style.opacity=f>.9?String((1-f)/.1):'1';if(f<1)scheduleTravel(frame);else{if(bounce&&!impacted)impact();finish();settle();}
  }scheduleTravel(frame);
 });
}
function useHint(){
 if(view!=='game'||busy||run.hints<=0||run.outcome!=='playing')return;interaction();
 if(level.tutorial&&profile.guideSteps<2){syncGuide();return;}
 clearHighlight();const a=getSafeArrow(level,run);if(!a){if(level.mode==='bomb')say('The bomb needs more moves than remain. Undo a recent move or restart. No hint spent.');return;}run.hints--;hinted=a.id;moveGroup(level,a.id).forEach(key=>elements.get(key)?.g.classList.add('hinted'));if(level.mode==='mirror')previewPair(a.id);resetZoom();say(level.mode==='bomb'&&!bombState(level,new Set(run.removed)).defused?(a.id===level.bombId?'The bomb arrow is ready. Release it to defuse the fuse.':'This path helps you reach the bomb in time.'):level.mode==='gates'?'This highlighted path helps clear the open gates or reach a switch.':level.mode==='mirror'?'Both highlighted arrows have clear exits. Tap either one.':level.mode==='color'?`The highlighted ${a.color} arrow has a clear exit. Tap it to escape.`:level.mode==='golden'?(a.id===level.goalId?'The gold arrow is ready. Tap it to escape.':'This path helps open the way to gold.'):level.mode==='keys'&&!run.removed.includes(level.keyId)?(a.id===level.keyId?'The key arrow is ready. Release it to open the lock.':'This path helps you reach the key arrow.'):'The highlighted arrow has a clear path. Tap to release it.');updateStatus();save();
}
function doUndo(){if(view!=='game'||busy||run.outcome!=='playing'||!run.history.length)return;interaction();clearHighlight();run=undo(run);renderBoard();updateStatus();syncGuide();save();say('One step back. A fresh perspective.');}
function recordWin(){const stars=Math.max(1,3-run.mistakes),old=profile.results[run.level];pendingHomeStars+=starGain(old?.stars,stars);profile.results[run.level]={stars:Math.max(old?.stars||0,stars),elapsed:old?Math.min(old.elapsed,run.elapsed):run.elapsed};profile.unlocked=Math.max(profile.unlocked,Math.min(levels.length,run.level+1));save();}
function openModal(type,html,wide=false){interaction();lastFocus=document.activeElement;modalType=type;syncScreenInert();$('modalContent').innerHTML=html;$('modal').hidden=false;document.querySelector('.modal-card').classList.toggle('wide',wide);$('closeModal').hidden=type==='win'||type==='loss';requestAnimationFrame(()=>{const target=$('modalContent').querySelector('button,input')||document.querySelector('.modal-card');target.focus();});}
function closeModal(){if(modalType==='win'||modalType==='loss')return;interaction();$('modal').hidden=true;modalType='';syncScreenInert();lastFocus?.focus?.();}
function dismissResult(){modalType='';$('modal').hidden=true;syncScreenInert();}
function confetti(){if(motion.matches)return;for(let i=0;i<26;i++){const n=document.createElement('i');n.className='confetti';n.style.left=`${18+Math.random()*64}%`;n.style.background=['#8aac91','#f5b3ba','#d9bc7f','#a9b7c3'][i%4];n.style.animationDelay=`${Math.random()*.45}s`;document.body.append(n);setTimeout(()=>n.remove(),2300);}}
function showWin(celebrate){if(celebrate)analytics.levelEnd(true);recordWin();const stars=Math.max(1,3-run.mistakes),final=run.level===levels.length;
 openModal('win',`<div class="result"><div class="result-icon ${level.mode==='golden'?'gold-result':''}">${level.mode==='golden'?'★':level.mode==='keys'?'✓':'↗'}</div><span class="eyebrow">LEVEL ${run.level} COMPLETE</span><h2 id="modalTitle">${final?'Every path, set free.':level.mode==='golden'?'A golden escape!':level.mode==='keys'?'Unlocked and untangled.':level.mode==='mirror'?'Perfectly in sync.':level.mode==='ice'?'The ice is broken.':level.mode==='bomb'?'Defused and untangled.':level.mode==='gates'?'A perfect switch.':run.mistakes?'A beautiful escape.':'Perfectly untangled.'}</h2><div class="stars" aria-label="${stars} of 3 stars">${[0,1,2].map(i=>`<span class="result-star ${i>=stars?'empty':''}" style="--star:${i}">★</span>`).join('')}</div><p>${final?`You have cleared all ${levels.length} puzzles. Revisit a favorite and chase three stars.`:selectedMode==='adventure'?`Next: ${levels[run.level].name}.<br>${levels[run.level].mode==='bomb'?'Defuse the bomb before its move counter runs out.':levels[run.level].mode==='gates'?'Release a switch to swap the open gates.':levels[run.level].mode==='mirror'?'Two arrows. Both exits must be clear.':levels[run.level].mode==='ice'?'Release marked paths to crack the ice.':'A larger maze. Find its hidden order.'}`:level.mode==='golden'?'The gold arrow is free.<br>You found its way out!':levels[run.level]?.mode==='golden'?'Next: find a way out for the golden arrow.':levels[run.level]?.mode==='keys'?'Next: find the key and open a locked path.':levels[run.level]?.shape?`Next: a ${levels[run.level].shape}-shaped puzzle.<br>A new little world to untangle.`:'A clear mind. A clear board.<br>Your next little challenge is ready.'}</p><div class="result-stats"><div><strong>${fmt(run.elapsed)}</strong><span>Time</span></div><div><strong>${run.removed.length}</strong><span>Arrows freed</span></div><div><strong>${run.mistakes}</strong><span>Mistakes</span></div></div><button class="primary" id="nextLevel">${final?'Explore your levels':'Next level'} <span>→</span></button><button class="secondary" id="replay">Play again</button><button class="result-home" id="winHome">⌂ Home</button></div>`);
 $('nextLevel').onclick=()=>{dismissResult();if(final)showLevels();else loadLevel(run.level+1,true);};$('replay').onclick=()=>{dismissResult();loadLevel(run.level,true);};$('winHome').onclick=()=>showHome();if(celebrate){tone('win');confetti();}
}
function showLoss(){analytics.levelEnd(false);const exploded=bombState(level,new Set(run.removed)).exploded;openModal('loss',`<div class="result"><div class="result-icon" style="background:#fcebed;color:#f65a78">${exploded?'◉':'♡'}</div><span class="eyebrow">A MOMENT TO RESET</span><h2 id="modalTitle">${exploded?'The fuse ran out.':'Try a different path.'}</h2><p>${exploded?`Free the bomb arrow within ${level.bombMoves} successful moves. Trace its prerequisites before releasing other paths.`:run.timed&&run.elapsed>=timeLimit()?'Time ran out. Try again, or turn off the timer for a calmer puzzle.':'Every tangled path has a way out.<br>Start fresh with three hearts.'}</p><button class="primary" id="retry">Try again ↗</button><button class="secondary" id="lossLevels">Choose a level</button><button class="result-home" id="lossHome">⌂ Home</button></div>`);$('retry').onclick=()=>{dismissResult();loadLevel(run.level,true);};$('lossLevels').onclick=()=>{dismissResult();showLevels();};$('lossHome').onclick=()=>showHome();}
function showLevels(){const stars=Object.values(profile.results).reduce((n,r)=>n+r.stars,0);openModal('levels',`<span class="eyebrow">ONE PATH AT A TIME</span><h2 id="modalTitle">${selectedMode==='adventure'?'Your Adventure map.':selectedMode==='color'?'Your color journey.':'Your little journey.'}</h2><p>${Object.keys(profile.results).length} of ${levels.length} levels complete · ${stars} stars collected</p><div class="level-grid">${levels.map((l,i)=>`<button class="level-tile ${i+1===run.level?'active':''}" data-level="${i+1}" ${i+1>profile.unlocked?'disabled':''} aria-label="Level ${i+1}${i+1>profile.unlocked?', locked':profile.results[i+1]?`, ${profile.results[i+1].stars} stars`:''}"><span>${i+1>profile.unlocked?'<span class="lock">⌑</span>':i+1}</span>${l.mode?`<span class="mode-mark ${l.mode==='golden'?'gold-mark':''}" aria-hidden="true">${l.mode==='golden'?'★':l.mode==='color'?'●':l.mode==='mirror'?'⇄':l.mode==='ice'?'❄':l.mode==='bomb'?'◉':l.mode==='gates'?'⇆':l.mode==='classic'?'↗':'⚿'}</span>`:l.shape?`<span class="shape-mark" aria-hidden="true">${shapeSymbol(l.shape)}</span>`:''}${profile.results[i+1]?`<small>${'★'.repeat(profile.results[i+1].stars)}</small>`:''}</button>`).join('')}</div><p style="font-size:10px">Complete each puzzle to open the next. Your progress stays on this device.</p>`,true);document.querySelectorAll('[data-level]:not(:disabled)').forEach(n=>n.onclick=()=>{const number=Number(n.dataset.level);closeModal();if(view==='home'){startFromHome(number);return;}if(number!==run.level)loadLevel(number,true);else if(run.outcome==='won')showWin(false);else if(run.outcome==='lost')showLoss();});}
function showHow(){if(selectedMode==='adventure'){showAdventureHow();return;}if(selectedMode==='color'){showColorHow();return;}openModal('how',`<span class="eyebrow">SIMPLE RULES. CLEVER PATHS.</span><h2 id="modalTitle">Find the way out.</h2><svg class="mini-demo" viewBox="0 0 310 80" aria-hidden="true"><path d="M22 60V20h60v40h82m-9-8 9 8-9 8"/><path class="green" d="M196 61V22h85m-9-8 9 8-9 8"/></svg><div class="rules"><div class="rule"><span class="rule-number">1</span><div><strong>Follow the arrowhead.</strong><p>Tap anywhere on a path. It leaves in the direction its arrowhead points.</p></div></div><div class="rule"><span class="rule-number">2</span><div><strong>Make sure the way is clear.</strong><p>Look straight ahead of the head. Another arrow in that line will block it and cost one heart.</p></div></div><div class="rule"><span class="rule-number">3</span><div><strong>${level.mode==='golden'?'Free the golden arrow.':level.mode==='keys'?'Find the key. Open the lock.':'Set every arrow free.'}</strong><p>${level.mode==='golden'?'Only the gold arrow has to escape. Other arrows can stay on the board.':level.mode==='keys'?'Release the arrow with the key symbol to unlock the padlock arrow. Then clear the whole board. Tapping the closed lock does not cost a heart.':'Clear the whole board to unlock the next puzzle.'} You have three hearts and three hints per attempt.</p></div></div></div><p style="font-size:11px">Pinch or use + / − to zoom, then drag to explore. With a keyboard, Tab to an arrow and press Enter. H: hint · U: undo · R: restart.</p><button class="primary" id="gotIt">${view==='home'?'Back to Home':'Back to the puzzle →'}</button><button class="secondary" id="guidedPractice">Start guided Level 1</button>`);$('gotIt').onclick=closeModal;$('guidedPractice').onclick=()=>{closeModal();profile.guideSteps=0;if(view==='home')startFromHome(1,true);else loadLevel(1,true);};}
function showSettings(){openModal('settings',`<span class="eyebrow">MAKE YOURSELF AT HOME</span><h2 id="modalTitle">A calmer kind of play.</h2>${[['sound','Gentle sounds','A little note for each escape.'],['haptic','Touch feedback','A soft tap on supported devices.'],['dark','Dark appearance','For your evening puzzles.'],['dots','Guide dots','A subtle grid to help trace each path.'],['challenge','Timer challenge','A countdown, starting on your next attempt.']].map(([id,label,sub])=>`<div class="setting-row"><label for="set-${id}">${label}<small>${sub}</small></label><input id="set-${id}" class="switch" type="checkbox" ${profile.settings[id]?'checked':''} data-setting="${id}"></div>`).join('')}<p style="font-size:10px">${levels.length} puzzles · No ads · No account needed<br>Progress is saved in this browser. Clearing browser data removes it.${saveAvailable?'':'<br><span class="save-warning">Saving is unavailable in this browser session.</span>'}</p><button class="primary" id="settingsDone">${view==='home'?'Back to Home':'Back to the puzzle'}</button>`);document.querySelectorAll('[data-setting]').forEach(n=>n.onchange=()=>{for(const[mode,campaign]of Object.entries(campaigns)){campaign.profile.settings[n.dataset.setting]=n.checked;try{writeCampaign(localStorage,mode,campaign.profile);}catch{saveAvailable=false;}}applySettings();save();if(n.dataset.setting==='sound')tone('escape');});$('settingsDone').onclick=closeModal;}
function showRestart(){if(view!=='game'||busy)return;if(!run.removed.length&&!run.mistakes){loadLevel(run.level,true);return;}openModal('restart',`<span class="eyebrow">A NEW PERSPECTIVE</span><h2 id="modalTitle">Start this puzzle over?</h2><p>Your arrows, hearts and hints will reset. Completed levels and stars stay saved.</p><button class="primary" id="confirmRestart">Restart level ${run.level}</button><button class="secondary" id="cancelRestart">Keep going</button>`);$('confirmRestart').onclick=()=>{closeModal();loadLevel(run.level,true);};$('cancelRestart').onclick=closeModal;}
function transformBoard(){$('boardWrapper').style.transform=`translate(${pan.x}px,${pan.y}px) scale(${scale})`;$('zoomReset').textContent=`${Math.round(scale*100)}%`;$('zoomOut').disabled=scale<=1;$('zoomIn').disabled=scale>=2.5;}
function resetZoom(){scale=1;pan={x:0,y:0};transformBoard();}
function zoom(delta){interaction();scale=Math.min(2.5,Math.max(1,Math.round((scale+delta)*100)/100));if(scale===1)pan={x:0,y:0};clampPan();transformBoard();}
function clampPan(){const limit=$('boardWrapper').offsetWidth*(scale-1)/2;pan.x=Math.min(limit,Math.max(-limit,pan.x));pan.y=Math.min(limit,Math.max(-limit,pan.y));}
function nearestArrow(event){
 const matrix=$('board').getScreenCTM();if(!matrix)return null;const point=$('board').createSVGPoint();point.x=event.clientX;point.y=event.clientY;const p=point.matrixTransform(matrix.inverse());let best=null,distance=16/Math.max(.1,Math.hypot(matrix.a,matrix.b));
 for(const[id,entry]of elements){if(entry.g.classList.contains('departing'))continue;for(let i=1;i<entry.points.length;i++){const a=entry.points[i-1],b=entry.points[i],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p.x-a[0])*dx+(p.y-a[1])*dy)/(dx*dx+dy*dy))),d=Math.hypot(p.x-a[0]-dx*t,p.y-a[1]-dy*t);if(d<distance){distance=d;best=id;}}}return best;
}
function setupPointers(){const pointers=new Map();let gesture=null;const stage=$('stage');stage.addEventListener('pointerdown',e=>{if(e.button!==0||e.target.closest('.zoom-controls'))return;interaction();stage.setPointerCapture(e.pointerId);pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===1)gesture={start:{x:e.clientX,y:e.clientY},pan:{...pan},arrow:selectedMode==='adventure'?nearestArrow(e):e.target.closest('[data-arrow]')?.dataset.arrow,moved:false,pinched:false};else if(pointers.size===2){const a=[...pointers.values()];gesture={...gesture,distance:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y),scale,pinched:true,moved:true};}});
 stage.addEventListener('pointermove',e=>{if(!pointers.has(e.pointerId)||!gesture)return;pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(pointers.size===2){const a=[...pointers.values()],dist=Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y);scale=Math.min(2.5,Math.max(1,gesture.scale*dist/Math.max(gesture.distance,1)));clampPan();transformBoard();}else if(!gesture.pinched){const dx=e.clientX-gesture.start.x,dy=e.clientY-gesture.start.y;if(Math.hypot(dx,dy)>7)gesture.moved=true;if(gesture.moved&&scale>1){pan={x:gesture.pan.x+dx,y:gesture.pan.y+dy};clampPan();transformBoard();}}});
 stage.addEventListener('pointerup',e=>{if(!pointers.has(e.pointerId))return;pointers.delete(e.pointerId);if(!pointers.size){if(gesture&&!gesture.moved&&gesture.arrow)attempt(gesture.arrow);gesture=null;}});const cancel=e=>{pointers.delete(e.pointerId);if(gesture)gesture.moved=true;if(!pointers.size)gesture=null;};stage.addEventListener('pointercancel',cancel);stage.addEventListener('lostpointercapture',cancel);stage.addEventListener('wheel',e=>{e.preventDefault();zoom(e.deltaY<0?.12:-.12);},{passive:false});
}
function mechanicMarker(kind,point){
 const g=svgNode('g',{class:`mechanic-marker ${kind}`,'aria-hidden':'true','pointer-events':'none',transform:`translate(${point})`}),inner=svgNode('g',{class:'marker-content'});
 inner.append(svgNode('circle',{r:13,class:'marker-disc'}));
 if(kind==='gold')inner.append(svgNode('path',{d:'M0-8 2.3-2.7 8-2.5 3.6 1.4 4.8 7.5 0 4.2-4.8 7.5-3.6 1.4-8-2.5-2.3-2.7Z',class:'marker-star'}));
 if(kind==='key'){inner.append(svgNode('circle',{cx:-3,cy:-3,r:3.5,class:'marker-line'}));inner.append(svgNode('path',{d:'m0 0 7 7m-3-3 3-3m-1 5 2-2',class:'marker-line'}));}
 if(kind==='lock'||kind==='open'){inner.append(svgNode('rect',{x:-5.5,y:-1,width:11,height:9,rx:2,class:'marker-line'}));inner.append(svgNode('path',{d:kind==='open'?'M-3.5-1v-4a3.5 3.5 0 0 1 7 0':'M-3.5-1v-4a3.5 3.5 0 0 1 7 0v4',class:'marker-line'}));}
 g.append(inner);return g;
}
function syncMechanics(celebrateUnlock=false,previousColor=null,previousRemoved=null){
 $('objective').classList.remove('adventure-objective');if(selectedMode==='adventure'){syncAdventureMechanics(previousRemoved);return;}
 if(level.mode==='color'){syncColorMechanics(previousColor);return;}
 const removed=new Set(run.removed),keys=level.mode==='keys',unlocked=keys&&removed.has(level.keyId);
 for(const[id,e]of elements){const gold=level.mode==='golden'&&id===level.goalId,key=keys&&id===level.keyId,lock=keys&&id===level.lockId,closed=isLocked(level,id,removed);
  e.g.classList.toggle('is-golden',gold);e.g.classList.toggle('has-key',key);e.g.classList.toggle('is-locked',closed);e.g.classList.toggle('is-unlocked',lock&&unlocked);e.g.setAttribute('aria-disabled',String(closed));
  e.g.setAttribute('aria-label',e.baseLabel+(gold?' Golden objective.':key?' Carries the key.':closed?' Locked. Release the key arrow first.':lock?' Unlocked path.':''));
  e.marker?.remove();e.marker=null;const kind=gold?'gold':key?'key':lock?(unlocked?'open':'lock'):null;if(kind){e.marker=mechanicMarker(kind,e.points[0]);e.g.append(e.marker);if(lock&&unlocked&&celebrateUnlock)e.marker.classList.add('unlock-pop');}
 }
 updateObjective();
 if(celebrateUnlock){tone('unlock');vibrate([12,25,18]);const lock=level.arrows.find(a=>a.id===level.lockId);say(lock&&!blockers(lock,level.arrows,removed).length?'The lock is open! Its arrow is ready to escape.':'The lock is open! Now clear the remaining paths.');}
}
function updateObjective(){
 $('objective').classList.remove('color-objective');
 const gold=level.mode==='golden',keys=level.mode==='keys';$('objective').hidden=!gold&&!keys;$('remainingLabel').textContent=gold?'ON THE BOARD':'REMAINING';if(!gold&&!keys)return;
 const unlocked=keys&&run.removed.includes(level.keyId),lockGone=keys&&run.removed.includes(level.lockId);$('objective').classList.toggle('gold-objective',gold);const signature=`${level.uid}:${level.mode}:${run.outcome}:${unlocked}:${lockGone}`;if($('objective').dataset.state===signature)return;$('objective').dataset.state=signature;
 $('objective').innerHTML=gold?`<span class="objective-symbol" aria-hidden="true">★</span><div><strong>${run.outcome==='won'?'Golden arrow escaped':'Free the golden arrow'}</strong><p>Open its path, then tap gold. Other arrows may stay.</p></div><span class="objective-tag">${level.mechanicIntro?'NEW GOAL':'GOLDEN'}</span>`:`<span class="objective-symbol" aria-hidden="true">${unlocked?'✓':'⚿'}</span><div><strong>${lockGone?'Now clear the board':unlocked?'Key found · lock open':'Find the key · open the lock'}</strong><p>${unlocked?'The padlock arrow is unlocked. Clear every arrow to win.':'Release the key arrow first. Then clear the whole board.'}</p></div><span class="objective-tag">${lockGone?'3 / 3':unlocked?'2 / 3':'1 / 3'}</span>`;
}
function lockedNotice(id){
 if(level.mode==='gates'){gateNotice(id);return;}
 if(level.mode==='ice'){iceNotice(id);return;}
 if(level.mode==='color'){say(`First clear all ${activeColor(level,new Set(run.removed))} arrows. No heart lost.`);const entry=elements.get(id);if(entry&&!motion.matches)entry.g.animate([{opacity:1},{opacity:.25},{opacity:1}],{duration:330});vibrate(9);return;}
 say('This arrow needs its key first. Look for the key symbol. No heart lost.');const e=elements.get(id);if(e?.marker&&!motion.matches)e.marker.querySelector('.marker-content').animate([{transform:'rotate(-12deg)'},{transform:'rotate(12deg)'},{transform:'rotate(-8deg)'},{transform:'rotate(0)'}],{duration:360});vibrate(9);
}

function unlockAudio(){if(!profile.settings.sound)return;try{audioContext??=new(window.AudioContext||window.webkitAudioContext)();if(audioContext.state==='suspended')audioContext.resume().catch(()=>{});}catch{}}
function interaction(){idleSeconds=0;$('hint').classList.remove('nudge');}
function animateIntro(){
 if(motion.matches||run.outcome!=='playing')return;let i=0;
 for(const{line,head}of elements.values()){const length=line.getTotalLength(),delay=Math.min(i++*26,450);introAnimations.push(line.animate([{strokeDasharray:`${length}`,strokeDashoffset:length},{strokeDasharray:`${length}`,strokeDashoffset:0}],{duration:480,delay,easing:'ease-out',fill:'backwards'}));introAnimations.push(head.animate([{opacity:0},{opacity:1}],{duration:200,delay:delay+330,fill:'backwards'}));}
}
function syncGuide(){
 $('guidance').replaceChildren();for(const{g}of elements.values())g.classList.remove('guided');$('coach').hidden=true;
 if(run.outcome!=='playing')return;
 if(!level.tutorial||profile.guideSteps>=2){if(level.shape){$('coach').hidden=false;$('coach').textContent=`${shapeSymbol(level.shape)} ${level.shape[0].toUpperCase()+level.shape.slice(1)} formation`;}return;}
 const a=getSafeArrow(level,run),entry=a&&elements.get(a.id);if(!entry)return;entry.g.classList.add('guided');const[x,y]=entry.points.at(-1);
 const ring=svgNode('circle',{cx:x,cy:y,r:24,class:'guide-ring'}),halo=svgNode('circle',{cx:x,cy:y,r:24,class:'guide-halo'});
 const cursor=svgNode('g',{transform:`translate(${x+8},${y+12})`,class:'guide-cursor'});cursor.append(svgNode('path',{d:'M8 34V8a5 5 0 0 1 10 0v15-6a4 4 0 0 1 8 0v7-4a4 4 0 0 1 8 0v7-3a4 4 0 0 1 8 0v15c0 10-6 16-15 16h-3c-6 0-9-3-12-8L1 34a4 4 0 0 1 6-5l6 6',class:'guide-hand'}));$('guidance').append(halo,ring,cursor);
 $('coach').hidden=false;$('coach').textContent=`First steps · ${profile.guideSteps+1} / 2`;say(profile.guideSteps===0?'Tap the glowing arrow. Its way out is clear.':'One more! Tap this clear arrow, then try on your own.');
}
function shapeSymbol(shape){return({heart:'♡',star:'☆',fish:'◁',tree:'♧'})[shape]||'';}
function positivePulse(a){if(motion.matches)return;const entry=elements.get(a.id);if(!entry)return;const[x,y]=entry.points.at(-1),n=svgNode('circle',{cx:x,cy:y,r:17,class:'positive-pulse'});if(level.mode==='color')n.style.stroke=`var(--color-${a.color})`;$('paths').prepend(n);n.animate([{opacity:.45,strokeWidth:12},{opacity:0,strokeWidth:1}],{duration:430,fill:'forwards'});setTimeout(()=>n.remove(),480);}
function heartPop(index){
 if(motion.matches)return;const el=$('hearts').children[index];if(!el)return;el.animate([{fill:'var(--heart)',transform:'scale(1.25)'},{fill:'var(--heart)',transform:'scale(.2)',opacity:0},{fill:'var(--line)',transform:'scale(.88)',opacity:1}],{duration:480,easing:'ease-out'});
 const r=el.getBoundingClientRect();for(let i=0;i<8;i++){const n=document.createElement('i'),angle=i*Math.PI/4;n.className='heart-spark';n.style.left=`${r.left+r.width/2}px`;n.style.top=`${r.top+r.height/2}px`;document.body.append(n);n.animate([{transform:'translate(0,0) scale(1)',opacity:1},{transform:`translate(${Math.cos(angle)*25}px,${Math.sin(angle)*25}px) scale(.1)`,opacity:0}],{duration:520,fill:'forwards',easing:'ease-out'});setTimeout(()=>n.remove(),600);}
}

function syncScreenInert(){
 $('app').inert=view!=='game'||!!modalType;$('homeScreen').inert=view!=='home'||!!modalType||enteringHomeGame;
  if(view!=='game'||modalType)analytics.flushPlayTime();
}
function toggleSound(){const enabled=!profile.settings.sound;for(const[mode,campaign]of Object.entries(campaigns)){campaign.profile.settings.sound=enabled;try{writeCampaign(localStorage,mode,campaign.profile);}catch{saveAvailable=false;}}applySettings();save();tone('escape');}
function showHome(focus=true){
 if(!profile||!run)return;token++;cancelTravel();introAnimations.forEach(a=>a.cancel());introAnimations=[];busy=false;clearHighlight();
 if(run.outcome==='won')recordWin();save();dismissResult();view='home';$('app').hidden=true;$('homeScreen').hidden=false;syncScreenInert();document.title='Arrow Escape · A little focus. A clear way out.';
 const gained=pendingHomeStars;pendingHomeStars=0;homeUI?.render(gained);if(focus)$('homeStart').focus();
}
async function startFromHome(number=null,forceRestart=false){
 if(view!=='home'||enteringHomeGame||!profile)return;
 const target=number??homeSnapshot(profile,levels.length).resumeLevel;if(!Number.isInteger(target)||target<1||target>profile.unlocked)return;
 enteringHomeGame=true;syncScreenInert();unlockAudio();tone('escape');
 try{await homeUI.launch();}finally{
  enteringHomeGame=false;view='game';$('homeScreen').hidden=true;$('app').hidden=false;syncScreenInert();
   analytics.gameStart(selectedMode);
   const restart=forceRestart||run.level!==target||run.outcome!=='playing';loadLevel(target,restart);$('board').setAttribute('tabindex','-1');$('board').focus();
 }
}
function showFeature(kind){
 const gold=kind==='golden',target=gold?3:6,unlocked=profile.unlocked>=target,freshRules=run.level===target&&run.rules==='classic';
 openModal('feature',`<div class="feature-dialog"><span class="eyebrow">${unlocked?'READY TO EXPLORE':`DISCOVER AT LEVEL ${target}`}</span><h2 id="modalTitle">${gold?'A golden little goal.':'One key. A new way out.'}</h2><div class="feature-dialog-art ${gold?'gold':''}" aria-hidden="true">${gold?'★':'⚿'}</div><p>${gold?'Find the arrow marked with a gold star. Clear its path, then set it free. Only the golden arrow needs to escape.':'Find the arrow carrying a key. Release it to open the padlock arrow, then clear the board. A closed-lock tap will never cost a heart.'}${unlocked&&freshRules?'<br><br>This starts a fresh attempt with the new rules. Your earned stars stay saved.':''}</p><button class="primary" id="featurePlay">${unlocked?`Play Level ${target}`:'Keep exploring'} →</button><button class="secondary" id="featureBack">Back to Home</button></div>`);
 $('featurePlay').onclick=()=>{closeModal();startFromHome(unlocked?target:null,unlocked&&freshRules);};$('featureBack').onclick=closeModal;
}



const ADVENTURE_ICONS={classic:'↗',mirror:'⇄',ice:'❄',bomb:'◉',gates:'⇆'};
function adventureInstruction(){if(run.rules==='classic'&&['bomb','gates'].includes(levels[run.level-1].mode))return 'Your saved Grand Maze rules are preserved. Restart to try the new challenge.';if(level.mode==='bomb')return bombState(level,new Set(run.removed)).defused?'Bomb defused. Now clear the rest of the maze.':`Free the bomb within ${level.bombMoves} successful moves. Blocked taps cost a heart, not a move.`;if(level.mode==='gates')return 'Release an S-marked switch to swap A/B gates. Clear open gates before the last switch.';return level.mode==='mirror'?'Tap either numbered arrow. Both partners must have a clear exit.':level.mode==='ice'?'Tap an ice shell to reveal its marked paths. Free them to crack the ice.':'A bigger maze from the start. Trace each arrowhead and find a clear exit.';}
function pairBadge(point,label,kind='pair-badge'){
 const badge=svgNode('g',{class:kind,transform:`translate(${point})`,'pointer-events':'none','aria-hidden':'true'});badge.append(svgNode('circle',{r:10}));const text=svgNode('text',{x:0,y:3.3,'text-anchor':'middle'});text.textContent=label;badge.append(text);return badge;
}
function previewPair(id){
 if(level?.mode!=='mirror')return;for(const{g}of elements.values())g.classList.remove('pair-preview');$('pairLinks').replaceChildren();if(!id)return;
 const pair=moveGroup(level,id),entries=pair.map(key=>elements.get(key));if(entries.some(entry=>!entry))return;entries.forEach(entry=>entry.g.classList.add('pair-preview'));
 const a=entries[0].points[0],b=entries[1].points[0],link=svgNode('path',{d:`M${a} C360,${a[1]} 360,${b[1]} ${b}`,class:'mirror-link'});$('pairLinks').append(link);
 if(!motion.matches)link.animate([{opacity:0},{opacity:.65}],{duration:220,fill:'forwards'});
}
function syncAdventureMechanics(previousRemoved=null){
 if(['bomb','gates'].includes(level.mode)){syncHazards(previousRemoved);return;}
 const removed=new Set(run.removed),previous=previousRemoved&&new Set(previousRemoved);$('boardDecor').replaceChildren();$('pairLinks').replaceChildren();
 if(level.mode==='mirror'){
  $('boardDecor').append(svgNode('line',{x1:360,y1:38,x2:360,y2:682,class:'mirror-axis'}));
  for(const[x,label]of [[206,'TAP EITHER SIDE'],[514,'CHECK ITS PARTNER']]){const text=svgNode('text',{x,y:26,'text-anchor':'middle',class:'mirror-side-label'});text.textContent=label;$('boardDecor').append(text);}
 }
 for(const[id,entry]of elements){
  const a=level.arrows.find(arrow=>arrow.id===id);entry.marker?.remove();entry.marker=null;entry.frost?.remove();entry.frost=null;
  if(level.mode==='mirror'){
   const pairIndex=level.pairs.findIndex(pair=>pair.includes(id)),partner=moveGroup(level,id).find(key=>key!==id);entry.g.classList.add('mirror-arrow');entry.g.style.setProperty('--pair-hue',[259,185,320,30,220][pairIndex%5]);entry.marker=pairBadge(entry.points[0],pairIndex+1);entry.g.append(entry.marker);
   entry.g.setAttribute('aria-label',`${entry.baseLabel} Mirror pair ${pairIndex+1}, linked to Arrow ${Number(partner.slice(1))+1}. Both escape together; both exits must be clear.`);entry.g.setAttribute('aria-disabled','false');
  }
  if(level.mode==='ice'){
   const status=iceState(level,id,removed),frozen=status.remaining>0,key=level.arrows.some(other=>!removed.has(other.id)&&iceState(level,other.id,removed).remaining>0&&other.iceKeys?.includes(id));
   entry.g.classList.toggle('is-frozen',frozen);entry.g.classList.toggle('is-ice-key',key);entry.g.setAttribute('aria-disabled',String(frozen));
   entry.g.setAttribute('aria-label',`${entry.baseLabel}${frozen?` Frozen: ${status.remaining} marked path${status.remaining===1?'':'s'} still needed. Tap to reveal them; no heart lost.`:status.total?' Ice broken. Check the exit before release.':key?' Marked path: releasing this helps crack an ice shell.':''}`);
   if(frozen){
    const frost=svgNode('g',{class:'frost-layer','pointer-events':'none','aria-hidden':'true'});frost.append(svgNode('path',{d:pathD(entry.points),class:'frost-shell'}));frost.append(svgNode('path',{d:pathD(entry.points),class:'frost-shine'}));
    const point=entry.points[Math.floor(entry.points.length/2)];for(let i=0;i<status.cracks;i++)frost.append(svgNode('path',{d:`M${point[0]-8+i*8},${point[1]-10}l7 7-5 6 8 8m-8-8-6 2`,class:'frost-crack'}));
    entry.g.insertBefore(frost,entry.line);entry.frost=frost;entry.marker=pairBadge(entry.points[0],status.remaining,'ice-badge');entry.g.append(entry.marker);
   }else if(status.total||key){entry.marker=pairBadge(entry.points[0],status.total?'✓':'❄','ice-badge ice-key-badge');entry.g.append(entry.marker);}
   if(previous&&status.total){const old=iceState(level,id,previous);if(old.remaining>status.remaining){if(status.remaining===0){iceBurst(entry);tone('ice');say('Ice shattered! The arrow is free to move once its exit is clear.');}else{tone('ice');if(!motion.matches)entry.g.animate([{opacity:.5},{opacity:1}],{duration:380});say(`A new crack! ${status.remaining} marked path${status.remaining===1?'':'s'} left for this ice shell.`);}}}
  }
 }
 $('objective').hidden=false;$('objective').className='objective-panel adventure-objective';$('objective').dataset.state='adventure';
 const frozen=level.mode==='ice'?level.arrows.filter(a=>!removed.has(a.id)&&iceState(level,a.id,removed).remaining>0).length:0;
 $('objective').innerHTML=`<div class="adventure-objective-top"><span class="adventure-emblem ${level.mode}">${ADVENTURE_ICONS[level.mode]}</span><div><strong>${level.name}</strong><small>WORLD ${level.world} · ${level.worldName}</small></div><span class="adventure-difficulty">${level.mode==='ice'?`${frozen} frozen`:level.difficulty}</span></div><p id="adventureNote">${adventureInstruction()}</p><div class="adventure-sequence" aria-label="Repeating level order">${[['classic','Grand Maze'],['mirror','Mirror'],['ice','Ice Break']].map(([mode,label])=>`<span class="${mode===level.mode||(mode==='classic'&&['bomb','gates'].includes(level.mode))?'current':''}">${ADVENTURE_ICONS[mode]} ${label}</span>`).join('<i aria-hidden="true">→</i>')}</div>`;
 $('gameFootnote').textContent=`${level.difficulty} · ${levels.length} Adventure levels`;
}
function iceNotice(id){
 const status=iceState(level,id,new Set(run.removed));status.missing.forEach(key=>elements.get(key)?.g.classList.add('ice-trigger'));const entry=elements.get(id);if(entry&&!motion.matches)entry.g.animate([{transform:'translateX(-2px)'},{transform:'translateX(2px)'},{transform:'translateX(0)'}],{duration:260});
 const message=`Release the ${status.remaining} glowing marked path${status.remaining===1?'':'s'} to break this ice. No heart lost.`;say(message);if($('adventureNote'))$('adventureNote').textContent=message;vibrate(9);
}
function iceBurst(entry){
 if(motion.matches)return;const[x,y]=entry.points[Math.floor(entry.points.length/2)];
 for(let i=0;i<14;i++){const angle=i*Math.PI*2/14,shard=svgNode('path',{d:'M-4-5 5-2 2 6-5 2Z',class:'ice-shard',transform:`translate(${x},${y})`});$('paths').append(shard);
 const animation=shard.animate([{translate:'0px 0px',rotate:'0deg',opacity:1},{translate:`${Math.cos(angle)*48}px ${Math.sin(angle)*48+12}px`,rotate:`${i*37}deg`,opacity:0}],{duration:620,fill:'forwards',easing:'ease-out'});animation.finished.catch(()=>{}).finally(()=>shard.remove());}
}
function showAdventureHow(){
 openModal('adventure-how',`<span class="eyebrow">120 CHALLENGES. FIVE WAYS TO THINK.</span><h2 id="modalTitle">Your next escape.</h2><div class="adventure-help"><div><b>↗</b><strong>Grand Maze</strong><p>Long winding arrows from Level 1. Trace the head's straight exit. A blocked tap costs one heart.</p></div><div><b>⇄</b><strong>Mirror Arrows</strong><p>Match the numbered pair. Tap either arrow and both move in opposite directions. Both exits must be clear. One blocked pair costs one heart.</p></div><div><b>❄</b><strong>Ice Break</strong><p>Tap an ice shell to highlight its marked paths. Release two or three of them to crack the shell. Frozen taps do not cost hearts.</p></div><div><b>◉</b><strong>Bomb Arrow · from Level 7</strong><p>Release the bomb within its successful-move limit, then clear the board. Hints and blocked taps do not spend moves. Undo before the fuse runs out to regain a move.</p></div><div><b>⇆</b><strong>Switch Gates · from Level 10</strong><p>S-marked arrows swap the open A/B gates. Closed-gate taps are harmless. Clear every open gate before releasing the last switch.</p></div></div><p>Levels repeat Maze challenge → Mirror → Ice, with Bomb and Gates alternating in the maze slots from Level 7. Undo restores a whole mirror pair or rebuilds the ice. Your other games keep separate progress.</p><p class="adventure-help-controls">Pinch or use + / − to inspect a crowded board. Three hints per attempt show a legal move. H: hint · U: undo · R: restart.</p><button class="primary" id="adventureGotIt">${view==='home'?'Back to Home':'Back to the puzzle'}</button>`);$('adventureGotIt').onclick=closeModal;
}


function bombMarker(point,count){
 const marker=svgNode('g',{class:'bomb-marker',transform:`translate(${point})`,'aria-hidden':'true','pointer-events':'none'});
 marker.append(svgNode('circle',{r:15,class:'bomb-disc'}));marker.append(svgNode('path',{d:'M5-14q2-12 11-8m-1-5 1-5m4 10 5-1m-6-2 4-4',class:'bomb-fuse'}));const text=svgNode('text',{x:0,y:4,'text-anchor':'middle'});text.textContent=count;marker.append(text);return marker;
}
function gateMarker(point,group,open,previousOpen=null){
 const marker=svgNode('g',{class:`gate-marker ${open?'open':'closed'}`,transform:`translate(${point})`,'aria-hidden':'true','pointer-events':'none'});
 marker.append(svgNode('rect',{x:-16,y:-13,width:32,height:27,rx:6,class:'gate-frame'}));
 const left=svgNode('rect',{x:-10,y:-8,width:10,height:17,rx:1,class:'gate-door door-left'}),right=svgNode('rect',{x:0,y:-8,width:10,height:17,rx:1,class:'gate-door door-right'});marker.append(left,right);
 const text=svgNode('text',{x:0,y:4,'text-anchor':'middle'});text.textContent=group;marker.append(text);
 if(previousOpen!==null&&previousOpen!==open&&!motion.matches){for(const[door,sign]of [[left,-1],[right,1]])door.animate([{transform:`translateX(${previousOpen?sign*9:0}px)`},{transform:`translateX(${open?sign*9:0}px)`}],{duration:480,easing:'cubic-bezier(.2,.8,.2,1)'});}
 return marker;
}
function syncHazards(previousRemoved=null){
 const removed=new Set(run.removed),previous=previousRemoved&&new Set(previousRemoved),bomb=bombState(level,removed),gate=gateState(level,removed),oldGate=previous&&gateState(level,previous),swapped=level.mode==='gates'&&oldGate&&oldGate.phase!==gate.phase;
 $('boardDecor').replaceChildren();$('pairLinks').replaceChildren();
 for(const[id,entry]of elements){
  entry.marker?.remove();entry.marker=null;const isBomb=level.mode==='bomb'&&id===level.bombId,gateData=level.mode==='gates'?level.gates.find(g=>g.id===id):null,isSwitch=level.mode==='gates'&&level.switchIds.includes(id),closed=!!gateData&&gateData.group!==gate.phase;
  entry.g.classList.toggle('is-bomb',isBomb);entry.g.classList.toggle('bomb-critical',isBomb&&bomb.remaining<=2&&!bomb.defused);entry.g.classList.toggle('is-switch',isSwitch);entry.g.classList.toggle('gate-path',!!gateData);entry.g.classList.toggle('gate-closed',closed);entry.g.classList.toggle('gate-open',!!gateData&&!closed);entry.g.classList.toggle('last-switch',isSwitch&&gate.switchesLeft===1);entry.g.setAttribute('aria-disabled',String(closed));
  entry.g.setAttribute('aria-label',entry.baseLabel+(isBomb?` Bomb arrow. ${bomb.remaining} successful move${bomb.remaining===1?'':'s'} left to defuse.`:gateData?` Gate ${gateData.group}, ${closed?'closed. Release a switch to swap the gates. Closed taps cost no heart.':'open.'}`:isSwitch?` Switch S${level.switchIds.indexOf(id)+1}. Swaps A and B. ${gate.switchesLeft===1?'Last switch: clear every open gate first.':''}`:''));
  if(isBomb)entry.marker=bombMarker(entry.points[0],bomb.remaining);
  if(gateData)entry.marker=gateMarker(entry.points[0],gateData.group,!closed,oldGate?oldGate.phase===gateData.group:null);
  if(isSwitch)entry.marker=pairBadge(entry.points[0],`S${level.switchIds.indexOf(id)+1}`,'switch-badge');
  if(entry.marker)entry.g.append(entry.marker);
 }
 $('objective').hidden=false;$('objective').className=`objective-panel adventure-objective hazard-objective ${level.mode}-objective`;
 const sequence=[['classic',level.mode==='bomb'?'Bomb':'Gates'],['mirror','Mirror'],['ice','Ice Break']].map(([mode,label],i)=>`<span class="${i===0?'current':''}">${i===0?ADVENTURE_ICONS[level.mode]:ADVENTURE_ICONS[mode]} ${label}</span>`).join('<i aria-hidden="true">→</i>');
 const header=`<div class="adventure-objective-top"><span class="adventure-emblem ${level.mode}">${ADVENTURE_ICONS[level.mode]}</span><div><strong>${level.name}</strong><small>WORLD ${level.world} · ${level.worldName}</small></div><span class="adventure-difficulty">${level.mechanicIntro?'NEW CHALLENGE':level.difficulty}</span></div>`;
 if(level.mode==='bomb'){
  $('objective').innerHTML=header+`<div class="bomb-status ${bomb.defused?'defused':bomb.remaining<=2?'urgent':''}"><div><strong>${bomb.defused?'A CLEAR WAY FORWARD':'DEFUSE THE MARKED ARROW'}</strong><p id="adventureNote">${adventureInstruction()}</p></div><div id="bombCounter" class="bomb-counter" role="status" aria-label="${bomb.defused?'Bomb defused':`${bomb.remaining} successful move${bomb.remaining===1?'':'s'} left`}"><b>${bomb.defused?'✓':bomb.remaining}</b><span>${bomb.defused?'DEFUSED':'MOVES LEFT'}</span></div></div><div class="adventure-sequence">${sequence}</div>`;
  if(previous){const old=bombState(level,previous);if(!old.defused&&bomb.defused){tone('defuse');hazardBurst(project(level.arrows.find(a=>a.id===level.bombId).points[0]),'var(--defuse)');say('Bomb defused! Now clear the rest of the maze at your own pace.');}else if(old.remaining!==bomb.remaining&&!motion.matches)$('bombCounter').animate([{transform:'scale(1.2)'},{transform:'scale(1)'}],{duration:300});}
 }else{
  $('objective').innerHTML=header+`<div class="gate-status" aria-label="Gate states">${['A','B'].map(group=>{const left=level.gates.filter(g=>g.group===group&&!removed.has(g.id)).length,open=group===gate.phase;return `<div class="gate-card ${open?'open':'closed'}" aria-label="Gate ${group}, ${open?'open':'closed'}, ${left} paths remaining"><b>${group}</b><span><strong>${left===0?'CLEARED':open?'OPEN':'CLOSED'}</strong><small>${left} path${left===1?'':'s'} left</small></span><i aria-hidden="true">${open?'↗':'⌑'}</i></div>`;}).join('<span class="gate-swap-symbol" aria-hidden="true">⇄</span>')}</div><div class="switch-count"><span>${gate.switchesLeft} switch${gate.switchesLeft===1?'':'es'} left</span><span>${gate.switchesLeft===1?'Clear open gates before the last switch.':'S-marked arrows swap A and B.'}</span></div><p id="adventureNote" class="gate-note">Closed-gate taps cost no heart. Check each arrow\'s exit too.</p><div class="adventure-sequence">${sequence}</div>`;
  if(swapped){tone('gate');vibrate([10,25,10]);say(`Gate ${gate.phase} is open. ${gate.switchesLeft===1?'Clear the open gates before your last switch.':'Both gate groups have swapped.'}`);if(!motion.matches){$('stage').classList.remove('gates-swapped');void $('stage').offsetWidth;$('stage').classList.add('gates-swapped');document.querySelectorAll('.gate-card').forEach(card=>card.animate([{opacity:.5,transform:'translateY(4px)'},{opacity:1,transform:'translateY(0)'}],{duration:400}));}}
 }
 $('gameFootnote').textContent=`${level.difficulty} · ${levels.length} Adventure levels`;
}
function gateNotice(id,last=false){
 const removed=new Set(run.removed),state=gateState(level,removed),ids=last?state.open:level.switchIds.filter(key=>!removed.has(key));ids.forEach(key=>elements.get(key)?.g.classList.add(last?'gate-needed':'switch-hint'));
 const message=last?'Clear the glowing open gates before your last switch. No heart lost.':`Gate ${level.gates.find(g=>g.id===id)?.group||''} is closed. Release an S-marked switch to swap A/B. No heart lost.`;say(message);if($('adventureNote'))$('adventureNote').textContent=message;vibrate(9);
}
function hazardBurst(point,color){
 if(motion.matches)return;const[x,y]=point,ring=svgNode('circle',{cx:x,cy:y,r:14,class:'hazard-ring',stroke:color});$('paths').append(ring);const pulse=ring.animate([{r:'14px',opacity:.7,strokeWidth:7},{r:'95px',opacity:0,strokeWidth:1}],{duration:650,fill:'forwards'});pulse.finished.catch(()=>{}).finally(()=>ring.remove());
 for(let i=0;i<16;i++){const angle=i*Math.PI/8,particle=svgNode('circle',{cx:x,cy:y,r:2.5,fill:color,class:'hazard-particle'});$('paths').append(particle);const a=particle.animate([{translate:'0 0',opacity:1},{translate:`${Math.cos(angle)*75}px ${Math.sin(angle)*75}px`,opacity:0}],{duration:600,fill:'forwards',easing:'ease-out'});a.finished.catch(()=>{}).finally(()=>particle.remove());}
}
async function animateBombExplosion(){
 tone('boom');vibrate([45,25,65]);hazardBurst(project(level.arrows.find(a=>a.id===level.bombId).points[0]),'var(--bomb)');if(motion.matches)return;
 const animation=$('stage').animate([{transform:'translateX(0)',backgroundColor:'#ed765522'},{transform:'translateX(-5px)',offset:.2},{transform:'translateX(5px)',offset:.35},{transform:'translateX(-3px)',offset:.55},{transform:'translateX(0)',backgroundColor:'transparent'}],{duration:620});try{await animation.finished;}catch{}
}

const COLOR_LABELS={blue:'BLUE',yellow:'YELLOW',red:'RED'};
function colorInstruction(){const color=activeColor(level,new Set(run.removed));return color?`Clear all ${color} arrows first.`:'All three colors, set free!';}
function syncColorMechanics(previousColor=null){
 const removed=new Set(run.removed),current=activeColor(level,removed),phaseChanged=!!previousColor&&current&&current!==previousColor;
 $('app').style.setProperty('--active-color',`var(--color-${current||'blue'})`);
 for(const[id,entry]of elements){
  const arrow=level.arrows.find(a=>a.id===id),locked=isLocked(level,id,removed);entry.g.classList.add('color-arrow',`color-${arrow.color}`);entry.g.classList.toggle('phase-locked',locked);entry.g.classList.toggle('phase-active',!locked);entry.g.setAttribute('aria-disabled',String(locked));
  entry.g.setAttribute('aria-label',`${entry.baseLabel} ${COLOR_LABELS[arrow.color]} phase. ${locked?`Locked. Finish earlier color phases first; ${current} is current. No heart lost on a locked tap.`:'Current color. Check the exit before releasing.'}`);
  entry.marker?.remove();const badge=svgNode('g',{class:'color-letter',transform:`translate(${entry.points[0]})`,'aria-hidden':'true','pointer-events':'none'});badge.append(svgNode('circle',{r:10}));const letter=svgNode('text',{x:0,y:3.2,'text-anchor':'middle'});letter.textContent=arrow.color[0].toUpperCase();badge.append(letter);entry.marker=badge;entry.g.append(badge);
 }
 updateColorObjective();
 if(phaseChanged){say(`${COLOR_LABELS[previousColor]} complete · ${COLOR_LABELS[current]} unlocked! ${colorInstruction()}`);tone('unlock');vibrate([12,25,18]);const chip=$('objective').querySelector('.color-phase.current');if(chip&&!motion.matches){chip.animate([{transform:'scale(.85)',filter:'brightness(1.4)'},{transform:'scale(1.1)'},{transform:'scale(1)'}],{duration:620});const pop=document.createElement('span');pop.className='phase-unlock-icon';pop.setAttribute('aria-hidden','true');pop.innerHTML=lockSVG().replace('M6 9V6a4 4 0 0 1 8 0v3','M6 9V6a4 4 0 0 1 8 0');chip.append(pop);const animation=pop.animate([{opacity:0,transform:'translateY(6px) scale(.5)'},{opacity:1,transform:'translateY(-15px) scale(1.5)',offset:.4},{opacity:0,transform:'translateY(-35px) scale(1)'}],{duration:1000,fill:'forwards'});animation.finished.catch(()=>{}).finally(()=>pop.remove());}if(!motion.matches){$('stage').classList.remove('color-unlock-flash');void $('stage').offsetWidth;$('stage').classList.add('color-unlock-flash');}}
}
function updateColorObjective(){
 const removed=new Set(run.removed),current=activeColor(level,removed);$('objective').hidden=false;$('objective').classList.remove('gold-objective');$('objective').classList.add('color-objective');$('objective').dataset.state='color';$('remainingLabel').textContent='REMAINING';
 $('objective').innerHTML=`<div class="color-order-heading"><strong>COLOR ORDER</strong><span>BLUE → YELLOW → RED</span></div><div class="color-phase-row">${COLOR_ORDER.map((color,i)=>{const left=level.arrows.filter(a=>a.color===color&&!removed.has(a.id)).length,done=left===0,active=color===current;return `<div class="color-phase ${color} ${done?'done':active?'current':'locked'}" aria-label="${COLOR_LABELS[color]}, ${done?'complete':active?'current color':'locked'}, ${left} arrows remaining"><b>${done?'✓':i+1}</b><strong>${COLOR_LABELS[color]}</strong><span>${done?'✓':active?left:lockSVG()}</span></div>`;}).join('<i aria-hidden="true">›</i>')}</div><p>${current?`Clear all ${current} arrows first.`:'All three colors complete!'}<small>${current?(current==='red'?'Clear every red arrow to finish this puzzle.':`Clear every ${current} arrow to open the next color.`):'Every color is free.'}</small></p>`;
}
function lockSVG(){return '<svg viewBox="0 0 20 22" aria-hidden="true"><rect x="4" y="9" width="12" height="11" rx="2"/><path d="M6 9V6a4 4 0 0 1 8 0v3"/></svg>';}
function showColorHow(){
 openModal('color-how',`<span class="eyebrow">A DIFFERENT WAY TO ESCAPE</span><h2 id="modalTitle">One color at a time.</h2><div class="color-help-order"><span>1 BLUE</span> → <span>2 YELLOW</span> → <span>3 RED</span></div><div class="rules"><div class="rule"><span class="rule-number">1</span><div><strong>Start with blue.</strong><p>Only the current color can leave. Clear every blue arrow to unlock yellow, then clear yellow to unlock red.</p></div></div><div class="rule"><span class="rule-number">2</span><div><strong>Check the whole exit.</strong><p>Every arrow on the board can block an exit, including locked colors. A blocked current-color tap costs a heart. Tapping a future color is harmless.</p></div></div><div class="rule"><span class="rule-number">3</span><div><strong>Look for the letter.</strong><p>B, Y and R labels and numbered phases identify each color. Undo across a color boundary correctly locks the later phase again.</p></div></div></div><p>Your Original Game has its own levels, stars and saved attempt.</p><button class="primary" id="colorGotIt">${view==='home'?'Back to Home':'Back to the puzzle'}</button><button class="secondary" id="colorPractice">Practice Color Level 1</button>`);
 $('colorGotIt').onclick=closeModal;$('colorPractice').onclick=()=>{closeModal();profile.guideSteps=0;if(view==='home')startFromHome(1,true);else loadLevel(1,true);};
}
function selectMode(mode){
 if(view!=='home'||modalType||enteringHomeGame||!campaigns[mode]||mode===selectedMode)return;
 save();pendingHomeStars=0;homeUI.clearEffects();selectedMode=mode;({levels,profile}=campaigns[mode]);try{localStorage.setItem(MODE_SELECTION_KEY,mode);}catch{saveAvailable=false;}
 applySettings();loadLevel(profile.current,false,false);homeUI.render();document.title='Arrow Escape · Choose your game';tone('escape');
}

function setupEvents(){
 $('hint').onclick=useHint;$('undo').onclick=doUndo;$('restart').onclick=showRestart;$('levelsButton').onclick=showLevels;$('how').onclick=showHow;$('brand').onclick=()=>showHome();$('homeButton').onclick=()=>showHome();$('settings').onclick=showSettings;$('sound').onclick=toggleSound;$('closeModal').onclick=closeModal;$('modal').addEventListener('click',e=>{if(e.target===$('modal'))closeModal();});$('zoomIn').onclick=()=>zoom(.25);$('zoomOut').onclick=()=>zoom(-.25);$('zoomReset').onclick=resetZoom;
 document.addEventListener('keydown',e=>{
  if(modalType){if(e.key==='Escape'){closeModal();return;}if(e.key==='Tab'){const list=[...document.querySelector('.modal-card').querySelectorAll('button:not([hidden]):not(:disabled), input')];const first=list[0],last=list.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}return;}
  if(e.ctrlKey||e.metaKey||e.altKey)return;if(view==='home'){if(e.key.toLowerCase()==='h')showHow();return;}if(e.key==='Escape'){showHome();return;}
  const arrow=e.target.closest?.('[data-arrow]');if(arrow&&(e.key==='Enter'||e.key===' ')){e.preventDefault();attempt(arrow.dataset.arrow);return;}
  if(arrow&&['ArrowRight','ArrowDown','ArrowLeft','ArrowUp'].includes(e.key)){e.preventDefault();const list=[...elements.values()].filter(n=>!n.g.classList.contains('departing'));const i=list.findIndex(n=>n.g===arrow),step=['ArrowRight','ArrowDown'].includes(e.key)?1:-1;list[(i+step+list.length)%list.length]?.g.focus();return;}
  if(e.key.toLowerCase()==='h')useHint();else if(e.key.toLowerCase()==='u')doUndo();else if(e.key.toLowerCase()==='r')showRestart();else if(e.key==='+'||e.key==='=')zoom(.25);else if(e.key==='-')zoom(-.25);else if(e.key==='0')resetZoom();
 });
 setupPointers();addEventListener('resize',()=>{clampPan();transformBoard();});document.addEventListener('visibilitychange',()=>{if(document.hidden)save();});addEventListener('pagehide',save);
 let last=performance.now(),lastSave=0;setInterval(()=>{const now=performance.now(),delta=Math.min((now-last)/1000,1.1);last=now;if(view==='game'&&!document.hidden&&!modalType&&run.outcome==='playing'){run.elapsed+=delta;analytics.addPlayTime(delta);if(!busy)idleSeconds+=delta;const nudge=!busy&&shouldNudge(run,idleSeconds,!!level.tutorial&&profile.guideSteps<2);$('hint').classList.toggle('nudge',nudge);if(nudge&&idleSeconds<13)say('Need a little help? A hint can show one clear exit.');updateClock();if(run.timed&&run.elapsed>=timeLimit()){run.outcome='lost';save();updateStatus();showLoss();}if(now-lastSave>5000){save();lastSave=now;}}},250);
}
async function boot(){
 try{const response=await fetch('./levels.json');if(!response.ok)throw new Error('Level data could not be loaded');levels=await response.json();const colorResponse=await fetch('./color-levels.json');if(!colorResponse.ok)throw new Error('Color puzzles could not be loaded');const colorLevels=await colorResponse.json();const adventureResponse=await fetch('./adventure-levels.json');if(!adventureResponse.ok)throw new Error('Adventure puzzles could not be loaded');const adventureLevels=await adventureResponse.json();
  let storage;try{storage=localStorage;}catch{saveAvailable=false;storage={getItem:()=>null};}campaigns=readCampaigns(storage,{original:levels,color:colorLevels,adventure:adventureLevels});try{const savedMode=storage.getItem(MODE_SELECTION_KEY);if(campaigns[savedMode])selectedMode=savedMode;}catch{}
  for(const campaign of Object.values(campaigns))campaign.profile.settings={...campaigns.original.profile.settings};({levels,profile}=campaigns[selectedMode]);applySettings();loadLevel(profile.current,false,false);setupEvents();
  homeUI=createHomeUI({getState:()=>({profile,levels,run,selectedMode,campaigns}),isVisible:()=>view==='home'&&!modalType&&!enteringHomeGame,onStart:startFromHome,onHelp:showHow,onLevels:showLevels,onSettings:showSettings,onSound:toggleSound,onFeature:showFeature,onMode:selectMode,onNote:()=>tone('escape')});
  showHome(false);if(!saveAvailable)$('homeResumeCaption').textContent='Browser saving is unavailable. You can still play.';
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
 }catch(error){$('homeStart').disabled=false;$('homeStartText').textContent='RETRY';$('homeStart').onclick=()=>location.reload();$('homeError').hidden=false;$('homeError').textContent='The puzzles could not load. Check your connection and tap Retry.';$('homeScreen').setAttribute('aria-busy','false');}
}
boot();
