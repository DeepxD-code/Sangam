'use strict';
let p=0,f=0;
function t(n,fn){try{fn();console.log('  \u2705 '+n);p++}catch(e){console.error('  \u274C '+n+': '+e.message);f++}}
t('PKI extracts COLONEL identity',()=>{const P=require('../src/services/pki-auth-stub.service.js');const p=new P();const id=p.extractIdentity('TEST-CERT-A1B2C3');if(!id||id.rank!=='COLONEL'||id.serialNumber!=='IN-ARMY-0001')throw 1});
t('PKI extracts supply_officer role',()=>{const P=require('../src/services/pki-auth-stub.service.js');const p=new P();const id=p.extractIdentity('TEST-CERT-D4E5F6');if(!id||id.roleSlug!=='supply_officer')throw 1});
t('PKI extracts viewer role',()=>{const P=require('../src/services/pki-auth-stub.service.js');const p=new P();const id=p.extractIdentity('TEST-CERT-G7H8I9');if(!id||id.roleSlug!=='viewer')throw 1});
console.log(`\nDay 87: ${p} pass, ${f} fail`);if(f)process.exitCode=1;
