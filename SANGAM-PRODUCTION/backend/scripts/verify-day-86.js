'use strict';
let p=0,f=0;
function t(n,fn){try{fn();console.log('  \u2705 '+n);p++}catch(e){console.error('  \u274C '+n+': '+e.message);f++}}
t('PKI auth stub class loads',()=>{const P=require('../src/services/pki-auth-stub.service.js');if(typeof P!=='function')throw 1});
t('PKI verifies known test cert',()=>{const P=require('../src/services/pki-auth-stub.service.js');const p=new P();const r=p.verifyCacCertificate('TEST-CERT-A1B2C3');if(!r.verified)throw new Error(r.error)});
t('PKI rejects unknown cert',()=>{const P=require('../src/services/pki-auth-stub.service.js');const p=new P();const r=p.verifyCacCertificate('FAKE');if(r.verified)throw 1});
t('PKI extractIdentity works',()=>{const P=require('../src/services/pki-auth-stub.service.js');const p=new P();const id=p.extractIdentity('TEST-CERT-D4E5F6');if(!id||id.rank!=='MAJOR')throw 1});
t('PKI has 3 test identities',()=>{const P=require('../src/services/pki-auth-stub.service.js');const p=new P();if(p.getTestIdentities().length!==3)throw 1});
console.log(`\nDay 86: ${p} pass, ${f} fail`);if(f)process.exitCode=1;
