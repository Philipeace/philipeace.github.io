// main.js

let currentOrbitalInfo= [];
let pointClouds= [];

let protonsInput, electronsInput, neutronsInput;
let pointsInput, pointSizeInput, opacityInput;
let minSizeFactorInput, maxSizeFactorInput;
let enableSCheckbox, enablePCheckbox, enableDCheckbox, enableFCheckbox;
let singleOrbitOnlyCheckbox, singleOrbitSelect;
let updateButton, drawButton;
let selectAllButton, deselectAllButton, refreshButton;
let showNucleusCheckbox;
let nucleusSizeSlider, nucleusSizeValueSpan;
let opacityFalloffSlider, opacityFalloffValueSpan;
let pointsWarningSpan;
let isoSelect;

let canvasContainer;
let threeJS;

async function init() {
  canvasContainer= document.getElementById('canvas-container');
  if(!canvasContainer) return;

  protonsInput= document.getElementById('protons');
  electronsInput= document.getElementById('electrons');
  neutronsInput= document.getElementById('neutrons');
  pointsInput= document.getElementById('points');
  pointsWarningSpan= document.getElementById('points-warning');
  pointSizeInput= document.getElementById('pointSize');
  opacityInput= document.getElementById('opacity');
  minSizeFactorInput= document.getElementById('minPointSizeFactor');
  maxSizeFactorInput= document.getElementById('maxPointSizeFactor');
  enableSCheckbox= document.getElementById('enable_s');
  enablePCheckbox= document.getElementById('enable_p');
  enableDCheckbox= document.getElementById('enable_d');
  enableFCheckbox= document.getElementById('enable_f');
  singleOrbitOnlyCheckbox= document.getElementById('single-orbit-only');
  singleOrbitSelect= document.getElementById('single-orbit-select');
  updateButton= document.getElementById('update-button');
  drawButton= document.getElementById('toggle-draw-button');
  selectAllButton= document.getElementById('select-all-orbitals');
  deselectAllButton= document.getElementById('deselect-all-orbitals');
  refreshButton= document.getElementById('refresh-points-button');
  showNucleusCheckbox= document.getElementById('show-nucleus');
  nucleusSizeSlider= document.getElementById('nucleus-size-slider');
  nucleusSizeValueSpan= document.getElementById('nucleus-size-value');
  opacityFalloffSlider= document.getElementById('light-distance-slider');
  opacityFalloffValueSpan= document.getElementById('light-distance-value');
  isoSelect= document.getElementById('isotope-select');

  threeJS= initThreeJS(canvasContainer);
  if(!threeJS) return;

  generatePeriodicTable(handleElementClick);
  setupDrawingCanvas(canvasContainer);
  setupDistanceScale();
  setupEventListeners();

  const rad= parseFloat(nucleusSizeSlider.value);
  if(nucleusSizeValueSpan) nucleusSizeValueSpan.textContent= rad.toFixed(2);
  const opFall= parseFloat(opacityFalloffSlider.value);
  if(opacityFalloffValueSpan) opacityFalloffValueSpan.textContent= opFall.toString();

  await updateVisualization();
  animate();
}

function setupEventListeners() {
  window.addEventListener('resize', onWindowResize, false);
  updateButton.addEventListener('click', updateVisualization);
  document.getElementById('proton-plus').addEventListener('click', ()=> changeProtons(1));
  document.getElementById('proton-minus').addEventListener('click', ()=> changeProtons(-1));

  protonsInput.addEventListener('change', handleAtomInputChange);
  electronsInput.addEventListener('change', handleAtomInputChange);
  neutronsInput.addEventListener('change', handleAtomInputChange);
  protonsInput.addEventListener('input', ()=>{
    const zVal= parseInt(protonsInput.value);
    if(!isNaN(zVal)){
      updateElementDisplay(Math.max(1, Math.min(zVal,118)));
    } else {
      updateElementDisplay(0);
    }
  });

  pointsInput.addEventListener('change', ()=>{ checkPointsInput(); handleVisSettingChange();});
  pointSizeInput.addEventListener('change', handleVisSettingChange);
  opacityInput.addEventListener('change', handleVisSettingChange);
  minSizeFactorInput.addEventListener('change', handleVisSettingChange);
  maxSizeFactorInput.addEventListener('change', handleVisSettingChange);

  enableSCheckbox.addEventListener('change', handleVisSettingChange);
  enablePCheckbox.addEventListener('change', handleVisSettingChange);
  enableDCheckbox.addEventListener('change', handleVisSettingChange);
  enableFCheckbox.addEventListener('change', handleVisSettingChange);

  singleOrbitOnlyCheckbox.addEventListener('change',(ev)=>{
    const ch= ev.target.checked;
    if(singleOrbitSelect) singleOrbitSelect.style.display= ch? 'inline-block':'none';
    handleVisSettingChange();
  });
  singleOrbitSelect.addEventListener('change', ()=>{
    if(singleOrbitOnlyCheckbox.checked){
      handleVisSettingChange();
    }
  });

  drawButton.addEventListener('click', ()=> toggleDrawing(drawButton, threeJS.controls));
  selectAllButton.addEventListener('click', ()=> setAllOrbitalsVisible(true, pointClouds, {}));
  deselectAllButton.addEventListener('click', ()=> setAllOrbitalsVisible(false, pointClouds, {}));
  refreshButton.addEventListener('click', refreshVisibleOrbitalPoints);

  showNucleusCheckbox.addEventListener('change',(ev)=>{
    if(threeJS.nucleusGroup){
      threeJS.nucleusGroup.visible= ev.target.checked;
      renderScene();
    }
  });
  nucleusSizeSlider.addEventListener('input',(ev)=>{
    const rad= parseFloat(ev.target.value);
    const Z= parseInt(protonsInput.value)||0;
    const N= parseInt(neutronsInput.value)||0;
    updateNucleusVisuals(Z,N, rad);
    if(nucleusSizeValueSpan) nucleusSizeValueSpan.textContent= rad.toFixed(2);
    renderScene();
  });
  opacityFalloffSlider.addEventListener('input',(ev)=>{
    const val= parseFloat(ev.target.value);
    if(opacityFalloffValueSpan) opacityFalloffValueSpan.textContent= val.toString();

    pointClouds.forEach(pc=>{
      if(pc.points && pc.points.material && pc.points.material.uniforms.uCameraDistanceFalloff){
        pc.points.material.uniforms.uCameraDistanceFalloff.value= val;
      }
    });
    renderScene();
  });

  threeJS.controls.addEventListener('change',()=>{
    if(!getIsDrawingEnabled() && !getIsLoading()){
      renderScene();
    }
    updateDistanceScale(threeJS.camera, threeJS.renderer, threeJS.controls, canvasContainer);
  });
  threeJS.controls.addEventListener('start',()=>{
    if(getIsDrawingEnabled()) clearDrawingCanvas();
  });

  // Isotope selection
  if(isoSelect){
    isoSelect.addEventListener('change',(ev)=>{
      const val= ev.target.value;
      if(!val) return;
      const z= parseInt(protonsInput.value)||1;
      const massN= parseInt(val);
      if(!isNaN(massN)){
        const n= massN - z;
        if(n>=0){
          neutronsInput.value= n;
          document.getElementById('config-wrapper').open= true;
          document.getElementById('manual-selection-section').open= true;
          updateVisualization();
        }
      }
    });
  }
}

function onWindowResize(){
  resizeThreeJS(canvasContainer);
  resizeDrawingCanvas(canvasContainer);
  updateDistanceScale(threeJS.camera, threeJS.renderer, threeJS.controls, canvasContainer);
  renderScene();
}

function changeProtons(delta){
  let z= parseInt(protonsInput.value)||0;
  z= Math.max(1, Math.min(z+ delta, 118));
  protonsInput.value= z;
  electronsInput.value= z;
  const ed= periodicTableData.find(e=> e.z===z);
  const cNeu= ed? Math.round(ed.atomic_mass)- z: Math.round(z*1.05);
  neutronsInput.value= Math.max(0,cNeu);

  updateElementDisplay(z);
  updateVisualization();
}

function handleAtomInputChange(){
  let z= parseInt(protonsInput.value)||1;
  z= Math.max(1, Math.min(z,118));
  protonsInput.value= z;

  let eC= parseInt(electronsInput.value);
  if(isNaN(eC)|| eC<0) eC= z;
  electronsInput.value= eC;

  let nC= parseInt(neutronsInput.value);
  if(isNaN(nC)|| nC<0){
    const ed= periodicTableData.find(a=> a.z=== z);
    const cNeu= ed? Math.round(ed.atomic_mass)- z: Math.round(z*1.05);
    nC= Math.max(0, cNeu);
  }
  neutronsInput.value= nC;

  updateElementDisplay(z);
  updateVisualization();
}

function handleVisSettingChange(){
  updateVisualization();
}

function handleElementClick(ev){
  const zStr= ev.currentTarget.dataset.z;
  if(zStr){
    const z= parseInt(zStr);
    protonsInput.value= z;
    electronsInput.value= z;
    const ed= periodicTableData.find(a=> a.z===z);
    const cNeu= ed? Math.round(ed.atomic_mass)- z: Math.round(z*1.05);
    neutronsInput.value= Math.max(0,cNeu);

    // open config
    document.getElementById('config-wrapper').open= true;
    document.getElementById('periodic-table-section').open= true;

    updateElementDisplay(z);
    updateVisualization();
  }
}

function checkPointsInput(){
  if(!pointsInput|| !pointsWarningSpan) return;
  const val= parseInt(pointsInput.value);
  const minVal= parseInt(pointsInput.min)||100;
  const warnT= 500000;
  const errT= 1000000;
  if(isNaN(val)|| val<minVal){
    pointsInput.value= minVal;
    pointsWarningSpan.textContent= `Min points: ${minVal}`;
    pointsWarningSpan.style.color= 'red';
  } else if(val> errT){
    pointsInput.value= errT;
    pointsWarningSpan.textContent= `Error: capped at ${errT}`;
    pointsWarningSpan.style.color='red';
  } else if(val> warnT){
    pointsWarningSpan.textContent= 'Warning: may slow performance.';
    pointsWarningSpan.style.color='orange';
  } else {
    pointsWarningSpan.textContent= '';
  }
}

// Attempt to keep acceptance in 5-50% range by adjusting attempts
// (Optional approach: We'll just do a big attempt multiplier so we get near user number.)
function acceptanceAwareAttemptCount(requestedPts){
  // We'll do 15x as a basic attempt factor => ~7% acceptance is typical
  // You could refine further if you prefer advanced logic
  return requestedPts * 15; 
}

function clearExistingPointClouds(){
  stopPlotAnimation(null);
  pointClouds.forEach(pc=>{
    if(pc.points){
      threeJS.scene.remove(pc.points);
      pc.points.geometry?.dispose();
      pc.points.material?.dispose();
    }
  });
  pointClouds= [];
  clearOrbitalList();
}

async function updateVisualization(){
  if(getIsLoading()) return;
  showLoading("Initializing...");
  await new Promise(r=> requestAnimationFrame(r));

  try{
    let Z= parseInt(protonsInput.value)||1;
    Z= Math.max(1, Math.min(Z,118));
    protonsInput.value= Z;

    let eC= parseInt(electronsInput.value);
    if(isNaN(eC)|| eC<0) eC= Z;
    electronsInput.value= eC;

    let nC= parseInt(neutronsInput.value);
    if(isNaN(nC)|| nC<0){
      const ed= periodicTableData.find(a=> a.z=== Z);
      const cNeu= ed? Math.round(ed.atomic_mass)- Z: Math.round(Z*1.05);
      nC= Math.max(0, cNeu);
    }
    neutronsInput.value= nC;

    let totPoints= parseInt(pointsInput.value);
    if(isNaN(totPoints)) totPoints= 20000;
    checkPointsInput();
    totPoints= parseInt(pointsInput.value);

    const bSize= parseFloat(pointSizeInput.value)||1.0;
    const bOp= parseFloat(opacityInput.value)||0.97;
    const minSF= parseFloat(minSizeFactorInput.value)||0.4;
    const maxSF= parseFloat(maxSizeFactorInput.value)||1.0;
    const sChk= enableSCheckbox.checked;
    const pChk= enablePCheckbox.checked;
    const dChk= enableDCheckbox.checked;
    const fChk= enableFCheckbox.checked;
    const singleOrb= singleOrbitOnlyCheckbox.checked;
    const selOrbitVal= singleOrbitSelect.value;
    const nucRad= parseFloat(nucleusSizeSlider.value)||0.05;
    const falloff= parseFloat(opacityFalloffSlider.value)||0;

    updateElementDisplay(Z);
    updateAtomDetailsDisplay(Z, eC, nC);
    updateNucleusVisuals(Z, nC, nucRad);

    clearExistingPointClouds();

    const { configList, subShellList, configString } = getElectronConfigurationList(eC);
    currentOrbitalInfo= configList;
    updateConfigDisplay(configString);
    populateSingleOrbitDropdown(subShellList);

    let orbs= subShellList.filter(o=>{
      const t= getOrbTypeChar(o.l);
      if(t==='s' && !sChk) return false;
      if(t==='p' && !pChk) return false;
      if(t==='d' && !dChk) return false;
      if(t==='f' && !fChk) return false;
      return true;
    });
    if(singleOrb && selOrbitVal && orbs.length>0){
      const [sn,sl,sm]= selOrbitVal.split(':').map(Number);
      const found= orbs.find(o=> o.n===sn && o.l===sl && o.m===sm);
      if(found) orbs= [found];
      else orbs= [];
    } else if(singleOrb && orbs.length>0){
      singleOrbitSelect.value= `${orbs[0].n}:${orbs[0].l}:${orbs[0].m}`;
      orbs= [orbs[0]];
    }

    if(eC===0 || orbs.length===0){
      console.log("No orbitals to visualize.");
      clearDrawingCanvas();
      updateDistanceScale(threeJS.camera, threeJS.renderer, threeJS.controls, canvasContainer);
      renderScene();
      hideLoading();
      return;
    }

    // Attempt to keep acceptance in a decent range by scaling attempts
    const attemptMult= acceptanceAwareAttemptCount(totPoints);

    const orbsCount= orbs.length;
    const pointsPerOrb= (orbsCount===1)? totPoints : Math.max(100, Math.floor(totPoints/orbsCount));

    for(let i=0; i< orbsCount; i++){
      const orb= orbs[i];
      const orbName= `${orb.n}${getOrbTypeChar(orb.l)}(m=${orb.m>=0?'+':''}${orb.m})`;
      showLoading(`Processing ${orbName}... (${i+1}/${orbsCount})`);
      await new Promise(r=> setTimeout(r,1));

      const Zeff= calculateSlaterZeff(orb.n, orb.l, configList, Z);
      // generate with code
      const {
        points, radii, rMin, rMax, probabilityValues,
        pMin, pMax
      } = generatePointsForOrbital(orb.n, orb.l, orb.m, Zeff, pointsPerOrb);

      let finalPoints= points, finalR= radii, finalProb= probabilityValues;
      let fMin= rMin, fMax= rMax, fPmin= pMin, fPmax= pMax;
      if(points.length===0){
        console.warn(`Fallback => zero points for ${orbName}, building small sphere...`);
        finalPoints= [];
        finalR= [];
        finalProb= [];
        const fallbackR= 2.0;
        for(let ff=0; ff< 50; ff++){
          // uniform sphere
          const u= Math.random();
          const costh= 2*Math.random()-1;
          const sinth= Math.sqrt(1-costh*costh);
          const phi= 2*Math.PI* Math.random();
          const rr= fallbackR* Math.cbrt(u);
          const xx= rr* sinth* Math.cos(phi);
          const yy= rr* sinth* Math.sin(phi);
          const zz= rr* costh;
          finalPoints.push(new THREE.Vector3(xx,yy,zz));
          finalR.push(rr);
          finalProb.push(0.1);
        }
        fMin=0; fMax= fallbackR;
        fPmin=0; fPmax=0.1;
      }

      let pCloud= null;
      if(finalPoints.length>0){
        const dColor= orbitalColors[orb.l] || new THREE.Color(0xcccccc);
        const geom= new THREE.BufferGeometry();
        const flatPos= new Float32Array(finalPoints.length*3);
        for(let j=0; j< finalPoints.length; j++){
          flatPos[j*3]= finalPoints[j].x;
          flatPos[j*3+1]= finalPoints[j].y;
          flatPos[j*3+2]= finalPoints[j].z;
        }
        geom.setAttribute('position', new THREE.BufferAttribute(flatPos,3));
        geom.setAttribute('pointRadius', new THREE.BufferAttribute(new Float32Array(finalR),1));
        geom.setAttribute('probabilityValue', new THREE.BufferAttribute(new Float32Array(finalProb),1));
        geom.computeBoundingSphere();

        const uniforms= {
          baseSize: {value: bSize},
          rMin: {value: fMin}, rMax: {value: fMax},
          uMinSizeFactor: {value: minSF},
          uMaxSizeFactor: {value: maxSF},
          color: {value: dColor.clone()},
          baseOpacity: {value: bOp},
          uMinProb: {value: fPmin}, uMaxProb: {value: fPmax},
          uCameraDistanceFalloff: {value: falloff}
        };
        const mat= new THREE.ShaderMaterial({
          uniforms,
          vertexShader: vertexShader_PointScaling,
          fragmentShader: fragmentShader_PointOpacity,
          transparent:true,
          depthWrite:false,
          blending: THREE.AdditiveBlending
        });
        pCloud= new THREE.Points(geom, mat);
        pCloud.visible= true;
        threeJS.scene.add(pCloud);
      }

      const orbId= `orb-${orb.n}-${orb.l}-${orb.m}-${i}`;
      const orbUI= { n:orb.n, l:orb.l, m:orb.m, Zeff, id:orbId, electronCount: orb.count };
      const uiElem= addOrbitalToList(orbUI, pCloud, i, orbsCount, {
        onCheckboxChange: handleOrbitalCheckboxChange,
        onColorChange: handleOrbitalColorChange
      });
      pointClouds.push({ points:pCloud, orbInfo:orbUI, uiElement: uiElem });
    }

    clearDrawingCanvas();
    updateDistanceScale(threeJS.camera, threeJS.renderer, threeJS.controls, canvasContainer);
    renderScene();

    // always at least 1 electron
    refreshLoaderElectrons(orbsCount);

  } catch(err){
    console.error("Error in updateVisualization:", err);
    showLoading("Error. Check console.");
    await new Promise(r=> setTimeout(r,2000));
  } finally {
    hideLoading();
  }
}

function refreshLoaderElectrons(orbCount){
  const loader= document.querySelector('#loading-overlay .atom-loader');
  if(!loader) return;
  loader.querySelectorAll('.electron').forEach(e=> e.remove());

  const base= 1; // ensures at least 1
  const total= base+ orbCount;
  for(let i=0; i< total; i++){
    const eDiv= document.createElement('div');
    eDiv.classList.add('electron');
    if(i===1) eDiv.style.animationName= 'orbit-reverse';
    else if(i===2) eDiv.style.animationName= 'orbit-angled';
    loader.appendChild(eDiv);
  }
}

async function refreshVisibleOrbitalPoints(){
  if(getIsLoading()) return;
  showLoading("Refreshing visible orbitals...");
  await new Promise(r=> requestAnimationFrame(r));

  const Z= parseInt(protonsInput.value)||1;
  let tot= parseInt(pointsInput.value);
  if(isNaN(tot)) tot=20000;
  checkPointsInput();
  tot= parseInt(pointsInput.value);

  const bSize= parseFloat(pointSizeInput.value)||1.0;
  const bOp= parseFloat(opacityInput.value)||0.97;
  const minSF= parseFloat(minSizeFactorInput.value)||0.4;
  const maxSF= parseFloat(maxSizeFactorInput.value)||1.0;
  const falloff= parseFloat(opacityFalloffSlider.value)||0;

  const visible= pointClouds.filter(pc=>{
    const ck= pc.uiElement?.querySelector('input[type="checkbox"]');
    return ck && ck.checked && !ck.disabled && pc.orbInfo;
  });
  if(visible.length===0){
    console.log("No orbitals visible to refresh.");
    hideLoading();
    return;
  }

  showLoading(`Refreshing ${visible.length} orbital(s)...`);
  await new Promise(r=> setTimeout(r,1));

  const ptsEach= Math.max(100, Math.floor(tot/ visible.length));
  for(let i=0; i< visible.length; i++){
    const pcData= visible[i];
    const orbI= pcData.orbInfo;
    const uiEl= pcData.uiElement;
    const cHex= uiEl?.colorPickerRef?.value || '#cccccc';

    if(pcData.points){
      threeJS.scene.remove(pcData.points);
      pcData.points.geometry?.dispose();
      pcData.points.material?.dispose();
      pcData.points= null;
    }

    const {points, radii, rMin, rMax, probabilityValues, pMin, pMax} =
      generatePointsForOrbital(orbI.n, orbI.l, orbI.m, orbI.Zeff, ptsEach);

    let finalPoints= points, finalR= radii, finalProb= probabilityValues;
    let fMin= rMin, fMax= rMax, fPmin= pMin, fPmax= pMax;
    if(points.length===0){
      console.warn(`Refresh fallback => zero points for ${orbI.n}${getOrbTypeChar(orbI.l)}(m=${orbI.m})`);
      finalPoints= [];
      finalR= [];
      finalProb= [];
      const fallbackRadius=2.0;
      for(let ff=0; ff<50; ff++){
        // random sphere
        const u= Math.random();
        const costh= 2*Math.random()-1;
        const sinth= Math.sqrt(1-costh*costh);
        const phi= 2*Math.PI* Math.random();
        const rr= fallbackRadius* Math.cbrt(u);
        const xx= rr* sinth* Math.cos(phi);
        const yy= rr* sinth* Math.sin(phi);
        const zz= rr* costh;
        finalPoints.push(new THREE.Vector3(xx,yy,zz));
        finalR.push(rr);
        finalProb.push(0.1);
      }
      fMin=0; fMax= fallbackRadius;
      fPmin=0; fPmax=0.1;
    }

    let newCloud= null;
    if(finalPoints.length>0){
      const geom= new THREE.BufferGeometry();
      const flat= new Float32Array(finalPoints.length*3);
      for(let j=0; j< finalPoints.length; j++){
        flat[j*3]= finalPoints[j].x;
        flat[j*3+1]= finalPoints[j].y;
        flat[j*3+2]= finalPoints[j].z;
      }
      geom.setAttribute('position', new THREE.BufferAttribute(flat,3));
      geom.setAttribute('pointRadius', new THREE.BufferAttribute(new Float32Array(finalR),1));
      geom.setAttribute('probabilityValue', new THREE.BufferAttribute(new Float32Array(finalProb),1));
      geom.computeBoundingSphere();

      const uniforms= {
        baseSize: {value: bSize},
        rMin: {value: fMin}, rMax: {value: fMax},
        uMinSizeFactor: {value: minSF},
        uMaxSizeFactor: {value: maxSF},
        color: {value: new THREE.Color(cHex)},
        baseOpacity: {value: bOp},
        uMinProb: {value: fPmin}, uMaxProb: {value: fPmax},
        uCameraDistanceFalloff: {value: falloff}
      };
      const mat= new THREE.ShaderMaterial({
        uniforms,
        vertexShader: vertexShader_PointScaling,
        fragmentShader: fragmentShader_PointOpacity,
        transparent:true,
        depthWrite:false,
        blending: THREE.AdditiveBlending
      });
      newCloud= new THREE.Points(geom, mat);
      newCloud.visible= true;
      threeJS.scene.add(newCloud);
    }
    pcData.points= newCloud;
    updateOrbitalListItemAfterRefresh(uiEl, newCloud, cHex);
  }
  updateDistanceScale(threeJS.camera, threeJS.renderer, threeJS.controls, canvasContainer);
  renderScene();
  hideLoading();
}

function handleOrbitalCheckboxChange(orbInfo, pointCloud, isChecked) {
  if(pointCloud){
    pointCloud.visible= isChecked;
    renderScene();
  }
}
function handleOrbitalColorChange(orbInfo, pointCloud, newColor) {
  if(pointCloud?.material?.uniforms?.color){
    pointCloud.material.uniforms.color.value.set(newColor);
    renderScene();
  }
}

function animate(){
  requestAnimationFrame(animate);
  const needsUpdate= threeJS.controls.update();
  if(needsUpdate && !getIsDrawingEnabled() && !getIsLoading()){
    renderScene();
  }
}

document.addEventListener('DOMContentLoaded', init);
