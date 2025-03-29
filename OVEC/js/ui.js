// ui.js
// Manages UI interactions, big-canvas popup, isotope dropdown, and small radial plots.

let drawingCanvas, drawCtx;
let isDrawing = false;
let drawingEnabled = false;
let lastX, lastY;

let scaleBarElement, scaleLabelElement;
const distanceScaleTargetPixelWidth = 100;

let activePlots = [];
let plotAnimationId = null;
let isLoading = false;

// Colors for orbitals
const orbitalColors = {
  0: new THREE.Color(0x0000ff),
  1: new THREE.Color(0xB8860B),
  2: new THREE.Color(0xff0000),
  3: new THREE.Color(0x00ff00)
};

// Loading overlay
function showLoading(message = "Loading...") {
  const overlay = document.getElementById('loading-overlay');
  const label = document.getElementById('loading-message');
  if (!overlay || !label) return;
  label.textContent = message;
  if (!isLoading) {
    isLoading = true;
    overlay.classList.add('visible');
  }
}

function hideLoading() {
  const overlay = document.getElementById('loading-overlay');
  if (!overlay) return;
  if (isLoading) {
    isLoading = false;
    overlay.classList.remove('visible');
  }
}

function getIsLoading() {
  return isLoading;
}

// Update UI
function updateElementDisplay(Z) {
  const displaySpan = document.getElementById('element-display');
  const elementData = periodicTableData.find(e => e.z === Z);
  if (elementData) {
    displaySpan.textContent = `(${elementData.symbol}) ${elementData.name}`;
  } else if (Z > 0) {
    displaySpan.textContent = `(Element ${Z})`;
  } else {
    displaySpan.textContent = `(Invalid)`;
  }

  // highlight in table
  const table = document.getElementById('periodic-table');
  if (table) {
    const currentSel = table.querySelector('.element.selected');
    if (currentSel) currentSel.classList.remove('selected');
    const newSel = table.querySelector(`.element[data-z="${Z}"]`);
    if (newSel) newSel.classList.add('selected');
  }

  // Open the config wrapper & manual section so user sees changes
  const configWrapper = document.getElementById('config-wrapper');
  if (configWrapper) configWrapper.open = true;
  const manualSection = document.getElementById('manual-selection-section');
  if (manualSection) manualSection.open = true;

  // Update isotope dropdown
  populateIsotopeDropdown(Z);
}

function populateIsotopeDropdown(Z) {
  const isoSelect = document.getElementById('isotope-select');
  if (!isoSelect) return;
  isoSelect.innerHTML = '';

  const isoList = isotopeData[String(Z)];
  if (!isoList) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No data for this element';
    isoSelect.appendChild(opt);
    isoSelect.disabled = true;
    return;
  }
  isoSelect.disabled = false;

  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Select an isotope...';
  isoSelect.appendChild(defaultOpt);

  isoList.forEach(iso => {
    const opt = document.createElement('option');
    opt.value = String(iso.massNumber);
    opt.textContent = iso.label;
    isoSelect.appendChild(opt);
  });
}

function updateAtomDetailsDisplay(Z, eCount, nCount) {
  const container = document.getElementById('atom-details');
  if (container) {
    container.innerHTML = `Z=${Z}, e⁻=${eCount}, n=${nCount}`;
  }
}

function updateConfigDisplay(cfgStr) {
  const cDiv = document.getElementById('config-display');
  if (cDiv) cDiv.innerHTML = cfgStr || "N/A";
}

function populateSingleOrbitDropdown(subShellList) {
  const singleOrbitSel = document.getElementById('single-orbit-select');
  if (!singleOrbitSel) return;

  const oldVal = singleOrbitSel.value;
  singleOrbitSel.innerHTML = '';

  if (!subShellList || subShellList.length === 0) {
    const opt = document.createElement('option');
    opt.disabled = true;
    opt.textContent = "No orbitals available";
    singleOrbitSel.appendChild(opt);
  } else {
    subShellList.forEach(orb => {
      const typeChar = getOrbTypeChar(orb.l);
      let mStr = `${orb.m}`;
      if (orb.m > 0) mStr = `+${orb.m}`;
      const label = `${orb.n}${typeChar} (m=${mStr}), e⁻=${orb.count}`;
      const opt = document.createElement('option');
      opt.value = `${orb.n}:${orb.l}:${orb.m}`;
      opt.textContent = label;
      singleOrbitSel.appendChild(opt);
    });
    if (oldVal) {
      const exists = subShellList.some(o => `${o.n}:${o.l}:${o.m}` === oldVal);
      if (exists) singleOrbitSel.value = oldVal;
    }
  }

  const singleChk = document.getElementById('single-orbit-only');
  const isChk = singleChk?.checked;
  singleOrbitSel.style.display = isChk ? 'inline-block' : 'none';
  singleOrbitSel.disabled = (subShellList.length === 0);
}

// Orbital List
function clearOrbitalList() {
  const div = document.getElementById('orbital-details');
  if (!div) return;
  const canvases = div.querySelectorAll('.inline-plot-canvas');
  canvases.forEach(c => stopPlotAnimation(c));
  div.innerHTML = '';
}

function addOrbitalToList(orbInfo, pointCloud, idx, totalCount, callbacks) {
  const listDiv = document.getElementById('orbital-details');
  if (!listDiv) return null;

  const { n, l, m, Zeff, id, electronCount } = orbInfo;
  const defaultColor = orbitalColors[l] || new THREE.Color(0xcccccc);
  const colorHex = '#' + defaultColor.getHexString();

  const container = document.createElement('div');
  container.classList.add('orbital-list-item');
  container.id = id + '-item';
  container.pointCloudRef = pointCloud;
  container.orbInfo = orbInfo;

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = !!pointCloud;
  cb.id = id + '-cb';
  cb.classList.add('orbital-checkbox');
  cb.disabled = !pointCloud; // no points => disabled

  const labelContainer = document.createElement('div');
  labelContainer.classList.add('label-container');

  const label = document.createElement('label');
  label.htmlFor = cb.id;
  let mStr = `${m}`; 
  if (m > 0) mStr = `+${m}`;
  const orbName = `${n}${getOrbTypeChar(l)}` + (l>0 ? ` <sub>(m=${mStr})</sub>` : '');
  label.innerHTML = `<span class="color-box" style="background-color:${colorHex};"></span> ${orbName}`;

  const sText = document.createElement('small');
  sText.innerHTML = `(Z<sub>eff</sub>≈${Zeff.toFixed(2)}, e⁻=${electronCount})`;

  labelContainer.appendChild(label);
  labelContainer.appendChild(sText);

  const plotCanvas = document.createElement('canvas');
  plotCanvas.width = 80;
  plotCanvas.height = 40;
  plotCanvas.classList.add('inline-plot-canvas');
  plotCanvas.title = `Radial Wavefunction for ${orbName.replace(/<[^>]*>/g, '')}`;

  const colorPicker = document.createElement('input');
  colorPicker.type = 'color';
  colorPicker.classList.add('orbital-color-picker');
  colorPicker.value = colorHex;
  colorPicker.title = `Change color for ${orbName.replace(/<[^>]*>/g, '')}`;
  colorPicker.disabled = !pointCloud;
  container.colorPickerRef = colorPicker;

  // color change -> callback
  colorPicker.addEventListener('input', (ev) => {
    const newC = ev.target.value;
    const cBox = label.querySelector('.color-box');
    if (cBox) cBox.style.backgroundColor = newC;
    if (plotCanvas.plotParams) {
      plotCanvas.plotParams.color = newC;
    }
    if (callbacks.onColorChange) {
      callbacks.onColorChange(orbInfo, pointCloud, newC);
    }
  });

  // hide/unhide in scene
  cb.addEventListener('change', (ev) => {
    const isCkd = ev.target.checked;
    container.classList.toggle('inactive', !isCkd);
    if (plotCanvas) {
      if (isCkd) startPlotAnimation(plotCanvas);
      else stopPlotAnimation(plotCanvas);
    }
    if (callbacks.onCheckboxChange) {
      callbacks.onCheckboxChange(orbInfo, pointCloud, isCkd);
    }
  });

  // label container toggles the checkbox
  labelContainer.addEventListener('click', () => {
    if (!cb.disabled) {
      cb.click();
    }
  });

  container.appendChild(cb);
  container.appendChild(labelContainer);
  container.appendChild(colorPicker);
  container.appendChild(plotCanvas);

  listDiv.appendChild(container);

  // small inline wavefunction plot
  const ctx = plotCanvas.getContext('2d');
  if (ctx) {
    let nodes = [];
    let bnds = { rMax: 10, maxY: 0.1 };
    if (typeof findRadialNodes === 'function' && typeof calculatePlotBounds === 'function') {
      nodes = findRadialNodes(n, l, Zeff);
      bnds = calculatePlotBounds(n, l, Zeff);
    }
    plotCanvas.plotParams = {
      ctx,
      n, l, Zeff,
      width: plotCanvas.width,
      height: plotCanvas.height,
      color: colorHex,
      nodes,
      rMax: bnds.rMax,
      maxY: bnds.maxY
    };

    if (cb.checked) {
      startPlotAnimation(plotCanvas);
    } else {
      drawAnimatedRadialPlot(plotCanvas.plotParams, 0);
    }
  } else {
    console.warn("Missing 2D context for inline plot canvas:", id);
  }

  if (!pointCloud) {
    cb.checked = false;
    container.classList.add('inactive');
    sText.innerHTML += " <span style='color:red;'>(No points)</span>";
    stopPlotAnimation(plotCanvas);
  }

  return container;
}

function setAllOrbitalsVisible(visible, pointCloudData, callbacks) {
  pointCloudData.forEach(pc => {
    const item = pc.uiElement;
    if (!item) return;
    const ckb = item.querySelector('input[type="checkbox"]');
    const pCloud = pc.points;
    const plotCanvas = item.querySelector('.inline-plot-canvas');
    if (ckb && !ckb.disabled) {
      if (ckb.checked !== visible) {
        ckb.checked = visible;
        item.classList.toggle('inactive', !visible);
        if (plotCanvas) {
          if (visible) startPlotAnimation(plotCanvas);
          else stopPlotAnimation(plotCanvas);
        }
        if (pCloud) {
          pCloud.visible = visible;
        }
      }
    }
  });
  renderScene();
}

function updateOrbitalListItemAfterRefresh(uiElem, newCloud, newColorHex) {
  if (!uiElem || !uiElem.orbInfo) return;
  const cb = uiElem.querySelector('input[type="checkbox"]');
  const labelC = uiElem.querySelector('.label-container');
  const sTxt = labelC?.querySelector('small');
  const cPick = uiElem.colorPickerRef;
  const cBox = labelC?.querySelector('.color-box');
  const plotCanvas = uiElem.querySelector('.inline-plot-canvas');

  uiElem.pointCloudRef = newCloud;
  if (newCloud) {
    if (cb) cb.disabled = false;
    if (cPick) {
      cPick.disabled = false;
      cPick.value = newColorHex;
    }
    if (cBox) cBox.style.backgroundColor = newColorHex;
    uiElem.classList.remove('inactive');
    if (cb) cb.checked = true;

    const noPointsSpan = sTxt?.querySelector("span[style*='color:red']");
    if (noPointsSpan) noPointsSpan.remove();

    if (plotCanvas) {
      stopPlotAnimation(plotCanvas);
      const plotCtx = plotCanvas.getContext('2d');
      const orbI = uiElem.orbInfo;
      if (plotCtx && orbI && typeof findRadialNodes === 'function' && typeof calculatePlotBounds === 'function') {
        const nodes = findRadialNodes(orbI.n, orbI.l, orbI.Zeff);
        const { rMax, maxY } = calculatePlotBounds(orbI.n, orbI.l, orbI.Zeff);
        plotCanvas.plotParams = {
          ctx: plotCtx,
          n: orbI.n, l: orbI.l, Zeff: orbI.Zeff,
          width: plotCanvas.width, height: plotCanvas.height,
          color: newColorHex,
          nodes,
          rMax,
          maxY
        };
        startPlotAnimation(plotCanvas);
      }
    }
  } else {
    if (cb) { cb.disabled = true; cb.checked = false; }
    if (cPick) cPick.disabled = true;
    uiElem.classList.add('inactive');
    if (sTxt && !sTxt.querySelector("span[style*='color:red']")) {
      sTxt.innerHTML += " <span style='color:red;'>(No points)</span>";
    }
    if (plotCanvas) {
      stopPlotAnimation(plotCanvas);
      const c2d = plotCanvas.getContext('2d');
      if (c2d) c2d.clearRect(0, 0, plotCanvas.width, plotCanvas.height);
      delete plotCanvas.plotParams;
    }
  }
}

// Table
function generatePeriodicTable(clickHandler) {
  const tbl = document.getElementById('periodic-table');
  if (!tbl) return;
  tbl.innerHTML = '';
  periodicTableData.forEach(el => {
    const div = document.createElement('div');
    div.classList.add('element');
    if (el.type) div.classList.add(el.type);
    div.dataset.z = el.z;
    div.style.gridRowStart = el.row;
    div.style.gridColumnStart = el.col;
    div.innerHTML = `<span>${el.z}</span><span>${el.symbol}</span>`;
    div.title = el.name;
    div.addEventListener('click', clickHandler);
    tbl.appendChild(div);
  });
  console.log("Periodic Table generated.");
}

// Drawing
function setupDrawingCanvas(container) {
  if (!container) return null;
  drawingCanvas = document.getElementById('drawing-canvas');
  if (!drawingCanvas) return null;

  drawingCanvas.width = container.clientWidth;
  drawingCanvas.height = container.clientHeight;
  drawCtx = drawingCanvas.getContext('2d');

  drawingCanvas.addEventListener('mousedown', startDrawing);
  drawingCanvas.addEventListener('mousemove', draw);
  drawingCanvas.addEventListener('mouseup', stopDrawing);
  drawingCanvas.addEventListener('mouseleave', stopDrawing);

  return drawingCanvas;
}
function resizeDrawingCanvas(container) {
  if (!drawingCanvas || !drawCtx) return;
  drawingCanvas.width = container.clientWidth;
  drawingCanvas.height = container.clientHeight;
}
function clearDrawingCanvas() {
  if (!drawingCanvas || !drawCtx) return;
  drawCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
}
function startDrawing(e) {
  if (!drawingEnabled) return;
  isDrawing = true;
  [lastX, lastY] = [e.offsetX, e.offsetY];
}
function draw(e) {
  if (!isDrawing || !drawingEnabled) return;
  drawCtx.strokeStyle = '#ff0000';
  drawCtx.lineWidth = 2;
  drawCtx.beginPath();
  drawCtx.moveTo(lastX, lastY);
  drawCtx.lineTo(e.offsetX, e.offsetY);
  drawCtx.stroke();
  [lastX, lastY] = [e.offsetX, e.offsetY];
}
function stopDrawing() {
  isDrawing = false;
}
function toggleDrawing(button, orbitControls) {
  drawingEnabled = !drawingEnabled;
  if (drawingEnabled) {
    button.textContent = "Disable Drawing";
    orbitControls.enabled = false;
  } else {
    button.textContent = "Enable Drawing";
    orbitControls.enabled = true;
    clearDrawingCanvas();
  }
  return drawingEnabled;
}
function getIsDrawingEnabled() {
  return drawingEnabled;
}

// Distance scale
function setupDistanceScale() {
  scaleBarElement = document.getElementById('scale-bar');
  scaleLabelElement = document.getElementById('scale-label');
}
function updateDistanceScale(camera, renderer, controls, container) {
  if (!camera || !container) return;
  if (!scaleBarElement) scaleBarElement = document.getElementById('scale-bar');
  if (!scaleLabelElement) scaleLabelElement = document.getElementById('scale-label');
  if (!scaleBarElement || !scaleLabelElement) return;

  const w = container.clientWidth;
  const h = container.clientHeight;
  if (w === 0 || h === 0) return;

  const p1 = new THREE.Vector3(0, 0, 0);
  const p2 = new THREE.Vector3(1, 0, 0);
  const p1Ndc = p1.clone().project(camera);
  const p2Ndc = p2.clone().project(camera);

  const p1S = {
    x: (p1Ndc.x * 0.5 + 0.5) * w,
    y: (p1Ndc.y * -0.5 + 0.5) * h
  };
  const p2S = {
    x: (p2Ndc.x * 0.5 + 0.5) * w,
    y: (p2Ndc.y * -0.5 + 0.5) * h
  };
  const distPx = Math.sqrt((p2S.x - p1S.x) ** 2 + (p2S.y - p1S.y) ** 2);
  if (distPx < 0.0001) {
    scaleBarElement.style.width = `${distanceScaleTargetPixelWidth}px`;
    scaleLabelElement.textContent = `? a.u. (? pm)`;
    return;
  }
  const realSceneDistFor100px = 100 / distPx;
  const pmPerAu = 52.9177;
  scaleBarElement.style.width = `${distanceScaleTargetPixelWidth}px`;
  const auLabel = realSceneDistFor100px.toFixed(2);
  const pmLabel = (realSceneDistFor100px * pmPerAu).toFixed(2);
  scaleLabelElement.textContent = `${auLabel} a.u. (${pmLabel} pm)`;
}

// radial plots
function calculatePlotBounds(n, l, Zeff) {
  let rMax = (n * n / Zeff) * 4 + 10;
  rMax = Math.max(rMax, 5.0);
  if (Zeff < 0.8) rMax *= 1.5;

  const Rnl = radialWaveFunction(n, l, Zeff);
  let maxY = 0;
  const steps = 200;
  const dr = rMax / steps;
  for (let i=1; i<=steps; i++) {
    const r = i*dr;
    const rR = r * Rnl(r);
    if (isFinite(rR)) {
      maxY = Math.max(maxY, Math.abs(rR));
    }
  }
  if (maxY < 1e-6 || !isFinite(maxY)) {
    maxY = 0.1;
    if (maxY < 1e-6) rMax = Math.max(rMax, 30);
  }
  return { rMax: rMax*1.05, maxY: maxY*1.2 };
}

function drawAnimatedRadialPlot(params, time) {
  if (!params || !params.ctx) return;
  const { ctx, n, l, Zeff, width, height, color, nodes, rMax, maxY } = params;

  ctx.clearRect(0, 0, width, height);

  const Rnl = radialWaveFunction(n, l, Zeff);
  if (!Rnl || maxY <= 1e-9) {
    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 0.5;
    ctx.beginPath();
    ctx.moveTo(2, height/2);
    ctx.lineTo(width-2, height/2);
    ctx.stroke();
    return;
  }

  const pad = { top:3, bottom:3, left:2, right:2 };
  const pW = width - pad.left - pad.right;
  const pH = height - pad.top - pad.bottom;
  const originY = pad.top + pH/2;

  ctx.strokeStyle = '#ccc';
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(pad.left, originY);
  ctx.lineTo(width - pad.right, originY);
  ctx.stroke();

  if (nodes && nodes.length>0) {
    ctx.fillStyle = '#ff6666';
    nodes.forEach(nr => {
      const xCoord = pad.left + (nr / rMax)* pW;
      if (xCoord >= pad.left && xCoord <= width - pad.right) {
        ctx.beginPath();
        ctx.arc(xCoord, originY, 1.5, 0, 2*Math.PI);
        ctx.fill();
      }
    });
  }

  const waveSpeed = 0.002;
  const phaseShift = time* waveSpeed;
  const lobes = n - l;
  const phaseScale = (lobes * Math.PI)/ rMax;

  ctx.strokeStyle = color || '#0000ff';
  ctx.lineWidth = 1.0;
  ctx.beginPath();
  let first = true;

  const envPos = [];
  const envNeg = [];

  for (let i=0; i<= pW; i++) {
    const r = (i/pW)* rMax;
    const rRabs = Math.abs(r* Rnl(r));
    if (!isFinite(rRabs)) continue;

    const amplitudePx = (rRabs/maxY)*(pH/2)*0.9;
    const sVal = Math.sin(r* phaseScale + phaseShift);
    const cY = sVal * amplitudePx;
    const yPx = originY - cY;
    const yClamp = Math.max(pad.top, Math.min(height- pad.bottom, yPx));

    if (first) {
      ctx.moveTo(pad.left + i, yClamp);
      first=false;
    } else {
      ctx.lineTo(pad.left + i, yClamp);
    }

    envPos.push({ 
      x: pad.left + i, 
      y: Math.max(pad.top, Math.min(height- pad.bottom, originY- amplitudePx)) 
    });
    envNeg.push({
      x: pad.left + i,
      y: Math.max(pad.top, Math.min(height- pad.bottom, originY+ amplitudePx))
    });
  }
  ctx.stroke();

  ctx.strokeStyle = '#aaaaaa';
  ctx.lineWidth=0.5;
  ctx.setLineDash([2,2]);
  if (envPos.length>1) {
    ctx.beginPath();
    ctx.moveTo(envPos[0].x, envPos[0].y);
    for(let i=1; i< envPos.length; i++){
      ctx.lineTo(envPos[i].x, envPos[i].y);
    }
    ctx.stroke();
  }
  if (envNeg.length>1) {
    ctx.beginPath();
    ctx.moveTo(envNeg[0].x, envNeg[0].y);
    for(let i=1; i< envNeg.length; i++){
      ctx.lineTo(envNeg[i].x, envNeg[i].y);
    }
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function animateInlinePlots() {
  if (activePlots.length === 0) {
    plotAnimationId = null;
    return;
  }
  const t = performance.now();
  activePlots.forEach(obj => {
    if (obj.canvas && obj.canvas.plotParams) {
      drawAnimatedRadialPlot(obj.canvas.plotParams, t);
    }
  });
  plotAnimationId = requestAnimationFrame(animateInlinePlots);
}
function startPlotAnimation(canvas) {
  if (!canvas || !canvas.plotParams) return;
  const idx = activePlots.findIndex(p => p.canvas === canvas);
  if (idx===-1) {
    activePlots.push({ canvas, startTime: performance.now() });
    if (plotAnimationId=== null) {
      plotAnimationId= requestAnimationFrame(animateInlinePlots);
    }
  } else {
    activePlots[idx].startTime= performance.now();
  }
}
function stopPlotAnimation(canvas) {
  if (canvas=== null) {
    if (plotAnimationId!==null) {
      cancelAnimationFrame(plotAnimationId);
      plotAnimationId= null;
    }
    activePlots= [];
  } else {
    const idx= activePlots.findIndex(p => p.canvas=== canvas);
    if (idx!== -1) {
      activePlots.splice(idx,1);
      if (canvas.plotParams) {
        drawAnimatedRadialPlot(canvas.plotParams, 0);
      }
      if (activePlots.length===0 && plotAnimationId!== null) {
        cancelAnimationFrame(plotAnimationId);
        plotAnimationId= null;
      }
    }
  }
}

// Big popup logic with quadruple DPI
const popupButton = document.getElementById('orbital-popup-button');
const popupOverlay = document.getElementById('orbital-popup-overlay');
const popupClose = document.getElementById('orbital-popup-close');
const popupContent = document.getElementById('orbital-popup-content');
const popupWidthSlider = document.getElementById('popupWidthSlider');
const popupHeightSlider = document.getElementById('popupHeightSlider');
const popupWidthValue = document.getElementById('popupWidthValue');
const popupHeightValue = document.getElementById('popupHeightValue');

function getPopupCanvasWidth() {
  return parseInt(popupWidthSlider.value)|| 600;
}
function getPopupCanvasHeight() {
  return parseInt(popupHeightSlider.value)|| 300;
}

function populatePopupOrbitals() {
  popupContent.innerHTML= '';

  const orbDiv = document.getElementById('orbital-details');
  if (!orbDiv) return;

  const items = orbDiv.querySelectorAll('.orbital-list-item');
  items.forEach(it=>{
    const ckb = it.querySelector('input[type="checkbox"]');
    if(!ckb||!ckb.checked) return;
    const info= it.orbInfo;
    if(!info) return;

    const popItem= document.createElement('div');
    popItem.classList.add('popup-orbital-item');

    const label= document.createElement('span');
    label.classList.add('popup-orbital-label');
    let mS= `${info.m}`;
    if(info.m>0) mS= `+${info.m}`;
    label.textContent= `Orbital: ${info.n}${getOrbTypeChar(info.l)}(m=${mS}), Zeff~${info.Zeff.toFixed(2)}`;
    popItem.appendChild(label);

    const wVal= getPopupCanvasWidth();
    const hVal= getPopupCanvasHeight();
    const dpRatio= (window.devicePixelRatio||1)*4; // quadruple

    const bigCanvas= document.createElement('canvas');
    bigCanvas.style.width= wVal+"px";
    bigCanvas.style.height= hVal+"px";
    bigCanvas.width= Math.floor(wVal* dpRatio);
    bigCanvas.height= Math.floor(hVal* dpRatio);
    bigCanvas.classList.add('popup-orbital-canvas');
    popItem.appendChild(bigCanvas);
    popupContent.appendChild(popItem);

    const ctx= bigCanvas.getContext('2d');
    ctx.scale(dpRatio, dpRatio);

    let nodes= [];
    let bds= {rMax:10, maxY: 0.1};
    if(typeof findRadialNodes==='function' && typeof calculatePlotBounds==='function'){
      nodes= findRadialNodes(info.n, info.l, info.Zeff);
      bds= calculatePlotBounds(info.n, info.l, info.Zeff);
    }
    const cPick= it.querySelector('input[type="color"]');
    const cHex= cPick? cPick.value : '#0000ff';

    bigCanvas.plotParams= {
      ctx,
      n: info.n,
      l: info.l,
      Zeff: info.Zeff,
      width: wVal,
      height: hVal,
      color: cHex,
      nodes,
      rMax: bds.rMax,
      maxY: bds.maxY
    };
    startPlotAnimation(bigCanvas);
  });
}

if(popupButton && popupOverlay && popupClose && popupContent && popupWidthSlider && popupHeightSlider) {
  popupButton.addEventListener('click', ()=>{
    populatePopupOrbitals();
    popupOverlay.classList.remove('hidden');
  });
  popupClose.addEventListener('click', ()=>{
    popupOverlay.classList.add('hidden');
    const cvs= popupContent.querySelectorAll('canvas');
    cvs.forEach(c=> stopPlotAnimation(c));
    popupContent.innerHTML= '';
  });
  function handlePopupSizeChange(){
    popupWidthValue.textContent= popupWidthSlider.value;
    popupHeightValue.textContent= popupHeightSlider.value;
    if(!popupOverlay.classList.contains('hidden')){
      const cList= popupContent.querySelectorAll('canvas');
      cList.forEach(c=> stopPlotAnimation(c));
      popupContent.innerHTML= '';
      populatePopupOrbitals();
    }
  }
  popupWidthSlider.addEventListener('input', handlePopupSizeChange);
  popupHeightSlider.addEventListener('input', handlePopupSizeChange);
}
