// 안심케어 아이콘 빌드: 코랄 배경 + 은발 뽀글이 펌 할머니 → SVG + 192/512 PNG
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const C = {
  bgTop: '#FFB48E', bgBot: '#FF8E6B',          // 따뜻한 코랄(테일 배경에서 확 보임)
  halo: '#FFFFFF',
  hair: '#E9E9EF', hairSh: '#D3D3DC', curl: '#CFCFD9',
  skin: '#F6CCA4', skinSh: '#F0BE92', ear: '#F2C49C',
  cardi: '#3C8E6A', cardiV: '#2E7D5B', cardiEdge: '#5BA888',
  gold: '#C99A3D', eye: '#5A4632', brow: '#C2C2CC',
  blush: '#F0978B', mouth: '#C15D46',
  pearl: '#FCFCFE', heart: '#FFF2E6', heartLine: '#FF8088',
};

const rad = d => d * Math.PI / 180;

// ── 펌 컬: 머리 윗부분 테두리를 따라 동글동글한 원들 ──
const hairCx = 256, hairCy = 226, hairRx = 134, hairRy = 140;
let curls = '';
let texture = '';
// 바깥 테두리 컬 (-38° ~ 218°, 90°=정수리)
for (let i = 0; i <= 16; i++) {
  const a = -38 + (256 / 16) * i;       // -38 → 218
  const x = hairCx + hairRx * Math.cos(rad(a));
  const y = hairCy - hairRy * Math.sin(rad(a));
  const r = 27 + (i % 3) * 4;
  curls += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${r}" fill="${C.hair}"/>`;
}
// 안쪽 한 겹 더 (볼륨)
for (let i = 0; i <= 13; i++) {
  const a = -20 + (220 / 13) * i;
  const x = hairCx + (hairRx - 30) * Math.cos(rad(a));
  const y = hairCy - (hairRy - 30) * Math.sin(rad(a));
  curls += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="22" fill="${C.hair}"/>`;
}
// 컬 질감(살짝 어두운 작은 c자)
for (let i = 0; i <= 14; i++) {
  const a = -30 + (256 / 14) * i;
  const x = hairCx + (hairRx - 12) * Math.cos(rad(a));
  const y = hairCy - (hairRy - 12) * Math.sin(rad(a));
  texture += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="none" stroke="${C.curl}" stroke-width="4"/>`;
}

const svg = `<svg width="512" height="512" viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.bgTop}"/><stop offset="1" stop-color="${C.bgBot}"/>
    </linearGradient>
    <radialGradient id="halo" cx="0.5" cy="0.45" r="0.6">
      <stop offset="0" stop-color="${C.halo}" stop-opacity="0.30"/>
      <stop offset="1" stop-color="${C.halo}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="512" height="512" fill="url(#bg)"/>
  <circle cx="256" cy="246" r="200" fill="url(#halo)"/>

  <!-- cardigan -->
  <path d="M78 512 C78 432 156 398 256 398 C356 398 434 432 434 512 Z" fill="${C.cardi}"/>
  <path d="M214 402 L256 470 L298 402 Z" fill="${C.cardiV}"/>
  <path d="M86 512 C94 470 122 446 152 432" fill="none" stroke="${C.cardiEdge}" stroke-width="6" stroke-linecap="round" opacity="0.7"/>
  <path d="M426 512 C418 470 390 446 360 432" fill="none" stroke="${C.cardiEdge}" stroke-width="6" stroke-linecap="round" opacity="0.7"/>

  <!-- neck -->
  <rect x="226" y="356" width="60" height="58" rx="26" fill="${C.skinSh}"/>

  <!-- hair (perm) base + curls behind face -->
  <ellipse cx="${hairCx}" cy="${hairCy}" rx="${hairRx}" ry="${hairRy}" fill="${C.hair}"/>
  ${curls}
  ${texture}

  <!-- ears + pearl earrings -->
  <ellipse cx="142" cy="270" rx="19" ry="25" fill="${C.ear}"/>
  <ellipse cx="370" cy="270" rx="19" ry="25" fill="${C.ear}"/>
  <circle cx="142" cy="298" r="7" fill="${C.pearl}" stroke="#E2D9C9" stroke-width="2"/>
  <circle cx="370" cy="298" r="7" fill="${C.pearl}" stroke="#E2D9C9" stroke-width="2"/>

  <!-- face -->
  <ellipse cx="256" cy="264" rx="112" ry="120" fill="${C.skin}"/>

  <!-- eyebrows (silver) -->
  <path d="M184 222 q26 -11 50 -1" fill="none" stroke="${C.brow}" stroke-width="6" stroke-linecap="round"/>
  <path d="M278 221 q26 -10 50 1" fill="none" stroke="${C.brow}" stroke-width="6" stroke-linecap="round"/>

  <!-- blush -->
  <ellipse cx="184" cy="308" rx="24" ry="14" fill="${C.blush}" opacity="0.45"/>
  <ellipse cx="328" cy="308" rx="24" ry="14" fill="${C.blush}" opacity="0.45"/>

  <!-- glasses -->
  <circle cx="208" cy="262" r="38" fill="#FFFFFF" opacity="0.22"/>
  <circle cx="304" cy="262" r="38" fill="#FFFFFF" opacity="0.22"/>
  <circle cx="208" cy="262" r="38" fill="none" stroke="${C.gold}" stroke-width="8"/>
  <circle cx="304" cy="262" r="38" fill="none" stroke="${C.gold}" stroke-width="8"/>
  <path d="M246 260 q10 -10 20 0" fill="none" stroke="${C.gold}" stroke-width="8" stroke-linecap="round"/>
  <path d="M172 256 L150 260" fill="none" stroke="${C.gold}" stroke-width="8" stroke-linecap="round"/>
  <path d="M340 256 L362 260" fill="none" stroke="${C.gold}" stroke-width="8" stroke-linecap="round"/>

  <!-- smiling eyes -->
  <path d="M192 266 q16 -19 32 0" fill="none" stroke="${C.eye}" stroke-width="7" stroke-linecap="round"/>
  <path d="M288 266 q16 -19 32 0" fill="none" stroke="${C.eye}" stroke-width="7" stroke-linecap="round"/>

  <!-- nose -->
  <path d="M250 306 q7 6 14 2" fill="none" stroke="#DE9C76" stroke-width="5" stroke-linecap="round"/>

  <!-- smile -->
  <path d="M222 330 q34 28 68 0" fill="none" stroke="${C.mouth}" stroke-width="8" stroke-linecap="round"/>

  <!-- heart pin -->
  <g transform="translate(212,452)">
    <path d="M0 7 C0 7 -15 -4 -15 -15 C-15 -23 -6 -25 0 -16 C6 -25 15 -23 15 -15 C15 -4 0 7 0 7 Z" fill="${C.heart}" stroke="${C.heartLine}" stroke-width="3"/>
  </g>
</svg>`;

const careDir = path.join(__dirname, '..', 'care');
fs.writeFileSync(path.join(careDir, 'icon.svg'), svg);
Promise.all([
  sharp(Buffer.from(svg), { density: 300 }).resize(512, 512).png().toFile(path.join(careDir, 'icon-512.png')),
  sharp(Buffer.from(svg), { density: 300 }).resize(192, 192).png().toFile(path.join(careDir, 'icon-192.png')),
]).then(() => console.log('care icon built: svg + 192 + 512')).catch(e => { console.error(e); process.exit(1); });
