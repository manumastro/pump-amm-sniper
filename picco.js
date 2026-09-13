const fs=require('fs');
const {PublicKey}=require('@solana/web3.js');
const {canonicalPumpPoolPda}=require('@pump-fun/pump-swap-sdk');
const RPC='https://solana-rpc.publicnode.com';
const WSOL='So11111111111111111111111111111111111111112';
const pausa=ms=>new Promise(r=>setTimeout(r,ms));
async function rpc(m,p,t=0){try{
 const r=await fetch(RPC,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:m,params:p}),signal:AbortSignal.timeout(25000)});
 const j=await r.json(); if(j.error){if(t<5){await pausa(2500*(t+1));return rpc(m,p,t+1);}throw new Error(j.error.message);} return j.result;
}catch(e){if(t<5){await pausa(2500*(t+1));return rpc(m,p,t+1);}throw e;}}

const CASI=JSON.parse(fs.readFileSync('casi.json','utf8'));
(async()=>{
 const out=[];
 for(const c of CASI){
  const pool=canonicalPumpPoolPda(new PublicKey(c.mint)).toBase58();
  const pagine=[];let before=null;
  for(let i=0;i<120;i++){
   const r=await rpc('getSignaturesForAddress',[pool,before?{limit:1000,before}:{limit:1000}]);
   if(!r||!r.length)break;pagine.push(r);before=r[r.length-1].signature;
   if(r.length<1000)break;await pausa(120);
  }
  const crono=[];for(let i=pagine.length-1;i>=0;i--)for(let j=pagine[i].length-1;j>=0;j--)crono.push(pagine[i][j]);
  if(crono.length<3){out.push({...c,errore:'poche firme'});continue;}
  const t0=crono[0].blockTime;
  // ~60 campioni distribuiti su tutta la vita della pool
  const passo=Math.max(1,Math.floor(crono.length/60));
  const camp=[];for(let i=0;i<crono.length;i+=passo)camp.push(crono[i]);
  if(camp[camp.length-1]!==crono[crono.length-1])camp.push(crono[crono.length-1]);
  const punti=[];
  for(const s of camp){
   const tx=await rpc('getTransaction',[s.signature,{maxSupportedTransactionVersion:0,encoding:'jsonParsed'}]);
   if(!tx)continue;
   const bal=tx.meta.postTokenBalances||[];
   const q=bal.find(x=>x.mint===WSOL&&x.owner===pool);
   const b=bal.find(x=>x.mint===c.mint&&x.owner===pool);
   if(!q||!b)continue;
   const sol=Number(q.uiTokenAmount.uiAmount),tok=Number(b.uiTokenAmount.uiAmount);
   if(!(tok>0))continue;
   punti.push({min:Math.round((s.blockTime-t0)/60*10)/10,prezzo:sol/tok});
   await pausa(90);
  }
  if(!punti.length){out.push({...c,errore:'nessun prezzo'});continue;}
  const p0=punti[0].prezzo;
  let max=punti[0];for(const p of punti)if(p.prezzo>max.prezzo)max=p;
  out.push({...c,pool,nPunti:punti.length,vitaMin:punti[punti.length-1].min,
   prezzo0:p0,piccoX:max.prezzo/p0,piccoMin:max.min,
   oraX:punti[punti.length-1].prezzo/p0,punti});
  console.error('ok',c.mint.slice(0,8),'picco',(max.prezzo/p0).toFixed(1)+'x','a',max.min,'min');
  await pausa(400);
 }
 fs.writeFileSync('picco.json',JSON.stringify(out,null,1));
 console.log(['token','esito','SOL1S','nostroPnL','piccoX','quando(min)','oraX','vita(min)'].join('\t'));
 for(const o of out.sort((a,b)=>(b.piccoX||0)-(a.piccoX||0)))
  console.log([o.mint.slice(0,8),o.esito,o.sol1s,o.pnl,
   o.piccoX?o.piccoX.toFixed(0)+'x':(o.errore||'-'),
   o.piccoMin??'-',o.oraX?o.oraX.toFixed(1)+'x':'-',o.vitaMin??'-'].join('\t'));
})();
