import {darkerThanPaper, marks, thinnedWriting, writingMask} from './cameraInkLift';
/** Lift dark strokes from a photograph onto a transparent image. */
export function liftedWriting(pixels, width, height, colour) {
 const gray=new Uint8Array(width*height);
 for(let i=0;i<gray.length;i++)gray[i]=Math.round(pixels[i*4]*.299+pixels[i*4+1]*.587+pixels[i*4+2]*.114);
 const mask=writingMask(thinnedWriting(marks(darkerThanPaper(gray,width,height),width,height)));
 const out=new Uint8ClampedArray(width*height*4); const match=/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(colour);const rgb=match?match.slice(1).map(x=>parseInt(x,16)):[0,0,0];
 for(let i=0;i<mask.length;i++){if(mask[i]){out[i*4]=rgb[0];out[i*4+1]=rgb[1];out[i*4+2]=rgb[2];out[i*4+3]=255;}}
 return out;
}
