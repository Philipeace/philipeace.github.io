// threeSetup.js
let scene, camera, renderer, controls;
let nucleusGroup;
let pointLight;
let ambientLight;

const protonMaterial= new THREE.MeshStandardMaterial({ color:0xff0000, roughness:0.8, metalness:0.1});
const neutronMaterial= new THREE.MeshStandardMaterial({ color:0x808080, roughness:0.8, metalness:0.1});
const nucleonGeometry= new THREE.SphereGeometry(0.04,8,6);

const vertexShader_PointScaling=`
attribute float pointRadius;
attribute float probabilityValue;
uniform float baseSize;
uniform float rMin;
uniform float rMax;
uniform float uMinSizeFactor;
uniform float uMaxSizeFactor;

varying float vProbability;
varying vec3 vWorldPosition;

void main(){
  vProbability= probabilityValue;

  vec4 worldPos= modelMatrix* vec4(position,1.0);
  vWorldPosition= worldPos.xyz;

  vec4 mvPosition= viewMatrix* worldPos;

  float radiusRange= max(1e-6, rMax- rMin);
  float normalizedRadius= clamp((pointRadius- rMin)/ radiusRange,0.0,1.0);
  float scaleFactor= mix(uMinSizeFactor,uMaxSizeFactor, normalizedRadius);

  gl_PointSize= baseSize* scaleFactor* (300.0/ -mvPosition.z);

  float maxClamp= baseSize* uMaxSizeFactor* 3.0;
  gl_PointSize= clamp(gl_PointSize,0.5, maxClamp);

  gl_Position= projectionMatrix* mvPosition;
}
`;

const fragmentShader_PointOpacity=`
uniform vec3 color;
uniform float baseOpacity;
uniform float uMinProb;
uniform float uMaxProb;
uniform float uCameraDistanceFalloff;

varying float vProbability;
varying vec3 vWorldPosition;

void main(){
  float probabilityRange= max(1e-9, uMaxProb- uMinProb);
  float normalizedProbability= clamp((vProbability- uMinProb)/ probabilityRange, 0.0,1.0);
  float opacityFactor= pow(normalizedProbability, 1.5);
  float probOpacity= baseOpacity* mix(0.05,1.0, opacityFactor);

  float distToCamera= distance(vWorldPosition, cameraPosition);
  float falloffStrength= uCameraDistanceFalloff/ 50.0;
  float decayFactor= falloffStrength*0.02;
  float distOpacityMultiplier= exp(-distToCamera* decayFactor);
  distOpacityMultiplier= clamp(distOpacityMultiplier,0.05,1.0);

  float finalOpacity= probOpacity* distOpacityMultiplier;

  float dist= length(gl_PointCoord- vec2(0.5));
  finalOpacity*= smoothstep(0.5,0.40, dist);

  if(finalOpacity<0.01) discard;
  gl_FragColor= vec4(color, finalOpacity);
}
`;

function initThreeJS(container){
  if(!container){
    console.error("No container found for THREE.js");
    return null;
  }
  scene= new THREE.Scene();

  const width= container.clientWidth||1;
  const height= container.clientHeight||1;
  camera= new THREE.PerspectiveCamera(60, width/height, 0.1,1000);
  camera.position.z=30;

  try{
    renderer= new THREE.WebGLRenderer({antialias:true, alpha:true});
    renderer.setSize(width,height);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.sortObjects= false;
    renderer.domElement.id='three-canvas';
    container.appendChild(renderer.domElement);
  } catch(e){
    console.error("Renderer creation failed:",e);
    container.innerHTML='<p style="color:red; padding:20px;">Could not initialize WebGL.</p>';
    return null;
  }

  ambientLight= new THREE.AmbientLight(0x505050);
  scene.add(ambientLight);

  pointLight= new THREE.PointLight(0xffffff,1.2,100,2);
  pointLight.position.set(0,0,0);
  scene.add(pointLight);

  controls= new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping= true;
  controls.dampingFactor=0.05;
  controls.screenSpacePanning= false;
  controls.minDistance=0.5;
  controls.maxDistance=300;

  nucleusGroup= new THREE.Group();
  nucleusGroup.name="NucleusGroup";
  scene.add(nucleusGroup);

  return {
    scene,
    camera,
    renderer,
    controls,
    nucleusGroup,
    pointLight,
    ambientLight
  };
}

function updateNucleusVisuals(protonCount, neutronCount, nucleusRadius){
  if(!nucleusGroup) return;
  while(nucleusGroup.children.length>0){
    nucleusGroup.remove(nucleusGroup.children[0]);
  }
  const totalNucleons= protonCount+ neutronCount;
  if(totalNucleons===0) return;

  const validRadius= Math.max(0.01, nucleusRadius);
  for(let i=0;i<totalNucleons;i++){
    const isProton= i< protonCount;
    const material= isProton? protonMaterial: neutronMaterial;
    const nucleonMesh= new THREE.Mesh(nucleonGeometry, material);

    const r= validRadius* Math.cbrt(Math.random());
    const theta= Math.random()*2*Math.PI;
    const phi= Math.acos((Math.random()*2)-1);
    nucleonMesh.position.set(
      r*Math.sin(phi)*Math.cos(theta),
      r*Math.sin(phi)*Math.sin(theta),
      r*Math.cos(phi)
    );
    nucleusGroup.add(nucleonMesh);
  }
}

function resizeThreeJS(container){
  if(!camera||!renderer||!container) return;
  const newWidth= container.clientWidth;
  const newHeight= container.clientHeight;
  if(newWidth<=0|| newHeight<=0) return;
  camera.aspect= newWidth/ newHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(newWidth,newHeight);
}

function renderScene(){
  if(renderer && scene && camera){
    renderer.render(scene,camera);
  }
}

