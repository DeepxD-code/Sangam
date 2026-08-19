'use strict';
const fs=require('fs'),path=require('path');
let p=0,f=0;
function t(n,fn){try{fn();console.log('  \u2705 '+n);p++}catch(e){console.error('  \u274C '+n+': '+e.message);f++}}
t('blockchain migration has transaction_data',()=>{const c=fs.readFileSync(path.join(__dirname,'..','..','database','migrations','day-90-blockchain-persist.sql'),'utf8');if(!c.includes('transaction_data'))throw 1});
t('_persistBlock serializes transaction_data',()=>{const c=fs.readFileSync(path.join(__dirname,'..','src','services','supply-chain.service.js'),'utf8');if(!c.includes('JSON.stringify(block.transactionData)'))throw 1});
t('_persistBlock uses _trackWrite',()=>{const c=fs.readFileSync(path.join(__dirname,'..','src','services','supply-chain.service.js'),'utf8');if(!c.includes('this._trackWrite(this._persistBlock(block))'))throw 1});
console.log(`\nDay 82: ${p} pass, ${f} fail`);if(f)process.exitCode=1;
