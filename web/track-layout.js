// Markers represent starts only. Nearby starts share a disclosure, never a duration bar.
export function groupTrackEntries(entries,duration,width,minGap=36){
 const span=duration>0?duration:1,groups=[];
 for(const entry of entries){
  if(!Number.isFinite(entry.at)||entry.at<0||entry.at>duration)continue;
  const previous=groups.at(-1);
  if(previous&&(entry.at-previous[0].at)/span*Math.max(1,width)<minGap)previous.push(entry);
  else groups.push([entry]);
 }
 return groups;
}
