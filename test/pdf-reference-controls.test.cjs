const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{transformSync}=require('esbuild');
const {PDFReferenceView}=require('../src/pdf-reference-views.cjs'),code=transformSync(fs.readFileSync(require.resolve('../src/tablet/renderer/PDFReferenceWorkspace.tsx'),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
function render(state={}){
 const owner=new PDFReferenceView({path:'fixture.pdf'});Object.assign(owner.snapshot,state);const hooks={useRef:current=>({current}),useEffect(){},useLayoutEffect(){},useSyncExternalStore:(_subscribe,get)=>get()},jsx=(type,props)=>({type,props}),module={exports:{}};
 const imports={react:hooks,'react/jsx-runtime':{jsx,jsxs:jsx},'../../pdf-reference-views.cjs':{PDFReferenceView},'../../pdf-ink-transfer.js':{create:()=>({})},'./tabletPage':{fitRect:()=>({width:400,height:600})}};
 vm.runInNewContext(code,{module,exports:module.exports,require:name=>imports[name]||{},window:{notemind:{reference:{}},NoteMindPDFReferences:{}},Map,Set,Promise,setTimeout,clearTimeout,document:{}});
 const tree=module.exports.PDFReferenceWorkspace({doc:{path:'fixture.pdf'},active:true,session:owner,colour:'#123456',width:2}),find=(node,predicate)=>{if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of Array.isArray(node.props?.children)?node.props.children:[node.props?.children]){const found=Array.isArray(child)?child.map(value=>find(value,predicate)).find(Boolean):find(child,predicate);if(found)return found;}return null;};
 return{owner,input:find(tree,node=>node.type==='input'&&node.props['aria-label']==='PDF page number'),fit:find(tree,node=>node.props?.title==='Fit the entire PDF page'),surface:find(tree,node=>node.props?.paperOverride&&node.props?.frame&&node.props?.ref)};
}
test('PDF page entry cannot throw or navigate before its source opens or while a page loads',()=>{
 for(const state of [{},{loading:true},{opened:{id:'source',pageCount:3},loading:true}]){const {owner,input}=render(state);assert.ok(input);assert.doesNotThrow(()=>input.props.onKeyDown({key:'Enter',preventDefault(){}}));assert.equal(input.props.disabled,true);assert.equal(owner.refs.request.current,0);assert.equal(owner.snapshot.page,1);}
 const ready=render({opened:{id:'source',pageCount:3},loading:false});assert.equal(ready.input.props.disabled,false);assert.equal(ready.input.props.title,'PDF page number');
});

test('PDF Fit resets both layout zoom and the drawing surface precision view',()=>{
 const h=render({opened:{id:'source',pageCount:3},zoom:2,shown:{info:{width:600,height:900},model:{aspect:2/3,strokes:[]}}});let fitted=0;h.surface.props.ref.current={fitView:()=>fitted++};h.fit.props.onClick();assert.equal(h.owner.snapshot.zoom,1);assert.equal(fitted,1);
});

test('PDF page entry leaves IME confirmation to its owner before ordinary Enter navigation',()=>{for(const composing of [{nativeEvent:{isComposing:true}},{keyCode:229},{nativeEvent:{keyCode:229}},{isComposing:true}]){const {owner,input}=render({opened:{id:'source',pageCount:3},pageInput:'2'});let prevented=0;input.props.onKeyDown({key:'Enter',preventDefault(){prevented++;},...composing});assert.equal(owner.refs.request.current,0);assert.equal(owner.snapshot.page,1);assert.equal(prevented,0);}const ordinary=render({opened:{id:'source',pageCount:3},pageInput:'2'});ordinary.input.props.onKeyDown({key:'Enter',preventDefault(){}});assert.equal(ordinary.owner.refs.request.current,1);});
