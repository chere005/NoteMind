export function selectionHit(box, point, tolerance) {
  if (!box) return 'new';
  const {x,y,width:w,height:h}=box;
  const nearX=point.x>=x-tolerance.x && point.x<=x+w+tolerance.x;
  const nearY=point.y>=y-tolerance.y && point.y<=y+h+tolerance.y;
  if (!nearX||!nearY) return 'new';
  const horizontal=Math.abs(point.x-x)<=tolerance.x?'w':Math.abs(point.x-x-w)<=tolerance.x?'e':'';
  const vertical=Math.abs(point.y-y)<=tolerance.y?'n':Math.abs(point.y-y-h)<=tolerance.y?'s':'';
  return vertical+horizontal || 'move';
}
export function selectionStep(gesture, point) {
  const {mode,start,box}=gesture, dx=point.x-start.x, dy=point.y-start.y;
  if(mode==='new')return {x:Math.min(start.x,point.x),y:Math.min(start.y,point.y),width:Math.abs(dx),height:Math.abs(dy)};
  if(mode==='move')return {...box,x:Math.max(0,Math.min(1-box.width,box.x+dx)),y:Math.max(0,Math.min(1-box.height,box.y+dy))};
  let x1=box.x,x2=box.x+box.width,y1=box.y,y2=box.y+box.height;
  if(mode.includes('w'))x1=Math.max(0,Math.min(x2-.005,x1+dx));
  if(mode.includes('e'))x2=Math.min(1,Math.max(x1+.005,x2+dx));
  if(mode.includes('n'))y1=Math.max(0,Math.min(y2-.005,y1+dy));
  if(mode.includes('s'))y2=Math.min(1,Math.max(y1+.005,y2+dy));
  return {x:x1,y:y1,width:x2-x1,height:y2-y1};
}
