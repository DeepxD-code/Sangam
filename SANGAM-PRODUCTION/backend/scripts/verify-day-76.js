'use strict';
const fs=require('fs'),path=require('path');
let p=0,f=0;
function t(n,fn){try{fn();console.log('  \u2705 '+n);p++}catch(e){console.error('  \u274C '+n+': '+e.message);f++}}
t('12 frontend components',()=>{const c=fs.readdirSync(path.join(__dirname,'..','..','frontend','src','components'));if(c.length<12)throw 1});
t('18 frontend pages',()=>{const c=fs.readdirSync(path.join(__dirname,'..','..','frontend','src','pages'));if(c.length<18)throw 1});
t('LoginPage has AUTHENTICATE label',()=>{const c=fs.readFileSync(path.join(__dirname,'..','..','frontend','src','pages','LoginPage.jsx'),'utf8');if(!c.includes('AUTHENTICATE'))throw 1});
console.log(`\nDay 76: ${p} pass, ${f} fail`);if(f)process.exitCode=1;
