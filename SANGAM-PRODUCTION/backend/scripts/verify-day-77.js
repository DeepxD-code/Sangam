'use strict';
const fs=require('fs'),path=require('path');
let p=0,f=0;
function t(n,fn){try{fn();console.log('  \u2705 '+n);p++}catch(e){console.error('  \u274C '+n+': '+e.message);f++}}
t('test:frontend in root package.json',()=>{const p=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','package.json')));if(!p.scripts['test:frontend'])throw 1});
t('test:all references frontend',()=>{const p=JSON.parse(fs.readFileSync(path.join(__dirname,'..','..','package.json')));if(!p.scripts['test:all'].includes('test:frontend'))throw 1});
console.log(`\nDay 77: ${p} pass, ${f} fail`);if(f)process.exitCode=1;
