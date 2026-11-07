// Every start has its own target. Resolve collisions vertically, never by moving time.
export function layoutTrackEntries(entries,duration,width,targetWidth=44,gap=8){
 const span=duration>0?duration:1,rowEnds=[],markers=[];
 const valid=entries.filter(entry=>Number.isFinite(entry.at)&&entry.at>=0&&entry.at<=duration).slice().sort((a,b)=>a.at-b.at||a.message.id-b.message.id);
 for(const entry of valid){
  const x=entry.at/span*Math.max(0,width);
  let row=rowEnds.findIndex(previous=>x-previous>=targetWidth+gap);
  if(row<0)row=rowEnds.length;
  rowEnds[row]=x;markers.push({entry,row,x});
 }
 return {markers,rows:Math.max(1,rowEnds.length)};
}
