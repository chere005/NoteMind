(function(root){
 function clamp(value,min,max){return Math.min(max,Math.max(min,value));}
 function selection(a,b,width,height){const x=Math.floor(clamp(Math.min(a.x,b.x),0,width)),y=Math.floor(clamp(Math.min(a.y,b.y),0,height));const right=Math.ceil(clamp(Math.max(a.x,b.x),0,width)),bottom=Math.ceil(clamp(Math.max(a.y,b.y),0,height));return {x,y,width:right-x,height:bottom-y};}
 function output(width,height,rotation){return Math.abs(rotation%180)===90?{width:height,height:width}:{width,height};}
 const api={selection,output};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.NoteMindPictureGeometry=api;
})(typeof window==='undefined'?globalThis:window);
