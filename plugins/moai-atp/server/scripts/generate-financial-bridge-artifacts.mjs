import {mkdir,writeFile} from 'node:fs/promises';
import {z} from 'zod';
import {FinancialFactBindingSchema,FinancialFactHandoffEnvelopeSchema,assembleFinancialFact} from '../dist/src/financial-fact-bridge.js';
import {bridgeFixture,secRoleFixture,syntheticVerifier,VERIFIED} from '../dist/test/financial-bridge-fixtures.js';
await mkdir('contracts/financial-bridge',{recursive:true});await mkdir('fixtures/financial-bridge',{recursive:true});
const write=async(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n');
await write('contracts/financial-bridge/fact-binding-v1.schema.json',z.toJSONSchema(FinancialFactBindingSchema));
await write('contracts/financial-bridge/fact-handoff-envelope-v1.schema.json',z.toJSONSchema(FinancialFactHandoffEnvelopeSchema));
for(const provider of ['SEC','opendart']){const{c,b}=await bridgeFixture(provider);await write(`fixtures/financial-bridge/${provider.toLowerCase()}-synthetic-input.json`,{candidate:c,binding:b});await write(`fixtures/financial-bridge/${provider.toLowerCase()}-synthetic-handoff.json`,await assembleFinancialFact(c,b,syntheticVerifier,()=>VERIFIED));}
const facts={};for(const[role,value]of [['reported.revenue','1000'],['reported.operating_profit','200']]){const{c,b}=await secRoleFixture(role,value);facts[role]=(await assembleFinancialFact(c,b,syntheticVerifier,()=>VERIFIED)).fact;}
await write('fixtures/financial-bridge/synthetic-operating-margin-input.json',{cutoff:'2026-10-22T00:00:00.123456789Z',facts});
