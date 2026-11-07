import {test} from 'node:test';
import assert from 'node:assert/strict';
import {groupTrackEntries} from '../web/track-layout.js';
const entry=(id,at)=>({message:{id},at});

test('Every duplicate and dense start remains available in the track disclosures',()=>{
 const entries=[entry(1,0),entry(2,2),entry(3,2),entry(4,2.01),entry(5,4),entry(6,10)];
 const groups=groupTrackEntries(entries,10,200);
 assert.deepEqual(groups.flat(),entries);
 assert.deepEqual(groups.map(group=>group.map(e=>e.message.id)),[[1],[2,3,4],[5],[6]]);
 assert.deepEqual(groups.map(group=>group[0].at),[0,2,4,10]);
});

test('Resizing and touch target spacing change grouping without losing any message',()=>{
 const entries=Array.from({length:20},(_,i)=>entry(i+1,i/10));
 for(const width of [1,100,400,1200])for(const gap of [36,48]){
  const groups=groupTrackEntries(entries,2,width,gap);
  assert.deepEqual(groups.flat(),entries);
  for(let i=1;i<groups.length;i++)assert.ok((groups[i][0].at-groups[i-1][0].at)/2*width>=gap);
 }
});

test('The track excludes missing, negative and beyond-recording timestamps and keeps the exact end',()=>{
 const entries=[entry(1,null),entry(2,-1),entry(3,NaN),entry(4,0),entry(5,5),entry(6,5.01),entry(7,Infinity)];
 assert.deepEqual(groupTrackEntries(entries,5,400).flat().map(e=>e.message.id),[4,5]);
});

test('A zero-length timeline retains starts at zero without inventing duration',()=>{
 const entries=[entry(1,0),entry(2,0),entry(3,1)];
 assert.deepEqual(groupTrackEntries(entries,0,400),[[entries[0],entries[1]]]);
});
