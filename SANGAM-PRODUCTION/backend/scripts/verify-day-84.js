'use strict';
const fs=require('fs'),path=require('path');
let p=0,f=0;
function t(n,fn){try{fn();console.log('  \u2705 '+n);p++}catch(e){console.error('  \u274C '+n+': '+e.message);f++}}
t('audit doc has 9 findings',()=>{const c=fs.readFileSync(path.join(__dirname,'..','..','docs','supply-chain-domain-audit.md'),'utf8');const n=(c.match(/### F\d/g)||[]).length;if(n<9)throw new Error('found '+n)});
t('audit doc has grade',()=>{const c=fs.readFileSync(path.join(__dirname,'..','..','docs','supply-chain-domain-audit.md'),'utf8');if(!c.includes('B+'))throw 1});
console.log(`\nDay 84: ${p} pass, ${f} fail`);if(f)process.exitCode=1;
