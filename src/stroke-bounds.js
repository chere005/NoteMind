// Immutable committed stroke objects share bounds across hit tests, viewport and tile work.
const shared=globalThis.NoteMindStrokeBounds||(()=>{const boxes=new WeakMap();
 function primeStrokeBox(stroke,box){boxes.set(stroke,{count:stroke.points.length,...box});}
 function strokeBox(stroke){let box=boxes.get(stroke);if(!box||box.count!==stroke.points.length){box={count:stroke.points.length,x:Infinity,y:Infinity,right:-Infinity,bottom:-Infinity};for(const point of stroke.points){box.x=Math.min(box.x,point.x);box.y=Math.min(box.y,point.y);box.right=Math.max(box.right,point.x);box.bottom=Math.max(box.bottom,point.y);}boxes.set(stroke,box);}return box;}
 return {strokeBox,primeStrokeBox};})();
globalThis.NoteMindStrokeBounds=shared;
module.exports=shared;
