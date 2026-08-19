'use strict';
const fs=require('fs'),path=require('path');
let p=0,f=0;
function t(n,fn){try{fn();console.log('  \u2705 '+n);p++}catch(e){console.error('  \u274C '+n+': '+e.message);f++}}
t('F3: block before deduct in approveTransfer',()=>{const c=fs.readFileSync(path.join(__dirname,'..','src','services','supply-chain.service.js'),'utf8');const b=c.indexOf('await this._recordBlock({');const d=c.indexOf('item.quantity -= transfer.quantity');if(b===-1||d===-1)throw 1;if(b>d)throw new Error('deduct before block!')});
console.log(`\nDay 81: ${p} pass, ${f} fail`);if(f)process.exitCode=1;
