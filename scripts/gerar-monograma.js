/**
 * Gera frontend/public/rt-monogram.png a partir do logo horizontal.
 *
 * O ParticleField amostra os pixels claros de um PNG para posicionar as
 * particulas. O logo horizontal (1558x400) e largo demais para a coluna
 * esquerda, entao recortamos so o monograma RT e centralizamos num quadrado.
 *
 * Uso: node scripts/gerar-monograma.js
 */
const fs = require('fs');
const path = require('path');
const { decode, encode } = require('./png-lite');

const RAIZ = path.join(__dirname, '..');
const ENTRADA = path.join(RAIZ, 'frontend/public/logo-rt-horizontal-white.png');
const SAIDA = path.join(RAIZ, 'frontend/public/rt-monogram.png');

/** Colunas/linhas com pelo menos um pixel opaco delimitam a marca. */
function recortarPorAlpha(img, xInicio, xFim) {
  let topo = img.h, base = -1, esq = xFim, dir = -1;
  for (let y = 0; y < img.h; y++) {
    for (let x = xInicio; x <= xFim; x++) {
      if (img.rgba[(y * img.w + x) * 4 + 3] > 128) {
        if (y < topo) topo = y;
        if (y > base) base = y;
        if (x < esq) esq = x;
        if (x > dir) dir = x;
      }
    }
  }
  return { esq, dir, topo, base };
}

function main() {
  const img = decode(fs.readFileSync(ENTRADA));

  // O monograma e o primeiro bloco horizontal; o texto comeca depois de um vao
  // de colunas vazias. Localizamos esse vao em vez de fixar o x no codigo, para
  // o script sobreviver a uma troca do arquivo de logo.
  const ocupada = new Array(img.w).fill(false);
  for (let y = 0; y < img.h; y++) {
    for (let x = 0; x < img.w; x++) {
      if (img.rgba[(y * img.w + x) * 4 + 3] > 128) ocupada[x] = true;
    }
  }
  let fimMonograma = -1;
  let viuPixel = false;
  for (let x = 0; x < img.w; x++) {
    if (ocupada[x]) viuPixel = true;
    else if (viuPixel) { fimMonograma = x - 1; break; }
  }
  if (fimMonograma < 0) throw new Error('nao encontrei o vao entre marca e texto');

  const cx = recortarPorAlpha(img, 0, fimMonograma);
  const larguraMarca = cx.dir - cx.esq + 1;
  const alturaMarca = cx.base - cx.topo + 1;

  // Quadrado com uma margem de 12% para a figura nao encostar na borda do canvas.
  const lado = Math.round(Math.max(larguraMarca, alturaMarca) * 1.24);
  const deslocX = Math.round((lado - larguraMarca) / 2);
  const deslocY = Math.round((lado - alturaMarca) / 2);

  const saida = Buffer.alloc(lado * lado * 4); // transparente
  for (let y = 0; y < alturaMarca; y++) {
    for (let x = 0; x < larguraMarca; x++) {
      const de = ((cx.topo + y) * img.w + (cx.esq + x)) * 4;
      const para = ((deslocY + y) * lado + (deslocX + x)) * 4;
      img.rgba.copy(saida, para, de, de + 4);
    }
  }

  fs.writeFileSync(SAIDA, encode(lado, lado, saida));

  console.log(`marca detectada  x ${cx.esq}..${cx.dir}  y ${cx.topo}..${cx.base}`);
  console.log(`recorte          ${larguraMarca}x${alturaMarca}`);
  console.log(`gerado           ${path.relative(RAIZ, SAIDA)}  ${lado}x${lado}`);
}

main();
