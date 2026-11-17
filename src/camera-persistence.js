const {SheetSaveQueue}=require('./sheet-save-queue.js');
const {SheetLazyLoader}=require('./sheet-lazy-loader.js');
const {SheetModelCache}=require('./sheet-model-cache.js');
const {cameraMetadata}=require('./camera-schema.cjs');
const {pictureRef}=require('./camera-pictures.js');

function cameraSnapshot(item) {
  const metadata=cameraMetadata({...item.cameraData,name:item.name,rotation:item.rotation,inkRotation:item.inkRotation,inkAspect:item.inkAspect,device:item.device,aspect:item.aspect,box:item.box,corners:item.corners,zoom:item.zoom});
  return {...metadata,pageId:item.pageId,geometryRevision:item.geometryRevision||null,extent:item.page.extent,
    ...(item.loaded===false?{loaded:false}:{strokes:item.page.strokes,backdrop:item.page.backdrop||item.picture?.source||null})};
}
class CameraPersistence {
  constructor({api,models,makePage,getActive=()=>null,pictures,onWarning=()=>{}}) {
    Object.assign(this,{api,models,makePage,getActive,pictures,onWarning});
    this.closed=false;this.loaded=false;this.pruning=null;
    this.queue=new SheetSaveQueue({saveSheetsDelta:delta=>api.saveCameraPagesDelta(delta)});
    this.cache=new SheetModelCache();
    const pageAPI={loadSheetPage:(id,options)=>api.loadCameraPage(id,options),loadSheetChunk:(...args)=>api.loadSheetChunk(...args),finishSheetLoad:(...args)=>api.finishSheetLoad(...args)};
    this.lazy=new SheetLazyLoader({api:pageAPI,queue:this.queue,getSheets:()=>this.models.current,install:(...args)=>this.install(...args)});
  }
  async load() {
    const state=await this.api.listCameraPages();
    if(this.closed)throw Error('Camera recovery cancelled.');
    this.queue.seedCatalog(state);
    if(state.pages.length) {
      const next=state.pages.map(row=>{
        const metadata=row.metadata,settings=metadata.camera;
        if(!settings)throw Error('Saved camera settings are missing.');
        cameraMetadata({...settings,name:metadata.name});
        const page=this.makePage();page.restoreExtent(metadata.extent);
        return {...settings,name:metadata.name,page,pageId:row.pageId,geometryRevision:row.geometryRevision,signature:row.signature,cameraData:settings,
          picture:null,hasPicture:!!row.backdropId,loaded:false,strokeCount:row.strokeCount,pointCount:row.pointCount};
      });
      this.models.update(next);
    }
    this.loaded=true;
    if(state.recoveryWarning)this.onWarning(state.recoveryWarning);
    return this.models.current;
  }
  async install(item,stored,state,ownership) {
    const picture=stored.backdrop?pictureRef(stored.backdrop):null;
    if(!await item.page.loadGeometryAsync(stored.strokes,ownership))throw Error('Camera recovery cancelled.');
    const current=this.models.current.find(row=>row.page===item.page&&row.pageId===item.pageId);
    if(!current||this.closed)throw Error('The camera page was closed.');
    item.page.restoreExtent(stored.extent);item.page.backdrop=stored.backdrop||null;
    const installed={...current,picture,hasPicture:!!picture,loaded:true,geometryRevision:stored.geometryRevision};
    this.models.update(old=>old.map(row=>row.page===item.page?installed:row));
    return installed;
  }
  ensure(page) {return this.lazy.ensure(page);}
  snapshot() {return this.models.current.map(cameraSnapshot);}
  async save() {
    if(!this.loaded||this.closed)throw Error('Camera pages could not be safely loaded.');
    const result=await this.queue.save(this.snapshot());
    this.onWarning(result?.durabilityWarning||'');
    await this.prune();return result;
  }
  prune() {
    if(this.pruning)return this.pruning;
    this.pruning=(async()=>{
      const active=this.getActive();if(active)this.cache.touch(active);
      // Exact durable array/background/metadata ownership is checked by canUnload;
      // do not rebuild content fingerprints just to consider evicting a clean model.
      const candidates=this.cache.candidates(this.models.current,{activePage:active,queue:this.queue,pending:new Set(this.models.current.filter(item=>this.lazy.pending.has(item.pageId)).map(item=>item.page)),signature:item=>this.queue.pageHeads.get(item.pageId)?.signature,metadata:cameraSnapshot});
      for(const {item} of candidates) {
        const current=this.models.current.find(row=>row.page===item.page);
        if(!current||current.page===this.getActive()||current.page.geometryRetained)continue;
        const snapshot=cameraSnapshot(current);
        if(!this.queue.canUnload(current.pageId,current.page.strokes,current.page.backdrop||null,snapshot))continue;
        const head=this.queue.pageHeads.get(current.pageId),unloaded={...current,picture:null,hasPicture:!!current.picture||!!current.page.backdrop,loaded:false,geometryRevision:head.geometryRevision,signature:head.signature};
        this.models.update(old=>old.map(row=>row.page===current.page?unloaded:row));
        const released=await this.queue.releasePage(current.pageId,cameraSnapshot(unloaded),{unload:()=>current.page.unloadGeometryAsync({valid:()=>!current.page.geometryRetained&&current.page!==this.getActive()})});
        if(released===false)this.models.update(old=>old.map(row=>row.page===current.page&&row.loaded===false&&row.picture===null&&row.geometryRevision===unloaded.geometryRevision
          ?{...row,picture:current.picture,hasPicture:current.hasPicture,loaded:true,geometryRevision:current.geometryRevision,signature:current.signature}:row));
        else if(current.picture)this.pictures?.forget(current.picture);
      }
    })().finally(()=>{this.pruning=null;});
    return this.pruning;
  }
  dispose() {
    if(this.closed)return;
    this.closed=true;this.lazy.dispose();this.queue.dispose();
    for(const item of this.models.current)void item.page.disposeAsync();
  }
}
module.exports={CameraPersistence,cameraSnapshot};
