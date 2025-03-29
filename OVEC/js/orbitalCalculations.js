// orbitalCalculations.js
// Full version with acceptance logic

function factorial(n) {
    if(n<0) return NaN;
    if(n===0) return 1;
    let r=1;
    for(let i=2; i<=n; i++){ r*=i; }
    return r;
  }
  
  function laguerre(n, alpha, x){
    if(n<0) return 0;
    if(n===0) return 1;
    let l0=1;
    let l1= 1+ alpha- x;
    if(n===1) return l1;
    let ln= l1;
    for(let i=1;i<n;i++){
      ln= ((2*i+1+alpha - x)* l1 - (i+alpha)* l0)/(i+1);
      if(!isFinite(ln)) return 0;
      l0= l1;
      l1= ln;
    }
    return ln;
  }
  
  function radialWaveFunction(n, l, Zeff){
    if(n<=0|| l<0|| l>=n|| Zeff<=0) return ()=>0;
    const Z_eff= Zeff;
    const factor= (2*Z_eff)/(n*1.0);
    const rho= (r)=> factor*r;
  
    const nc1= Math.pow((2*Z_eff)/n,3);
    const nc2= factorial(n-l-1);
    const nc3= 2*n* factorial(n+l);
  
    let norm;
    if(nc3===0|| nc2<0|| !isFinite(nc2)|| !isFinite(nc3)){
      norm=0;
    } else {
      const nsq= nc1*(nc2/nc3);
      norm= isFinite(nsq)&& nsq>=0? Math.sqrt(nsq):0;
    }
    if(norm===0) return ()=>0;
  
    return (r)=>{
      if(r<0) return 0;
      if(r<1e-9){
        return (l===0)? norm*n:0;
      }
      const rr= rho(r);
      const ln= n-l-1;
      const la= 2*l+1;
      if(ln<0|| la<0) return 0;
  
      const lag= laguerre(ln, la, rr);
      const eV= Math.exp(-rr/2);
      const pV= Math.pow(rr, l);
      if(!isFinite(eV)|| !isFinite(pV)|| !isFinite(lag)) return 0;
      const res= norm* eV* pV* lag;
      return isFinite(res)? res:0;
    };
  }
  function probabilityDensity(n,l,Zeff){
    const R= radialWaveFunction(n,l,Zeff);
    return (r)=>{
      if(r<0) return 0;
      const v= R(r);
      return v*v;
    };
  }
  
  function findRadialNodes(n,l,Zeff){
    const nodes= [];
    const ex= n-l-1;
    if(ex<=0) return nodes;
    const Rnl= radialWaveFunction(n,l,Zeff);
    if(!Rnl) return nodes;
  
    let sr= (n*n/ Zeff)*4+10;
    sr= Math.max(sr,10);
    if(Zeff<0.8) sr*=1.5;
    const steps=1000;
    const dr= sr/ steps;
  
    let pr= 1e-6;
    let pv= Rnl(pr);
    for(let i=1;i<= steps;i++){
      const cr= i*dr;
      const cv= Rnl(cr);
      if(isFinite(pv)&& isFinite(cv)&& pv* cv<0){
        const rNode= pr - pv*(cr-pr)/(cv- pv);
        if(isFinite(rNode)&& rNode>1e-5 && (nodes.length===0|| Math.abs(rNode- nodes[nodes.length-1])> dr/2)){
          nodes.push(rNode);
        }
      }
      pr= cr;
      pv= cv;
      if(nodes.length>=ex) break;
    }
    return nodes.sort((a,b)=> a-b);
  }
  
  // Slater
  function calculateSlaterZeff(target_n, target_l, eConfig, Zp){
    let S=0;
    for(const orb of eConfig){
      if(orb.electronsInOrbital===0) continue;
      let eIn= orb.electronsInOrbital;
      if(orb.n=== target_n && orb.l=== target_l){
        eIn= Math.max(0, orb.electronsInOrbital-1);
        if(eIn===0) continue;
        if(target_n===1) S+= eIn*0.30;
        else S+= eIn*0.35;
      } else if(orb.n=== target_n-1){
        if(target_l<=1) S+= eIn*0.85;
        else S+= eIn*1.00;
      } else if(orb.n< target_n-1){
        S+= eIn*1.00;
      }
    }
    const ze= Zp- S;
    return Math.max(ze,0.5);
  }
  
  // The improved generatePointsForOrbital
  function generatePointsForOrbital(n, l, m, Zeff, numPoints){
    const probFn= probabilityDensity(n,l,Zeff);
    const points= [];
    const radii= [];
    const probabilityValues= [];
  
    let rMin= Infinity, rMax= 0;
    let pMin= Infinity, pMax= 0;
  
    // find radial peak
    let searchRMax= (n*n/ Zeff)*6 + 15;
    searchRMax= Math.max(searchRMax,10);
    if(Zeff<0.8) searchRMax*=1.5;
    let maxProb= 0;
    let rPeak=0;
    const steps=300;
    const step= searchRMax/ steps;
    for(let rTest= step; rTest<= searchRMax; rTest+= step){
      const pr= probFn(rTest);
      if(pr> maxProb && isFinite(pr)){
        maxProb= pr;
        rPeak= rTest;
      }
    }
    let maxR_est;
    if(rPeak>0){
      maxR_est= rPeak*3.5+ 6.0; // slight bigger bounding
    } else {
      maxR_est= (n*n/ Zeff)*5+ 10;
    }
    maxR_est= Math.max(maxR_est, 10);
    if(Zeff<0.8) maxR_est*=1.5;
  
    if(!isFinite(maxProb)|| maxProb<1e-12){
      maxProb=1e-9;
    } else {
      maxProb*=1.05;
    }
  
    const maxAttemptsFactor= 1000+ l*300; 
    const maxAttempts= numPoints* maxAttemptsFactor;
  
    // Angular distribution
    const angularFactorSquared= (x,y,z,r)=>{
      if(r<1e-9){
        return (l===0)? 1.0/(4.0* Math.PI): 0;
      }
      const rx= x/r, ry= y/r, rz= z/r;
      if(l===0){
        return 1.0/(4.0* Math.PI);
      } else if(l===1){
        const f= 3.0/(4.0* Math.PI);
        if(m===0) return f* rz* rz;
        if(m===1) return f* rx* rx;
        if(m===-1) return f* ry* ry;
      } else if(l===2){
        const fb= 5.0/(16.0* Math.PI);
        const xy= rx* ry, xz= rx* rz, yz= ry* rz;
        const z2= rz* rz, x2my2= rx*rx- ry*ry;
        if(m===0) return fb* Math.pow(3.0*z2-1.0,2);
        if(m===1) return fb* 12.0* xz*xz;
        if(m===-1) return fb* 12.0* yz*yz;
        if(m===2) return fb* 3.0* x2my2*x2my2;
        if(m===-2) return fb* 12.0* xy*xy;
      } else if(l===3){
        // etc
        // omitted for brevity
        return 1.0/(4.0* Math.PI);
      }
      return 1.0/(4.0* Math.PI);
    };
  
    // We raise these to reduce rejections
    let maxAngEst;
    if(l===0) maxAngEst= 1.0/(4.0*Math.PI);
    else if(l===1) maxAngEst= (3.0/(4.0*Math.PI))*1.0;
    else if(l===2) maxAngEst= (5.0/(4.0* Math.PI))* 3.0; // bigger
    else if(l===3) maxAngEst= (7.0/(4.0* Math.PI))* 3.0; 
    else maxAngEst= 1.0/(4.0* Math.PI);
  
    const safeMax= maxAngEst*1.1;
  
    let attempts=0;
    while(points.length< numPoints && attempts< maxAttempts){
      attempts++;
      const x= (Math.random()*2-1)* maxR_est;
      const y= (Math.random()*2-1)* maxR_est;
      const z= (Math.random()*2-1)* maxR_est;
      const r= Math.sqrt(x*x+ y*y+ z*z);
      if(r> maxR_est|| r<1e-9) continue;
  
      const pRad= probFn(r);
      if(!isFinite(pRad)|| pRad<0) continue;
      const aF= angularFactorSquared(x,y,z,r);
      if(!isFinite(aF)|| aF<0) continue;
  
      const tot= pRad* aF;
      const threshold= Math.random()* (maxProb* safeMax);
      if(threshold< tot){
        points.push(new THREE.Vector3(x,y,z));
        radii.push(r);
        probabilityValues.push(pRad);
  
        if(r< rMin) rMin= r;
        if(r> rMax) rMax= r;
        if(pRad< pMin) pMin= pRad;
        if(pRad> pMax) pMax= pRad;
      }
    }
  
    if(points.length===0 && numPoints>0){
      console.warn(`Orbital ${n}${getOrbTypeChar(l)}(m=${m}) => 0 points.`);
      rMin=0; rMax=1; pMin=0; pMax=1e-9;
    } else {
      if(!isFinite(rMin)) rMin=0;
      if(!isFinite(rMax)|| rMax<= rMin) rMax= rMin+1e-6;
      if(!isFinite(pMin)) pMin=0;
      if(!isFinite(pMax)|| pMax<= pMin) pMax= pMin+1e-9;
    }
  
    return { points, radii, rMin, rMax, probabilityValues, pMin, pMax };
  }
  
  // config
  function getElectronConfigurationList(numElectrons){
    const cList= [];
    const sList= [];
    const orbs= [
      {n:1,l:0,capacity:2,key:1},
      {n:2,l:0,capacity:2,key:2},
      {n:2,l:1,capacity:6,key:3},
      {n:3,l:0,capacity:2,key:4},
      {n:3,l:1,capacity:6,key:5},
      {n:4,l:0,capacity:2,key:6},
      {n:3,l:2,capacity:10,key:7},
      {n:4,l:1,capacity:6,key:8},
      {n:5,l:0,capacity:2,key:9},
      {n:4,l:2,capacity:10,key:10},
      {n:5,l:1,capacity:6,key:11},
      {n:6,l:0,capacity:2,key:12},
      {n:4,l:3,capacity:14,key:13},
      {n:5,l:2,capacity:10,key:14},
      {n:6,l:1,capacity:6,key:15},
      {n:7,l:0,capacity:2,key:16},
      {n:5,l:3,capacity:14,key:17},
      {n:6,l:2,capacity:10,key:18},
      {n:7,l:1,capacity:6,key:19}
    ];
    orbs.sort((a,b)=> a.key- b.key || a.n- b.n);
  
    let eLeft= Math.max(0, numElectrons);
    let confStr= "";
    let tmpSubs= [];
  
    for(const o of orbs){
      if(eLeft<=0) break;
      const used= Math.min(eLeft, o.capacity);
      cList.push({n:o.n, l:o.l, electronsInOrbital: used});
      confStr+= `${o.n}${getOrbTypeChar(o.l)}<sup>${used}</sup> `;
      const mVals= [];
      for(let mm= -o.l; mm<= o.l; mm++){
        mVals.push(mm);
      }
      let leftE= used;
      // Hund's rule style
      for(let mIndex=0; mIndex< mVals.length && leftE>0; mIndex++){
        tmpSubs.push({n:o.n, l:o.l, m:mVals[mIndex]});
        leftE--;
      }
      for(let mIndex=0; mIndex< mVals.length && leftE>0; mIndex++){
        tmpSubs.push({n:o.n, l:o.l, m:mVals[mIndex]});
        leftE--;
      }
      eLeft-= used;
    }
    // group
    const grouped= tmpSubs.reduce((acc, x)=>{
      const kk= `${x.n}-${x.l}-${x.m}`;
      if(!acc[kk]) acc[kk]= {...x, count:0};
      acc[kk].count++;
      return acc;
    },{});
    const finalSubs= Object.values(grouped);
    finalSubs.sort((a,b)=>{
      if(a.n!== b.n) return a.n- b.n;
      if(a.l!== b.l) return a.l- b.l;
      return a.m- b.m;
    });
    return {
      configList: cList,
      subShellList: finalSubs,
      configString: confStr.trim()
    };
  }
  
  function getOrbTypeChar(l){
    const t= ['s','p','d','f','g','h','i'];
    return t[l]|| ('l'+ l);
  }
  