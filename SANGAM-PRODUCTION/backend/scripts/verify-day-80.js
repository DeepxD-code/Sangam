'use strict';
const fs=require('fs');
let p=0,f=0;
function t(n,fn){try{fn();console.log('  \u2705 '+n);p++}catch(e){console.error('  \u274C '+n+': '+e.message);f++}}
t('catch(()=>{}) eliminated across all services',()=>{const path=require('path');const dir=path.join(__dirname,'..','src','services');const svcs=fs.readdirSync(dir).filter(f=>f.endsWith('.js'));let bare=0;svcs.forEach(s=>{const c=fs.readFileSync(path.join(dir,s),'utf8');const lines=c.split('\n').filter(l=>!l.trim().startsWith('*')&&!l.trim().startsWith('//'));bare+=lines.filter(l=>l.includes('.catch(() => {}')||l.includes('.catch(() =>{')||l.includes('.catch( ()=>{}')).length});if(bare>0)throw new Error(bare+' silent catch(()=>{}) remain across all services')});
console.log(`\nDay 80: ${p} pass, ${f} fail`);if(f)process.exitCode=1;
