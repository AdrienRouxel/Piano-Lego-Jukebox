import assert from 'node:assert/strict';
import { buildPiano } from '../web/js/piano3d-model.js';
import { Box3, Raycaster, Vector3 } from '../web/vendor/three/three.module.min.js';

const { root, parts, pickables, animateMechanism, rig, outline } = buildPiano();
root.updateMatrixWorld(true);
assert.equal(new Set(parts.map(p => p.id)).size, parts.length, 'Selectable IDs must be unique');
const keys = parts.filter(p => p.id.startsWith('key-'));
assert.equal(keys.length, 25, 'The real keyboard has 25 keys');
assert.equal(keys.filter(p => p.facts.some(([k,v]) => v === 'Touche noire')).length, 10);
for (const amount of [0, .5, 1]) {
  for (const part of parts) part.group.position.copy(part.home).addScaledVector(part.offset, amount);
  root.updateMatrixWorld(true);
  const bounds = new Box3().setFromObject(root);
  assert.ok([...bounds.min, ...bounds.max].every(Number.isFinite), 'All assembly states have finite bounds');
  assert.ok(bounds.min.y > -.5, 'Parts must stay above the studio floor');
}
// In exploded view the motor must be independently reachable by a real raycast.
const motor = parts.find(p => p.id === 'motor');
const origin = motor.group.position.clone().add(new Vector3(10, 0, 0));
const hits = new Raycaster(origin, new Vector3(-1, 0, 0)).intersectObjects(pickables, false);
assert.equal(hits[0]?.object.userData.part.id, 'motor');
for (const part of parts) {
  assert.ok(part.meshes.length && part.description && part.facts.length, `${part.id} must have geometry and an information sheet`);
  for (const material of part.materials) {
    assert.ok(!parts.some(other => other !== part && other.materials.includes(material)), 'Highlight must not leak into another part');
  }
}
// Regression: all electronics, including shafts, studs and cables, fit in the
// real curved footprint at 0%, above the chassis and below the soundboard.
for (const part of parts) part.group.position.copy(part.home);
root.updateMatrixWorld(true);
const polygon=outline.getPoints(160);
function inside(x,z) {
  let result=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++) {
    const a=polygon[i],b=polygon[j];
    if((a.y>z)!==(b.y>z)&&x<(b.x-a.x)*(z-a.y)/(b.y-a.y)+a.x)result=!result;
  }
  return result;
}
for(const id of ['motor','hub','sensor']) {
  const bounds=new Box3().setFromObject(parts.find(p=>p.id===id).group);
  for(const x of [bounds.min.x,bounds.max.x])for(const z of [bounds.min.z,bounds.max.z]) assert.ok(inside(x,z),`${id} protrudes from the curved casing`);
  assert.ok(bounds.min.y>=5.04,`${id} protrudes below the chassis`);
  assert.ok(bounds.max.y<6.23,`${id} intersects the soundboard`);
}
const {camLift,motionFromSample}=await import('../web/js/music/camshaft.js');
for(const angle of [0,.5,1.5,3,6]) {
  animateMechanism(angle,1);
  for(let i=0;i<25;i++) {
    assert.equal(rig.keyPivots[i].rotation.x,camLift(angle,1,i)*.12);
    assert.equal(rig.hammerPivots[i].rotation.x,camLift(angle,1,i)*.48);
  }
}
animateMechanism(2,0);
assert.ok(rig.keyPivots.every(p=>p.rotation.x===0));
const sample={playing:true,power:-60,angle:2,amplitude:1};
assert.ok(motionFromSample(sample,40,true).angle<2,'Reverse motor command rotates backwards');
assert.equal(motionFromSample(sample,400,true).amplitude,0,'Lost live feed stops animation');
assert.equal(motionFromSample({...sample,playing:false},0,true).amplitude,0,'Pause stops animation');
assert.equal(motionFromSample(sample,0,false).amplitude,0,'Opt-out leaves keys still');
const {publishPianoState,subscribePianoState,getPianoState}=await import('../web/js/piano3d-state.js');
const received=[];const unsubscribe=subscribePianoState(s=>received.push(s));
publishPianoState({...sample,title:'Test'},100);
publishPianoState({...sample,title:'Test',angle:3},110);
assert.equal(getPianoState().angle,3,'Late subscribers receive the latest phase');
publishPianoState({...sample,title:'Test',playing:false,power:0},111);
assert.equal(received.at(-1).playing,false,'Pause bypasses the 25 Hz throttle');
unsubscribe();const count=received.length;publishPianoState(sample,200);assert.equal(received.length,count);
console.log('Piano 3D: keyboard, geometry, exploded states, picking and independent highlights verified.');


// Every procedural mesh belongs to one verified booklet chapter, exactly once.
const { assemblySteps, AssemblyClock, buildAssemblyUnits, unitProgress } = await import('../web/js/piano3d-assembly.js');
const units=buildAssemblyUnits(parts), meshes=parts.flatMap(p=>p.meshes);
assert.equal(units.length,16);
assert.ok(units.every(group=>group.length>0));
assert.equal(units.flat().length,meshes.length);
assert.equal(new Set(units.flat().map(u=>u.mesh)).size,meshes.length);
assert.ok(units[2].every(u=>u.part.id==='motor'));
assert.ok(units[15].every(u=>u.part.id==='bench'));
const clock=new AssemblyClock();
clock.restart();clock.advance(3);
assert.equal(clock.index,0);assert.equal(clock.progress,.5);
clock.playing=false;clock.advance(30);assert.equal(clock.progress,.5,'Pause must freeze construction');
clock.speed=2;clock.playing=true;clock.advance(1.5);
assert.equal(clock.index,1);assert.equal(clock.progress,0,'Speed changes must preserve elapsed progress');
clock.seek(10);assert.equal(clock.playing,false);assert.equal(clock.progress,1);
assert.equal(unitProgress(clock,2,0,10),1);
assert.equal(unitProgress(clock,11,0,10),-1,'Future meshes cannot be displayed or picked');
clock.seek(0);assert.equal(unitProgress(clock,2,0,10),-1,'Seeking backward removes later pieces');
clock.restart();clock.speed=8;clock.advance(12);
assert.equal(clock.index,15);assert.equal(clock.progress,1);assert.equal(clock.playing,false);
for(const [phase,group] of units.entries())group.forEach((u,i)=>assert.equal(unitProgress(clock,phase,i,group.length),1,'Completion restores every mesh'));
clock.toggle();assert.equal(clock.index,0);assert.equal(clock.progress,0);assert.equal(clock.playing,true);
clock.advance(NaN);assert.equal(clock.progress,0);
const a=new AssemblyClock(),b=new AssemblyClock();a.restart();b.restart();a.advance(9);
for(let i=0;i<90;i++)b.advance(.1);
assert.equal(a.index,b.index);assert.ok(Math.abs(a.progress-b.progress)<1e-12,'Playback is independent of render frame rate');
assert.ok(assemblySteps.every(s=>s.firstPage<=s.lastPage&&s.firstPage>=18&&s.lastPage<=543));
console.log('Montage 3D : séquences, couverture, vitesse, pause, retour et fin OK');
