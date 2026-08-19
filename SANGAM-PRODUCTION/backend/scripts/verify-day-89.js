'use strict';
const fs=require('fs'),path=require('path');
let p=0,f=0;
function t(n,fn){try{fn();console.log('  \u2705 '+n);p++}catch(e){console.error('  \u274C '+n+': '+e.message);f++}}
t('air-gapped smoke test exists',()=>{if(!fs.existsSync(path.join(__dirname,'..','..','scripts','air-gapped-smoke-test.js')))throw 1});
t('CI/CD workflow exists',()=>{if(!fs.existsSync(path.join(__dirname,'..','..','.github','workflows','ci.yml')))throw 1});
t('smoke test file is non-empty',()=>{const c=fs.readFileSync(path.join(__dirname,'..','..','scripts','air-gapped-smoke-test.js'),'utf8');if(c.length<200)throw 1});
t('CI workflow references postgres service',()=>{const c=fs.readFileSync(path.join(__dirname,'..','..','.github','workflows','ci.yml'),'utf8');if(!c.includes('postgres:16-alpine'))throw 1});
console.log(`\nDay 89: ${p} pass, ${f} fail`);if(f)process.exitCode=1;
