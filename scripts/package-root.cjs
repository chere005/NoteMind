const fs=require('node:fs'),path=require('node:path');
module.exports=function packageRoot(name,from=process.cwd()){
 let root=path.dirname(require.resolve(name,{paths:[from]}));
 for(;;){const file=path.join(root,'package.json');if(fs.existsSync(file)){const pkg=JSON.parse(fs.readFileSync(file,'utf8'));if(pkg.name&&pkg.version)return {root,pkg};}const parent=path.dirname(root);if(parent===root)throw Error('Cannot find the package manifest for '+name);root=parent;}
};
