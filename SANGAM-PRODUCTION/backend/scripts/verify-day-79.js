'use strict';
const fs=require('fs'),path=require('path');
let p=0,f=0;
function t(n,fn){try{fn();console.log('  \u2705 '+n);p++}catch(e){console.error('  \u274C '+n+': '+e.message);f++}}
t('catch(()=>{}) eliminated in supply-chain',()=>{const c=fs.readFileSync(path.join(__dirname,'..','src','services','supply-chain.service.js'),'utf8');const codeLines=c.split('\n').filter(l=>!l.trim().startsWith('*'));const bare=codeLines.filter(l=>l.includes('.catch(() =>')).length;if(bare>0)throw new Error(bare+' bare catches remain')});
console.log(`\nDay 79: ${p} pass, ${f} fail`);if(f)process.exitCode=1;
