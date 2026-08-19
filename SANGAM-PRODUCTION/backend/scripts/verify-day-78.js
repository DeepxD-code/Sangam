'use strict';
const fs=require('fs'),path=require('path');
let p=0,f=0;
function t(n,fn){try{fn();console.log('  \u2705 '+n);p++}catch(e){console.error('  \u274C '+n+': '+e.message);f++}}
t('supply-chain.service.js loads',()=>{require('../src/services/supply-chain.service.js')});
t('service has TRANSFER_STATUS enum',()=>{const S=require('../src/services/supply-chain.service.js');if(!S.TRANSFER_STATUS)throw 1});
t('supply chain audit doc exists',()=>{if(!fs.existsSync(path.join(__dirname,'..','..','docs','supply-chain-domain-audit.md')))throw 1});
console.log(`\nDay 78: ${p} pass, ${f} fail`);if(f)process.exitCode=1;
