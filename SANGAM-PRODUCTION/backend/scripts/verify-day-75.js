'use strict';
const fs=require('fs'),path=require('path');
let p=0,f=0;
function t(n,fn){try{fn();console.log('  \u2705 '+n);p++}catch(e){console.error('  \u274C '+n+': '+e.message);f++}}
t('esbuild in frontend devDeps',()=>{const p=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','frontend','package.json')));if(!p.devDependencies.esbuild)throw 1});
t('frontend test script exists',()=>{if(!fs.existsSync(path.join(__dirname,'..','..','frontend','scripts','verify-day-27.cjs')))throw 1});
console.log(`\nDay 75: ${p} pass, ${f} fail`);if(f)process.exitCode=1;
