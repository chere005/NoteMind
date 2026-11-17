import {useEffect,useMemo,useRef,useSyncExternalStore} from 'react'
import {OverviewModels} from '../../page-overview-model.cjs'
import {OverviewCoordinator,loadOverviewPage} from '../../page-overview-coordinator.cjs'
import {OverviewThumbnailClient} from '../../overview-thumbnail-client.cjs'

const empty=Object.freeze([]),subscribeEmpty=()=>()=>{},readEmpty=()=>empty
// The App owns this controller above PadHost; a portal move only changes leases.
// Closed overviews retain no per-page subscriptions or background render worker.
export function usePageOverview(options:any){
 const latest=useRef(options);latest.current=options
 const view=useMemo(()=>{
  if(!options.open)return null
  const models=new OverviewModels({models:options.models,metadata:row=>latest.current.metadata(row),head:row=>latest.current.head(row),project:(page,strokes)=>latest.current.project(page,strokes),loadSaved:(id,settings)=>loadOverviewPage(latest.current.api,id,settings)}),client=new OverviewThumbnailClient(),render=Object.assign(client.render.bind(client),{dispose:()=>client.dispose()}),coordinator=new OverviewCoordinator({load:models.load,render})
  return{models,coordinator,mounts:0}
 },[options.open,options.models])
 const pages=useSyncExternalStore(view?.models.subscribe||subscribeEmpty,view?.models.getSnapshot||readEmpty,view?.models.getSnapshot||readEmpty)
 useEffect(()=>{if(!view)return;view.mounts++;return()=>{view.mounts--;queueMicrotask(()=>{if(!view.mounts){view.models.dispose();view.coordinator.dispose()}})}},[view])
 return{pages,coordinator:view?.coordinator,load:view?.models.load,move:(id:string,before:string|null)=>view?.models.move(id,before)}
}
