// Radar Voronoi por Shaders (WEBGL2) + Interfaz Física ESP32 (Inalámbrico)
let miShader;
let particulas = [];
const numParticulas = 8;
const idManual = 0; 
const velocidadTeclado = 5.5;

let velocidadOndas = 2.2;
let frecuenciaOndas = 0.08; 
let tasaGeneracionOndas = 60;

let itemActivo = false;
let itemVisible = false; 
let tiempoVisibilidad = 0; 
let posItem;
const radioItem = 20; 

let ondasUsuario = []; 
let ondasEsfera = []; 

const paletaColores = [
  [1.0, 0.84, 0.0], [0.0, 0.86, 0.31], [1.0, 0.20, 0.20],
  [0.0, 0.78, 1.0], [0.94, 0.20, 0.94], [1.0, 0.51, 0.0], [0.66, 1.0, 0.0]
];

// ── VARIABLES GLOBALES DE RED (ESP32) ──────────────────
let socket;
let ipESP32 = "192.168.1.50"; // Tu IP fija verificada

// Variables de almacenamiento de hardware
let pot1 = 0.0, pot2 = 0.0;
let btn1 = 1, btn2 = 1, btn3 = 1;

// Estados anteriores de los botones para detectar el click físico (Flanco de bajada)
let ultimoBtn1 = 1, ultimoBtn2 = 1, ultimoBtn3 = 1;

// Control de permisos para sensores móviles
let sensoresActivados = false;

// SECTION DE AUDIO Y VOLÚMENES
let sonidoMostrarEsfera;
let sonidoAgarrarEsfera;
let sonidoMovimientoUsuario;
let sonidoCortina1;
let sonidoCortina2;

const volMostrarEsfera = 0.6;
const volAgarrarEsfera = 0.7;
const volMovimientoUsuario = 0.4;
const volCortina1 = 0.5;
const volCortina2 = 0.3;

function preload() {
  sonidoMostrarEsfera = loadSound('mostrar_esfera.mp3');
  sonidoAgarrarEsfera = loadSound('agarrar_esfera.mp3');
  sonidoMovimientoUsuario = loadSound('movimiento.mp3');
  sonidoCortina1 = loadSound('cortina1.mp3');
  sonidoCortina2 = loadSound('cortina2.mp3');
}

const vs = `#version 300 es
  in vec3 aPosition; in vec2 aTexCoord; out vec2 vTexCoord;
  void main() { vTexCoord = aTexCoord; gl_Position = vec4(aPosition, 1.0); }`;

const fs = `#version 300 es
  precision mediump float;
  in vec2 vTexCoord; out vec4 fragmentColor;
  uniform vec2 u_resolution; uniform float u_time;
  uniform vec2 u_positions[8]; uniform vec3 u_colors[8];
  uniform float u_waveSpeed; uniform float u_waveFreq;

  void main() {
    vec2 st = vTexCoord * u_resolution; st.y = u_resolution.y - st.y;
    float dMinima = 100000.0; float dSegundaMinima = 100000.0; int indiceCercano = 0;
    for (int i = 0; i < 8; i++) {
      float d = distance(st, u_positions[i]);
      if (d < dMinima) { dSegundaMinima = dMinima; dMinima = d; indiceCercano = i; }
      else if (d < dSegundaMinima) { dSegundaMinima = d; }
    }
    float ondaPared = sin(dMinima * u_waveFreq - u_time * u_waveSpeed);
    vec3 colorFinal = vec3(0.0);
    if (ondaPared > 0.94) {
      float factorFrontera = dSegundaMinima - dMinima;
      if (factorFrontera > 3.0) {
        float intensidad = smoothstep(0.94, 1.0, ondaPared);
        if (factorFrontera < 10.0) intensidad *= smoothstep(3.0, 10.0, factorFrontera);
        colorFinal = u_colors[indiceCercano] * intensidad;
      }
    }
    fragmentColor = vec4(colorFinal, 1.0);
  }`;

function setup() {
  pixelDensity(1); 

  createCanvas(windowWidth, windowHeight, WEBGL);
  miShader = createShader(vs, fs);
  posItem = createVector(0, 0);
  
  inicializarWebSocket();
  respawnItem();

  for (let i = 0; i < numParticulas; i++) {
    let tonos = obtenerTonosRandom();
    particulas.push({ 
      pos: createVector(random(-width/4, width/4), random(-height/4, height/4)), 
      vel: p5.Vector.random2D().mult(random(0.8, 1.8)), 
      colClaro: tonos.claro, colOscuro: tonos.oscuro 
    });
  }

  sonidoMostrarEsfera.setVolume(volMostrarEsfera);
  sonidoAgarrarEsfera.setVolume(volAgarrarEsfera);
  sonidoMovimientoUsuario.setVolume(volMovimientoUsuario);
  sonidoCortina1.setVolume(volCortina1);
  sonidoCortina2.setVolume(volCortina2);

  sonidoCortina1.loop();
  sonidoCortina2.loop();
}

function draw() {
  background(0);
  let gl = this._renderer.GL;
  gl.enable(gl.DEPTH_TEST);

  procesarEntradasFisicas();
  manejarControlesMix(); 
  verificarColisionItem();
  
  if (itemActivo) {
    let d = dist(particulas[idManual].pos.x, particulas[idManual].pos.y, posItem.x, posItem.y);
    let seVolvioVisible = (d < 160) || (tiempoVisibilidad > 0);
    if (seVolvioVisible && !itemVisible) {
      if (!sonidoMostrarEsfera.isPlaying()) {
        sonidoMostrarEsfera.play();
      }
    }
    
    itemVisible = seVolvioVisible;
    if (tiempoVisibilidad > 0) tiempoVisibilidad--;
    if (itemVisible && frameCount % 40 === 0) ondasEsfera.push({ r: radioItem, a: 150 });
  }
  
  if (frameCount % 80 === 0) ondasUsuario.push({ r: 0, a: 255 });
  
  for (let i = 0; i < numParticulas; i++) {
    let p = particulas[i];
    if (i !== idManual) {
      p.pos.add(p.vel);
      if (p.pos.x < -width/2 || p.pos.x > width/2) p.vel.x *= -1;
      if (p.pos.y < -height/2 || p.pos.y > height/2) p.vel.y *= -1;
    }
  }

  let posArr = []; let colArr = [];
  for (let i = 0; i < numParticulas; i++) {
    posArr.push(particulas[i].pos.x + width / 2, particulas[i].pos.y + height / 2);
    colArr.push(particulas[i].colClaro[0], particulas[i].colClaro[1], particulas[i].colClaro[2]);
  }

  shader(miShader);
  miShader.setUniform("u_resolution", [width, height]);
  miShader.setUniform("u_time", millis() * 0.001);
  miShader.setUniform("u_positions", posArr);
  miShader.setUniform("u_colors", colArr);
  miShader.setUniform("u_waveSpeed", velocidadOndas);
  miShader.setUniform("u_waveFreq", frecuenciaOndas);
  beginShape(); vertex(-1, -1, 0, 0, 0); vertex(1, -1, 0, 1, 0); vertex(1, 1, 0, 1, 1); vertex(-1, 1, 0, 0, 1); endShape(CLOSE);
  
  resetShader();
  gl.disable(gl.DEPTH_TEST);
  dibujarElementsInteractivos();
  dibujarIndicadorConexion();

  if (!sensoresActivados && typeof DeviceOrientationEvent !== 'undefined') {
    dibujarCartelPermisos();
  }
}

function dibujarCartelPermisos() {
  push();
  resetShader();
  translate(0, 0, 10); 
  fill(0, 0, 0, 200);
  rect(-150, -30, 300, 60, 10);
  fill(255);
  textAlign(CENTER, CENTER);
  textSize(14);
  text("TOQUE LA PANTALLA\npara activar el visor", 0, 0);
  pop();
}

function procesarEntradasFisicas() {
  velocidadOndas = map(pot1, 0.0, 1.0, 0.5, 8.0);
  frecuenciaOndas = map(pot2, 0.0, 1.0, 0.02, 0.3);

  if (btn1 === 0 && ultimoBtn1 === 1) {
    let tonos = obtenerTonosRandom();
    particulas[idManual].colClaro = tonos.claro;
    particulas[idManual].colOscuro = tonos.oscuro;
  }
  
  if (btn2 === 0 && ultimoBtn2 === 1) {
    for (let i = 0; i < numParticulas; i++) {
      if (i !== idManual) {
        let tonos = obtenerTonosRandom();
        particulas[i].colClaro = tonos.claro;
        particulas[i].colOscuro = tonos.oscuro;
      }
    }
  }

  if (btn3 === 0 && ultimoBtn3 === 1) {
    tiempoVisibilidad = 30;
    if (!sonidoMostrarEsfera.isPlaying()) {
      sonidoMostrarEsfera.play();
    }
  }

  ultimoBtn1 = btn1;
  ultimoBtn2 = btn2;
  ultimoBtn3 = btn3;
}

// ── FUSIÓN DE CONTROLES MIX CORREGIDA PARA CELULAR HORIZONTAL (VISOR VR) ──
function manejarControlesMix() {
  let p = particulas[idManual];
  let posicionAnterior = p.pos.copy();
  let seEstaMoviendo = false;

  // 1. CONTROL POR GIROSCOPIO (Calibrado para pantalla horizontal en las gafas)
  if (typeof rotationX !== 'undefined' && typeof rotationY !== 'undefined') {
    
    // EJE X (Girar a los lados): En modo horizontal, este movimiento lo detecta rotationX.
    // Restamos 90 para que mirar al frente sea el punto de equilibrio (0).
    let inclinacionHorizontal = rotationX - 90.0;
    let dx = inclinacionHorizontal * 0.675; 
    
    // EJE Y (Mirar arriba/abajo): En modo horizontal, este movimiento lo detecta rotationY.
    // Invertimos el signo (-) para que al mirar arriba la esfera suba, y al mirar abajo baje.
    let dy = -rotationY * 0.675;

    // Filtro para ignorar micromovimientos del cuello
    if (abs(inclinacionHorizontal) > 0.4 || abs(rotationY) > 0.4) {
      p.pos.x += dx;
      p.pos.y += dy;
      seEstaMoviendo = true;
    }
  }
  
  // 2. CONTROL POR TECLADO (Se mantiene igual para pruebas en PC)
  if (keyIsDown(LEFT_ARROW) || keyIsDown(65)) { p.pos.x -= velocidadTeclado; seEstaMoviendo = true; }
  if (keyIsDown(RIGHT_ARROW) || keyIsDown(68)) { p.pos.x += velocidadTeclado; seEstaMoviendo = true; }
  if (keyIsDown(DOWN_ARROW) || keyIsDown(83)) { p.pos.y += velocidadTeclado; seEstaMoviendo = true; } 
  if (keyIsDown(UP_ARROW) || keyIsDown(87)) { p.pos.y -= velocidadTeclado; seEstaMoviendo = true; }   

  p.pos.x = constrain(p.pos.x, -width / 2, width / 2);
  p.pos.y = constrain(p.pos.y, -height / 2, height / 2);

  let movReal = dist(p.pos.x, p.pos.y, posicionAnterior.x, posicionAnterior.y) > 0.3;

  if (movReal && seEstaMoviendo) {
    if (!sonidoMovimientoUsuario.isLooping()) {
      sonidoMovimientoUsuario.loop();
    }
  } else {
    if (sonidoMovimientoUsuario.isLooping()) {
      sonidoMovimientoUsuario.stop();
    }
  }
}

function inicializarWebSocket() {
  socket = new WebSocket("ws://" + ipESP32 + ":81");
  socket.onopen = function() { console.log("Conectado exitosamente con la interfaz física."); };
  socket.onmessage = function(event) {
    let valores = split(event.data, ',');
    if (valores.length >= 5) {
      pot1 = float(valores[0]); pot2 = float(valores[1]);
      btn1 = int(valores[2]); btn2 = int(valores[3]); btn3 = int(valores[4]);
    }
  };
  socket.onclose = function() { setTimeout(inicializarWebSocket, 2000); };
}

function dibujarIndicadorConexion() {
  push(); translate(-width/2 + 20, -height/2 + 20); noStroke();
  if (socket && socket.readyState === WebSocket.OPEN) { fill(0, 255, 100); } 
  else { fill(255, 50, 50); }
  ellipse(0, 0, 12, 12); pop();
}

function dibujarElementsInteractivos() {
  let pUser = particulas[idManual];
  
  push(); translate(pUser.pos.x, pUser.pos.y);
  for (let i = ondasUsuario.length - 1; i >= 0; i--) {
    let o = ondasUsuario[i]; noFill(); stroke(255, o.a); strokeWeight(2);
    ellipse(0, 0, o.r * 2); o.r += 0.8; o.a -= 1.5; 
    if (o.a <= 0) ondasUsuario.splice(i, 1);
  }
  rotate(millis() * 0.001); stroke(255, 200); strokeWeight(3);
  line(0, 0, 0, -150); fill(255); noStroke(); ellipse(0, 0, 8, 8); pop();

  if (itemVisible) {
    for (let i = ondasEsfera.length - 1; i >= 0; i--) {
      let o = ondasEsfera[i]; push(); translate(posItem.x, posItem.y);
      noFill(); stroke(255, 255, 0, o.a); strokeWeight(2);
      ellipse(0, 0, o.r * 2); o.r += 2; o.a -= 2;
      if (o.a <= 0) ondasEsfera.splice(i, 1); pop();
    }
  }

  if (itemActivo && itemVisible) {
    push(); translate(posItem.x, posItem.y); stroke(255); strokeWeight(3); fill(255, 100); 
    ellipse(0, 0, radioItem * 2, radioItem * 2); pop();
  }
  
  for (let i = 0; i < numParticulas; i++) {
    let p = particulas[i]; push(); translate(p.pos.x, p.pos.y);
    if (i === idManual) { stroke(255); strokeWeight(2); noFill(); ellipse(0, 0, 24, 24); } 
    else { 
        noStroke();
        fill(p.colClaro[0]*255, p.colClaro[1]*255, p.colClaro[2]*255, 200);
        ellipse(0, 0, 14, 14); 
        fill(p.colOscuro[0]*255, p.colOscuro[1]*255, p.colOscuro[2]*255, 255);
        ellipse(0, 0, 7, 7); 
    } pop();
  }
}

function keyPressed() {
  if (key === 'c' || key === 'C') {
    let tonos = obtenerTonosRandom();
    particulas[idManual].colClaro = tonos.colClaro;
    particulas[idManual].colOscuro = tonos.oscuro;
  }
  if (key === 'v' || key === 'V') {
    for (let i = 0; i < numParticulas; i++) {
      if (i !== idManual) {
        let tonos = obtenerTonosRandom();
        particulas[i].colClaro = tonos.claro;   
        particulas[i].colOscuro = tonos.oscuro; 
      }
    }
  }
  if (key === 'b' || key === 'B') {
    tiempoVisibilidad = 30;
    if (!sonidoMostrarEsfera.isPlaying()) { sonidoMostrarEsfera.play(); }
  }
}

function verificarColisionItem() {
  if (itemActivo) {
    let d = dist(particulas[idManual].pos.x, particulas[idManual].pos.y, posItem.x, posItem.y);
    if (d < radioItem + 10) {
      sonidoAgarrarEsfera.play();
      ondasEsfera = []; 
      for (let p of particulas) {
          let tonos = obtenerTonosRandom();
          p.colClaro = tonos.claro; p.colOscuro = tonos.oscuro;
      }
      respawnItem();
    }
  }
}

function respawnItem() {
  posItem.set(random(-width * 0.3, width * 0.3), random(-height * 0.3, height * 0.3));
  itemActivo = true; itemVisible = false;
}

function obtenerTonosRandom() {
  let base = random(paletaColores);
  return { claro: base, oscuro: [base[0] * 0.3, base[1] * 0.3, base[2] * 0.3] };
}

function windowResized() { resizeCanvas(windowWidth, windowHeight); }

function touchStarted() {
  if (getAudioContext().state !== 'running') { getAudioContext().resume(); }
  if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission()
      .then(permissionState => { if (permissionState === 'granted') { sensoresActivados = true; } })
      .catch(console.error);
  } else { sensoresActivados = true; }
}