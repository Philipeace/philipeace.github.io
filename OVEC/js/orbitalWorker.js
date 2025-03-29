// orbitalWorker.js
// optional. If using static hosting, just ensure it's in the same domain/path.

importScripts('orbitalCalculations.js'); 
// If that fails on your host, you can inline the function code directly.

self.addEventListener('message',(ev)=>{
  const data= ev.data;
  if(data.type==='generate'){
    const {n,l,m,Zeff,numPoints}= data;
    const result= generatePointsForOrbital(n,l,m,Zeff,numPoints);
    self.postMessage({type:'result', payload: result});
  }
});
