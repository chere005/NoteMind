// Produce the Windows icon sizes from the app's master PNG.
const {app,nativeImage}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=nativeImage.createFromPath(path.join(root,'src/icon.png'));
if(source.isEmpty())throw Error('The NoteMind logo could not be loaded.');
const sizes=[16,20,24,32,40,48,64,128,256],images=sizes.map(size=>source.resize({width:size,height:size,quality:'best'}).toPNG());
const header=Buffer.alloc(6+16*sizes.length);header.writeUInt16LE(1,2);header.writeUInt16LE(sizes.length,4);
let offset=header.length;
sizes.forEach((size,i)=>{const at=6+i*16;header[at]=header[at+1]=size===256?0:size;header.writeUInt16LE(1,at+4);header.writeUInt16LE(32,at+6);header.writeUInt32LE(images[i].length,at+8);header.writeUInt32LE(offset,at+12);offset+=images[i].length;});
fs.writeFileSync(path.join(root,'src/icon.ico'),Buffer.concat([header,...images]));app.exit(0);
