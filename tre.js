const {PublicKey}=require('@solana/web3.js');
const {canonicalPumpPoolPda}=require('@pump-fun/pump-swap-sdk');
const RPC='https://solana-rpc.publicnode.com';
const WSOL='So11111111111111111111111111111111111111112';
const MINT='6agyG6m21AwAabMdm8W5Y8htPCf45a8AhTxsKVTpump';
const pausa=ms=>new Promise(r=>setTimeout(r,ms));
async function rpc(m,p,t=0){try{
 const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:m,params:p}),signal:AbortSignal.timeout(25000)});
 const j=await r.json();if(j.error){if(t<5){await pausa(2000);return rpc(m,p,t+1);}throw new Error(j.error.message);}return j.result;
}catch(e){if(t<5){await pausa(2000);return rpc(m,p,t+1);}throw e;}}
(async()=>{
 const pool=canonicalPumpPoolPda(new PublicKey(MINT)).toBase58();
 console.log('pool:',pool);
 const pagine=[];let before=null;
 for(let i=0;i<120;i++){const r=await rpc('getSignaturesForAddress',[pool,before?{limit:1000,before}:{limit:1000}]);
  if(!r||!r.length)break;pagine.push(r);before=r[r.length-1].signature;if(r.length<1000)break;await pausa(120);}
 const crono=[];for(let i=pagine.length-1;i>=0;i--)for(let j=pagine[i].length-1;j>=0;j--)crono.push(pagine[i][j]);
 const t0=crono[0].blockTime;
 console.log('firme totali:',crono.length,' pool creata:',new Date(t0*1000).toISOString());
 const leggi=async s=>{const tx=await rpc('getTransaction',[s,{maxSupportedTransactionVersion:0,encoding:'jsonParsed'}]);
  if(!tx)return null;const b=tx.meta.postTokenBalances||[];
  const q=b.find(x=>x.mint===WSOL&&x.owner===pool),k=b.find(x=>x.mint===MINT&&x.owner===pool);
  if(!q||!k)return null;
  const sol=Number(q.uiTokenAmount.uiAmount),tok=Number(k.uiTokenAmount.uiAmount);
  return {sol,tok,prezzo:sol/tok,quando:new Date(tx.blockTime*1000).toISOString().slice(11,19),min:((tx.blockTime-t0)/60).toFixed(1)};};
 // 1) creazione  2) al nostro ingresso (12:03:38 UTC)  3) il massimo
 const nostro=crono.find(s=>s.blockTime>=Math.floor(new Date('2026-09-13T12:03:38Z').getTime()/1000));
 const passo=Math.max(1,Math.floor(crono.length/80));
 let best=null,bestSig=null;
 for(let i=0;i<crono.length;i+=passo){const d=await leggi(crono[i].signature);
  if(d&&(!best||d.prezzo>best.prezzo)){best=d;bestSig=crono[i].signature;} await pausa(90);}
 for(const [et,sig] of [['CREAZIONE',crono[0].signature],['NOSTRO INGRESSO',nostro.signature],['MASSIMO',bestSig]]){
  const d=await leggi(sig);
  console.log('\n'+et,'  '+d.quando+' UTC  (min '+d.min+')');
  console.log('  SOL nel pool :',d.sol.toFixed(2));
  console.log('  token nel pool:',d.tok.toLocaleString('it'));
  console.log('  prezzo       :',d.prezzo.toExponential(4),'SOL/token');
  console.log('  https://solscan.io/tx/'+sig);
  await pausa(150);
 }
})();
