export const isBoxDrag = (x,y) => Math.max(Math.abs(x),Math.abs(y)) >= 4;
export const pressureScale = p => .2 + 1.6 * Math.min(Math.max(Number.isFinite(p) ? p : .5,0),1);
export const newID = () => crypto.randomUUID();
export const noTransform = () => ({dx:0,dy:0,scale:1,rotation:0});
export const INK_MIN_HEIGHT = 48;
export const WIDTH_LADDER = [1, 2, 3, 5, 8, 12, 16];

export const zoomScale = (b,s) => {const w=b.width*s.width,h=b.height*s.height;return w<=1||h<=1||s.width<=1||s.height<=1?1:Math.min(s.width/w,s.height/h)};
export const unzoomedPoint=(p,b,s)=>{const k=zoomScale(b,s);return {x:(b.x+b.width/2)*s.width+(p.x-s.width/2)/k,y:(b.y+b.height/2)*s.height+(p.y-s.height/2)/k}};
export const zoomedPoint=(p,b,s)=>{const k=zoomScale(b,s);return {x:s.width/2+(p.x-(b.x+b.width/2)*s.width)*k,y:s.height/2+(p.y-(b.y+b.height/2)*s.height)*k}};


export const PRESET_COLOURS=["#F2542D","#F5B700","#2FBF71","#2D7DD2","#8E44AD","#1C1C1E"];
