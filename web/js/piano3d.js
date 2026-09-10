import * as T from 'three';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';
import { motionFromSample } from './music/camshaft.js';
import { ASSEMBLY_GUIDE, assemblySteps, AssemblyClock, buildAssemblyUnits, unitProgress } from './piano3d-assembly.js';
import { buildPiano, overview } from './piano3d-model.js';

const $ = id => document.getElementById(id);
const embedded = document.documentElement.dataset.view === 'home';
const host=$('scene'), slider=$('explode'), select=$('part-select');
const reduced=matchMedia('(prefers-reduced-motion: reduce)');
const renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
renderer.setClearColor(0xf4f5f8);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=T.PCFSoftShadowMap;
renderer.toneMapping=T.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.08;
renderer.domElement.tabIndex=0;
renderer.domElement.setAttribute('aria-label',embedded?'Piano 3D. Flèches pour tourner, plus et moins pour zoomer.':'Piano 3D. Flèches pour tourner, plus et moins pour zoomer. Les composants sont aussi accessibles dans la liste.');
host.append(renderer.domElement);
const scene=new T.Scene(); scene.background=new T.Color(0xf4f5f8);
scene.fog=new T.Fog(0xf4f5f8,48,95);
const camera=new T.PerspectiveCamera(36,1,.025,150);
const controls=new OrbitControls(camera,renderer.domElement);
controls.enableDamping=true;controls.dampingFactor=.075;controls.minDistance=.6;controls.maxDistance=58;controls.maxPolarAngle=Math.PI*.85;controls.minPolarAngle=.045;
controls.autoRotateSpeed=.65;controls.enablePan=true;controls.screenSpacePanning=true;controls.zoomToCursor=true;controls.target.set(0,3.7,0);
const pmrem=new T.PMREMGenerator(renderer), room=new RoomEnvironment();
const environment=pmrem.fromScene(room,.025);scene.environment=environment.texture;scene.environmentIntensity=.72;room.dispose();pmrem.dispose();
scene.add(new T.HemisphereLight(0xe4edff,0x706c63,1.6));
const key=new T.DirectionalLight(0xfff2dc,3);key.position.set(-10,18,10);key.castShadow=true;
key.shadow.mapSize.set(2048,2048);key.shadow.camera.left=-20;key.shadow.camera.right=20;key.shadow.camera.top=20;key.shadow.camera.bottom=-20;key.shadow.camera.far=55;key.shadow.normalBias=.04;key.shadow.bias=-.00015;key.shadow.radius=4;scene.add(key);
const fill=new T.DirectionalLight(0xdce6ff,1.8);fill.position.set(12,10,-7);scene.add(fill);
const rim=new T.DirectionalLight(0xffffff,2);rim.position.set(-9,6,-12);scene.add(rim);
const floor=new T.Mesh(new T.PlaneGeometry(180,180),new T.MeshStandardMaterial({color:0xf4f5f8,roughness:1}));floor.rotation.x=-Math.PI/2;floor.position.y=-.34;floor.receiveShadow=true;scene.add(floor);
const {root,parts,pickables,animateMechanism}=buildPiano();scene.add(root);
const buildClock=new AssemblyClock(), buildUnits=buildAssemblyUnits(parts);
let building=false, savedExploration=null, buildUiIndex=-1;
let cutaway=false, motionEnabled=true, liveState=null, receivedAt=0;
const shellIds=new Set(['body','lid','strings','base','stand']);
const byId=new Map(parts.map(p=>[p.id,p]));
for(const p of parts) {const option=document.createElement('option');option.value=p.id;option.textContent=p.title;select.append(option);}
$('part-count').textContent=`${parts.length} éléments`;
let selected=null, explosion=embedded||reduced.matches?0:1, targetExplosion=0, introStart=performance.now(), assembling=!embedded&&!reduced.matches, lastTime=performance.now(), cameraTween=null, frame=0;
const neutral=new T.Color(0xb4bac5), blue=new T.Color(0x013afb);
root.updateMatrixWorld(true);
for(const p of parts) p.homeBounds=new T.Box3().setFromObject(p.group);
const guideMaterial=new T.LineDashedMaterial({color:0x8797b7,transparent:true,opacity:0,dashSize:.09,gapSize:.11});
const guides=[];
for(const p of parts.filter(p=>!p.id.startsWith('key-')&&p.id!=='base')) {
  const geometry=new T.BufferGeometry().setFromPoints([p.home,p.home.clone().add(p.offset)]);
  const line=new T.Line(geometry,guideMaterial);line.computeLineDistances();line.visible=false;scene.add(line);guides.push({line,p});
}
function info(data) {
  const fragment=document.createDocumentFragment(), title=document.createElement('h2'), description=document.createElement('p'), dl=document.createElement('dl');
  title.textContent=data.title;description.textContent=data.description;
  fragment.append(title,description);
  for(const [name,value] of data.facts) {const row=document.createElement('div'),dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=value;row.append(dt,dd);dl.append(row);}
  fragment.append(dl);
  if(data.context){const context=document.createElement('p');context.className='part-context';context.textContent=data.context;fragment.append(context);}
  $('part-info').replaceChildren(fragment);
  document.querySelector('.inspector').scrollTop=0;
}
info(overview);
function fittedView(amount, direction=new T.Vector3(1,.95,1.6)) {
  direction.normalize();
  const bounds=new T.Box3(), boxes=parts.map(p=>p.homeBounds.clone().translate(p.offset.clone().multiplyScalar(amount)));
  boxes.forEach(box=>bounds.union(box));
  const target=bounds.getCenter(new T.Vector3());target.y+=.3;
  const right=new T.Vector3().crossVectors(new T.Vector3(0,1,0),direction).normalize();
  const up=new T.Vector3().crossVectors(direction,right).normalize();
  const tan=Math.tan(T.MathUtils.degToRad(camera.fov/2));
  let distance=0;
  for(const box of boxes) for(const x of [box.min.x,box.max.x]) for(const y of [box.min.y,box.max.y]) for(const z of [box.min.z,box.max.z]) {
    const point=new T.Vector3(x,y,z).sub(target),depth=point.dot(direction);
    distance=Math.max(distance,Math.abs(point.dot(up))/(tan*.79)+depth,Math.abs(point.dot(right))/(tan*camera.aspect*.88)+depth);
  }
  return {target,position:target.clone().addScaledVector(direction,distance)};
}
function moveCamera(position,target) {cameraTween={from:camera.position.clone(),to:position,start:performance.now(),fromTarget:controls.target.clone(),target};}
function resetView(top=false) {
  setSelection(null,false);
  const view=fittedView(targetExplosion,top?new T.Vector3(0,1,.001):undefined);
  moveCamera(view.position,view.target);
}
function setSelection(p,focus=true) {
  if(building&&p){buildClock.playing=false;updateBuildUI();}
  $('part-info').hidden=building&&!p;
  selected=p;select.value=p?.id||'';info(p||overview);$('clear').hidden=!p;
  if(cutaway)setCutaway(true);
  document.querySelectorAll('[data-part]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.part===p?.id)));
  if(p&&focus) {
    // Keep the requested assembled position; reveal the interior without moving parts.
    if(['motor','hub','sensor','cams','hammers','dampers','strings'].includes(p.id)&&targetExplosion<.6) setCutaway(true);
    const target=p.homeBounds.getCenter(new T.Vector3()).addScaledVector(p.offset,targetExplosion);
    const distance=Math.max(3,p.homeBounds.getSize(new T.Vector3()).length()*1.45);
    const offset=camera.position.clone().sub(controls.target).normalize().multiplyScalar(distance);
    moveCamera(target.clone().add(offset),target);
  }
}
function setSpread(value) {
  assembling=false;targetExplosion=T.MathUtils.clamp(value,0,1);slider.value=Math.round(targetExplosion*100);updateAmount(targetExplosion);
  const view=fittedView(targetExplosion,camera.position.clone().sub(controls.target));moveCamera(view.position,view.target);
}
function updateAmount(value) {const percent=Math.round(value*100);$('amount').textContent=`${percent} %`;slider.setAttribute('aria-valuetext',`${percent} pour cent, ${percent===0?'piano assemblé':percent===100?'piano éclaté':'pièces écartées'}`);}
slider.addEventListener('input',()=>{setSpread(Number(slider.value)/100);if(selected)setSelection(null,false);});
select.addEventListener('change',()=>setSelection(byId.get(select.value)||null));
document.querySelectorAll('[data-part]').forEach(button=>button.addEventListener('click',()=>setSelection(byId.get(button.dataset.part))));
$('clear').addEventListener('click',()=>resetView());
$('home').addEventListener('click',()=>resetView());$('top').addEventListener('click',()=>resetView(true));
$('rotate').addEventListener('click',()=>{controls.autoRotate=!controls.autoRotate;$('rotate').setAttribute('aria-pressed',String(controls.autoRotate));});
$('assemble').addEventListener('click',()=>{
  setSelection(null,false);controls.autoRotate=false;$('rotate').setAttribute('aria-pressed','false');
  if(reduced.matches){setSpread(0);resetView();return;}
  assembling=true;introStart=performance.now();explosion=1;targetExplosion=0;resetView();
});
controls.addEventListener('start',()=>{if(assembling){assembling=false;targetExplosion=explosion;}cameraTween=null;controls.autoRotate=false;$('rotate').setAttribute('aria-pressed','false');$('tooltip').hidden=true;});
function setCutaway(enabled) {
  cutaway=enabled;$('cutaway').setAttribute('aria-pressed',String(enabled));
  for(const p of parts) {
    const active=p===selected||(selected?.id==='keyboard'&&p.type==='keyboard');
    const faded=enabled&&(selected?!active:shellIds.has(p.id));
    for(const m of p.materials){m.transparent=faded;m.opacity=faded?(selected?.05:.14):1;m.depthWrite=!faded;m.needsUpdate=true;}
    p.meshes.forEach(m=>m.castShadow=!faded);
  }
}
$('cutaway').addEventListener('click',()=>setCutaway(!cutaway));
function zoom(factor){cameraTween=null;const offset=camera.position.clone().sub(controls.target);offset.setLength(T.MathUtils.clamp(offset.length()*factor,controls.minDistance,controls.maxDistance));camera.position.copy(controls.target).add(offset);controls.update();}
$('zoom-in').addEventListener('click',()=>zoom(.75));$('zoom-out').addEventListener('click',()=>zoom(1.33));
function setText(id,text){if($(id).textContent!==text)$(id).textContent=text;}
function renderLiveStatus() {
  const state=liveState;
  $('motion').disabled=building||(!state?.playing&&!motionEnabled);
  $('motion').setAttribute('aria-pressed',String(motionEnabled));
  $('motion').querySelector('span').textContent=motionEnabled?'Arrêter l’animation':'Animer le piano';
  setText('live-track',state?.title||'Aucune musique en lecture');
  let message='Lancez un morceau dans le jukebox pour animer la mécanique.';
  if(building)message='Montage en cours · la musique continue dans le jukebox.';
  else if(state?.playing) message=!motionEnabled?'Activez l’animation pour explorer le piano pendant la lecture.':!state.motorEnabled?'Commande moteur désactivée dans les réglages.':state.connected?'Consigne du hub en direct · phase mécanique estimée.':'Aperçu sans piano connecté · phase mécanique estimée.';
  else if(state?.title)message='Lecture en pause · la mécanique est à l’arrêt.';
  setText('live-status',message);
  $('live-power').hidden=!motionEnabled||!state?.playing;
  if(state)setText('live-power',`Moteur ${Math.abs(state.power)} %${state.power<0?' · sens inverse':''}`);
}
$('motion').addEventListener('click',()=>{
  if(!motionEnabled&&!liveState?.playing)return;
  motionEnabled=!motionEnabled;
  if(assembling){assembling=false;targetExplosion=explosion;}
  renderLiveStatus();
});
window.addEventListener('message',event=>{
  if(event.source!==window.parent||event.origin!==location.origin||event.data?.type!=='piano3d:state')return;
  const s=event.data.state;
  if(!s||typeof s.playing!=='boolean'||typeof s.title!=='string'||![s.power,s.angle,s.amplitude].every(Number.isFinite))return;
  liveState=s;receivedAt=performance.now();renderLiveStatus();
});
if(window.parent!==window)window.parent.postMessage('piano3d:ready',location.origin);
for(const [i,step] of assemblySteps.entries()){
  const option=document.createElement('option');option.value=i;option.textContent=`${String(i+1).padStart(2,'0')} · ${step.title}`;$('build-chapter').append(option);
}
function updateBuildUI(){
  const step=assemblySteps[buildClock.index], complete=buildClock.index===assemblySteps.length-1&&buildClock.progress===1;
  if(buildUiIndex!==buildClock.index){
    buildUiIndex=buildClock.index;
    setText('build-title',step.title);setText('build-description',step.description);
    setText('build-page',`Notice LEGO · pages ${step.firstPage}–${step.lastPage}`);
    $('build-source').href=`${ASSEMBLY_GUIDE}#page=${step.firstPage}`;
    $('build-chapter').value=buildClock.index;$('build-seek').value=buildClock.index+1;
    $('build-seek').setAttribute('aria-valuetext',`Séquence ${buildClock.index+1} sur ${assemblySteps.length} : ${step.title}`);
    setText('build-count',`${buildClock.index+1} / ${assemblySteps.length}`);
    document.querySelector('.scene-title p').textContent=step.title;
  }
  $('build-prev').disabled=buildClock.index===0;$('build-next').disabled=buildClock.index===assemblySteps.length-1;
  setText('build-play',complete?'Rejouer':buildClock.playing?'Pause':'Lire');
  $('build-play').setAttribute('aria-label',complete?'Rejouer le montage':buildClock.playing?'Mettre le montage en pause':'Lire le montage');
  setText('build-status',complete?'Montage terminé. Explorez le piano ou rejouez la construction.':buildClock.playing?'Montage en cours · cliquez sur une pièce pour faire une pause.':'En pause · tournez et zoomez pour examiner le montage.');
}
function seekBuild(index){
  buildClock.seek(index);setSelection(null,false);setCutaway(false);updateBuildUI();
}
function renderBuild(dt){
  const previous=buildClock.index;buildClock.advance(dt);
  if(previous!==buildClock.index){setSelection(null,false);setCutaway(false);}
  for(const [phase,units] of buildUnits.entries())for(const [i,unit] of units.entries()){
    const progress=unitProgress(buildClock,phase,i,units.length);
    unit.mesh.visible=progress>=0;
    unit.mesh.position.copy(unit.home);
    if(progress>=0&&progress<1&&!reduced.matches)unit.mesh.position.y+=1.4*(1-progress)**3;
  }
  updateBuildUI();
}
function startBuild(){
  if(building)return;
  savedExploration={spread:targetExplosion,motion:motionEnabled,cutaway,selected};
  building=true;assembling=false;explosion=targetExplosion=0;updateAmount(0);slider.value=0;
  controls.autoRotate=false;$('rotate').setAttribute('aria-pressed','false');
  setSelection(null,false);setCutaway(false);
  document.body.classList.add('build-mode');$('build-panel').hidden=false;$('build-controls').hidden=false;$('exploration-controls').hidden=true;
  document.querySelector('.scene-title h1').textContent='Le piano prend forme';
  buildUiIndex=-1;buildClock.restart();if(reduced.matches)buildClock.seek(0);
  renderBuild(0);renderLiveStatus();resetView();$('build-play').focus();
}
function exitBuild(){
  building=false;buildClock.playing=false;
  for(const units of buildUnits)for(const unit of units){unit.mesh.visible=true;unit.mesh.position.copy(unit.home);}
  document.body.classList.remove('build-mode');$('build-panel').hidden=true;$('build-controls').hidden=true;$('exploration-controls').hidden=false;
  const heading=document.querySelector('.scene-title h1');heading.replaceChildren(document.createTextNode('À l’intérieur'),document.createElement('br'),document.createTextNode('du piano'));const accent=document.createElement('span');accent.textContent='_';heading.append(accent);
  document.querySelector('.scene-title p').textContent='Chaque pièce a son rôle. Explorez-le.';
  motionEnabled=savedExploration.motion;setSpread(savedExploration.spread);setSelection(savedExploration.selected,false);setCutaway(savedExploration.cutaway);renderLiveStatus();$('build-start').focus();
}
$('build-start').addEventListener('click',startBuild);$('build-exit').addEventListener('click',exitBuild);
$('build-play').addEventListener('click',()=>{setSelection(null,false);setCutaway(false);buildClock.toggle();updateBuildUI();});
$('build-prev').addEventListener('click',()=>seekBuild(buildClock.index-1));$('build-next').addEventListener('click',()=>seekBuild(buildClock.index+1));
$('build-seek').addEventListener('input',()=>seekBuild(Number($('build-seek').value)-1));
$('build-chapter').addEventListener('change',()=>seekBuild(Number($('build-chapter').value)));
$('build-speed').addEventListener('change',()=>{buildClock.speed=Number($('build-speed').value);});
const raycaster=new T.Raycaster(), pointer=new T.Vector2();let down=null;
function hit(event) {
  const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera);
  return raycaster.intersectObjects(pickables.filter(m=>m.visible&&m.material.opacity>=.5),false)[0]?.object.userData.part||null;
}
renderer.domElement.addEventListener('pointerdown',event=>{down={x:event.clientX,y:event.clientY,id:event.pointerId};});
renderer.domElement.addEventListener('pointerup',event=>{if(!embedded&&down&&down.id===event.pointerId&&Math.hypot(event.clientX-down.x,event.clientY-down.y)<6)setSelection(hit(event));down=null;});
renderer.domElement.addEventListener('pointercancel',()=>down=null);
renderer.domElement.addEventListener('pointerleave',()=>{$('tooltip').hidden=true;down=null;});
renderer.domElement.addEventListener('pointermove',event=>{
  if(embedded||event.buttons||event.pointerType==='touch')return;
  const p=hit(event),tooltip=$('tooltip');renderer.domElement.style.cursor=p?'pointer':'grab';tooltip.hidden=!p;
  if(p){const rect=host.getBoundingClientRect();tooltip.textContent=p.title;tooltip.style.left=`${Math.min(event.clientX-rect.left+14,rect.width-200)}px`;tooltip.style.top=`${Math.max(4,event.clientY-rect.top-38)}px`;}
});
renderer.domElement.addEventListener('keydown',event=>{
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','+','=','-'].includes(event.key))return;
  event.preventDefault();cameraTween=null;
  const offset=camera.position.clone().sub(controls.target),spherical=new T.Spherical().setFromVector3(offset);
  if(event.key==='ArrowLeft')spherical.theta-=.13;if(event.key==='ArrowRight')spherical.theta+=.13;
  if(event.key==='ArrowUp')spherical.phi-=.10;if(event.key==='ArrowDown')spherical.phi+=.10;
  if(event.key==='+'||event.key==='=')spherical.radius*=.9;if(event.key==='-')spherical.radius*=1.1;
  spherical.phi=T.MathUtils.clamp(spherical.phi,controls.minPolarAngle,controls.maxPolarAngle);spherical.radius=T.MathUtils.clamp(spherical.radius,controls.minDistance,controls.maxDistance);
  camera.position.copy(controls.target).add(new T.Vector3().setFromSpherical(spherical));controls.update();
});
function resize() {const {width,height}=host.getBoundingClientRect();if(!width||!height)return;camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height,false);if(!selected){const view=fittedView(explosion);camera.position.copy(view.position);controls.target.copy(view.target);cameraTween=null;}}
const observer=new ResizeObserver(resize);observer.observe(host);resize();controls.update();
$('loading').hidden=true;host.setAttribute('aria-busy','false');
function render(now) {
  const elapsed=Math.max(0,(now-lastTime)/1000),dt=Math.min(elapsed,.05);lastTime=now;
  if(assembling) {
    const t=T.MathUtils.clamp((now-introStart-350)/2300,0,1);explosion=(1-t)**3;slider.value=Math.round(explosion*100);updateAmount(explosion);
    const view=fittedView(explosion);camera.position.copy(view.position);controls.target.copy(view.target);cameraTween=null;
    if(t===1)assembling=false;
  } else {explosion=reduced.matches?targetExplosion:T.MathUtils.damp(explosion,targetExplosion,7,dt);if(Math.abs(explosion-targetExplosion)<.0001)explosion=targetExplosion;}
  for(const p of parts) {
    const active=p===selected||(selected?.id==='keyboard'&&p.type==='keyboard');
    p.focus=reduced.matches?(active?1:0):T.MathUtils.damp(p.focus,active?1:0,10,dt);
    p.group.position.copy(p.home).addScaledVector(p.offset,explosion);
    for(const m of p.materials) {m.color.copy(m.userData.originalColor);if(selected&&!active)m.color.lerp(neutral,.32);if(p.focus>.001){m.color.lerp(blue,p.focus*.36);m.emissive.copy(blue);m.emissiveIntensity=p.focus*.12;}else m.emissiveIntensity=0;}
  }
  if(building)renderBuild(elapsed);
  const motion=motionFromSample(liveState,now-receivedAt,motionEnabled&&!building);
  animateMechanism(motion.angle,motion.amplitude);
  if(!building&&motionEnabled&&liveState?.playing&&now-receivedAt>300) setText('live-status','Synchronisation interrompue · animation en attente.');
  guideMaterial.opacity=Math.max(0,explosion-.15)*.3;
  for(const {line,p} of guides){line.visible=explosion>.2;const positions=line.geometry.attributes.position;positions.setXYZ(1,p.group.position.x,p.group.position.y,p.group.position.z);positions.needsUpdate=true;line.computeLineDistances();}
  if(cameraTween){const t=T.MathUtils.clamp((now-cameraTween.start)/(reduced.matches?1:800),0,1),e=1-(1-t)**3;camera.position.lerpVectors(cameraTween.from,cameraTween.to,e);controls.target.lerpVectors(cameraTween.fromTarget,cameraTween.target,e);if(t===1)cameraTween=null;}
  controls.update(dt);renderer.render(scene,camera);frame=requestAnimationFrame(render);
}
frame=requestAnimationFrame(render);
document.addEventListener('visibilitychange',()=>{cancelAnimationFrame(frame);if(!document.hidden){lastTime=performance.now();frame=requestAnimationFrame(render);}});
renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();cancelAnimationFrame(frame);$('error').hidden=false;});
window.addEventListener('pagehide',()=>{
  cancelAnimationFrame(frame);observer.disconnect();controls.dispose();environment.dispose();
  const geometries=new Set(),materials=new Set();scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.material)materials.add(object.material);});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());renderer.dispose();renderer.forceContextLoss();
},{once:true});
