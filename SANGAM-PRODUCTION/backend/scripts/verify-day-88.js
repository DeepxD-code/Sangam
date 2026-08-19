'use strict';
let p=0,f=0;
function t(n,fn){try{fn();console.log('  \u2705 '+n);p++}catch(e){console.error('  \u274C '+n+': '+e.message);f++}}
t('PKI disabled mode',()=>{const P=require('../src/services/pki-auth-stub.service.js');const p=new P({enabled:false});const r=p.verifyCacCertificate('TEST-CERT-A1B2C3');if(r.verified!==false||!r.error.includes('disabled'))throw 1});
t('PKI rejects empty input',()=>{const P=require('../src/services/pki-auth-stub.service.js');const p=new P();const r=p.verifyCacCertificate('');if(r.verified!==false)throw 1});
t('PKI rejects null input',()=>{const P=require('../src/services/pki-auth-stub.service.js');const p=new P();const r=p.verifyCacCertificate(null);if(r.verified!==false)throw 1});
console.log(`\nDay 88: ${p} pass, ${f} fail`);if(f)process.exitCode=1;
