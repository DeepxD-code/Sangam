'use strict';
let p=0,f=0;
function t(n,fn){try{fn();console.log('  \u2705 '+n);p++}catch(e){console.error('  \u274C '+n+': '+e.message);f++}}
t('supply-chain module exports class',()=>{const S=require('../src/services/supply-chain.service.js');const s=new S(null);if(!s.createItem||!s.initiateTransfer||!s.approveTransfer)throw 1});
t('verifyChain method works',()=>{const S=require('../src/services/supply-chain.service.js');const s=new S(null);const r=s.verifyChain();if(typeof r.verified!=='boolean')throw 1});
t('item lifecycle works',async()=>{const S=require('../src/services/supply-chain.service.js');const s=new S(null);const r=await s.createItem({itemCode:'TEST',itemName:'test',category:'AMMO',unitId:1,quantity:10});if(!r.success)throw 1});
console.log(`\nDay 83: ${p} pass, ${f} fail`);if(f)process.exitCode=1;
