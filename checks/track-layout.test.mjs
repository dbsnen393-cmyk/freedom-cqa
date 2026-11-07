import {test} from 'node:test';
import assert from 'node:assert/strict';
import {layoutTrackEntries} from '../web/track-layout.js';
const entry=(id,at)=>({message:{id},at});

function assertSeparateTargets(layout,width=44,gap=8){
 for(let i=0;i<layout.markers.length;i++)for(let j=i+1;j<layout.markers.length;j++){
  const a=layout.markers[i],b=layout.markers[j];
  if(a.row===b.row)assert.ok(Math.abs(a.x-b.x)>=width+gap,'Targets must not overlap in one row');
 }
}

test('Each duplicate start keeps a separate marker and the exact same horizontal timestamp',()=>{
 const entries=Array.from({length:12},(_,i)=>entry(i+1,2));
 const layout=layoutTrackEntries(entries,10,400);
 assert.deepEqual(layout.markers.map(marker=>marker.entry),entries);
 assert.equal(layout.rows,12);
 assert.deepEqual(layout.markers.map(marker=>marker.row),Array.from({length:12},(_,i)=>i));
 assert.ok(layout.markers.every(marker=>marker.x===80));
 assertSeparateTargets(layout);
});

test('Dense and widely spaced starts reuse rows without grouping or moving any time',()=>{
 const entries=[entry(1,0),entry(2,2),entry(3,2.01),entry(4,4),entry(5,10)];
 const layout=layoutTrackEntries(entries,10,200);
 assert.deepEqual(layout.markers.map(marker=>marker.entry),entries);
 for(const marker of layout.markers)assert.equal(marker.x,marker.entry.at/10*200);
 assert.ok(layout.rows<entries.length);
 assertSeparateTargets(layout);
});

test('Resizing never loses a start or overlaps its target',()=>{
 const entries=Array.from({length:60},(_,i)=>entry(i+1,Math.floor(i/3)/10));
 for(const width of [1,100,400,1200]){
  const layout=layoutTrackEntries(entries,2,width);
  assert.deepEqual(layout.markers.map(marker=>marker.entry),entries);
  assertSeparateTargets(layout);
  assert.ok(layout.markers.every(marker=>marker.row<layout.rows));
 }
});

test('Missing, negative and beyond-recording timestamps are excluded; the exact end remains clickable',()=>{
 const entries=[entry(1,null),entry(2,-1),entry(3,NaN),entry(4,0),entry(5,5),entry(6,5.01),entry(7,Infinity)];
 const layout=layoutTrackEntries(entries,5,400);
 assert.deepEqual(layout.markers.map(marker=>marker.entry.message.id),[4,5]);
 assert.deepEqual(layout.markers.map(marker=>marker.x),[0,400]);
});

test('Zero and subsecond timelines use actual starts without inventing duration',()=>{
 const entries=[entry(1,0),entry(2,0),entry(3,.25),entry(4,.5)];
 const zero=layoutTrackEntries(entries,0,400);
 assert.deepEqual(zero.markers.map(marker=>[marker.entry.message.id,marker.x,marker.row]),[[1,0,0],[2,0,1]]);
 const fractional=layoutTrackEntries(entries,.5,400);
 assert.deepEqual(fractional.markers.map(marker=>marker.x),[0,0,200,400]);
 assertSeparateTargets(fractional);
 assert.equal(layoutTrackEntries([],0,400).markers.length,0);
});
