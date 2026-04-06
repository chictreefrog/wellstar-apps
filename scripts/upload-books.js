/**
 * "30초 만에 YES" PDF를 Gemini File Search Store에 업로드하는 1회성 스크립트
 *
 * 사전 준비:
 *   npm install @google/genai
 *
 * 사용법:
 *   GEMINI_API_KEY=your-key node scripts/upload-books.js
 *
 * 실행 후 출력되는 File Search Store 이름을 Vercel 환경변수 GEMINI_FILE_STORE에 설정하세요.
 */

const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');
const path = require('path');

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('Error: GEMINI_API_KEY 환경변수를 설정하세요.');
  console.error('  GEMINI_API_KEY=your-key node scripts/upload-books.js');
  process.exit(1);
}

const client = new GoogleGenAI({ apiKey: API_KEY });

// PDF 파일 목록
const BOOK_DIR = path.resolve('E:\\01.전자책\\30초면 YES\\30초 만에 YES 전자책(판매용)\\30초만에 yes 원본');
const BOOKS = [
  { file: '30초 만에 YES(완성본)_프롤로그.pdf', part: '프롤로그', title: '프롤로그 - 세상에서 가장 서늘한 한마디', category: 'general' },
  { file: '30초 만에 YES(완성본)_1부.pdf', part: '1부', title: '마음 다지기 1 - 거절에 흔들리지 않는 마음의 방패', category: 'mindset' },
  { file: '30초 만에 YES(완성본)_2부.pdf', part: '2부', title: '마음 다지기 2 - 내면의 힘 키우기', category: 'mindset' },
  { file: '30초 만에 YES(완성본)_3부.pdf', part: '3부', title: '관계 열기 - 경계심을 허물고 마음의 문 두드리기', category: 'rapport' },
  { file: '30초 만에 YES(완성본)_4부.pdf', part: '4부', title: '거절 넘기 - 장애물을 기회로 바꾸는 실전 대응', category: 'objection' },
  { file: '30초 만에 YES(완성본)_5부.pdf', part: '5부', title: '계약 성사 - 상대가 먼저 손 내밀게 만드는 마무리', category: 'closing' },
  { file: '30초 만에 YES(완성본)_6부.pdf', part: '6부', title: '함께 성장하기 1 - 파트너를 키우는 시스템', category: 'team' },
  { file: '30초 만에 YES(완성본)_7부.pdf', part: '7부', title: '함께 성장하기 2 - 멋진 마을 건설하기', category: 'team' },
  { file: '30초 만에 YES(완성본)_에필로그.pdf', part: '에필로그', title: '에필로그', category: 'general' },
];

async function main() {
  console.log('========================================');
  console.log('"30초 만에 YES" PDF → Gemini File Search 업로드');
  console.log('========================================\n');

  // Step 1: File Search Store 생성
  console.log('1. File Search Store 생성...');
  let store;
  try {
    store = await client.fileSearchStores.create({
      displayName: '30초 만에 YES - 세일즈 코칭 지식베이스',
    });
    console.log(`   ✅ Store 생성 완료: ${store.name}\n`);
  } catch (err) {
    if (err.message?.includes('ALREADY_EXISTS')) {
      console.log('   Store가 이미 존재합니다. 기존 Store를 사용합니다.\n');
      // List stores to find existing one
      const stores = await client.fileSearchStores.list();
      for await (const s of stores) {
        if (s.displayName?.includes('세일즈') || s.displayName?.includes('YES')) {
          store = s;
          break;
        }
      }
      if (!store) {
        console.error('   ❌ 기존 Store를 찾을 수 없습니다.');
        process.exit(1);
      }
    } else {
      throw err;
    }
  }

  const storeName = store.name;
  console.log(`   Store: ${storeName}\n`);

  // Step 2: PDF 파일 업로드
  console.log('2. PDF 파일 업로드 시작...\n');
  const results = [];

  for (const book of BOOKS) {
    const filePath = path.join(BOOK_DIR, book.file);

    if (!fs.existsSync(filePath)) {
      console.log(`   ⚠️ 파일 없음: ${book.file} — 건너뜁니다.`);
      continue;
    }

    const fileSize = fs.statSync(filePath).size;
    console.log(`   📄 ${book.part}: ${book.file} (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);

    try {
      const result = await client.fileSearchStores.uploadToFileSearchStore({
        fileSearchStoreName: storeName,
        file: filePath,
        config: {
          displayName: `${book.part} - ${book.title}`,
          mimeType: 'application/pdf',
          customMetadata: [
            { key: 'part', stringValue: book.part },
            { key: 'category', stringValue: book.category },
            { key: 'title', stringValue: book.title },
            { key: 'book', stringValue: '30초 만에 YES' },
            { key: 'author', stringValue: '옆집디노' },
          ],
          chunkingConfig: {
            chunkingStrategy: 'AUTO',
          },
        },
      });

      console.log(`   ✅ 업로드 완료: ${result.documentName || '성공'}`);
      results.push({ ...book, documentName: result.documentName });
    } catch (err) {
      console.log(`   ❌ 오류: ${err.message}`);
    }

    // Rate limiting
    await new Promise(r => setTimeout(r, 3000));
  }

  console.log('\n========================================');
  console.log(`완료! ${results.length}/${BOOKS.length} 파일 업로드됨`);
  console.log('========================================\n');

  console.log('📋 다음 단계:');
  console.log(`   1. Vercel 환경변수에 추가:`);
  console.log(`      GEMINI_FILE_STORE = ${storeName}`);
  console.log(`   2. Vercel에서 Redeploy`);
  console.log('');

  // Save results
  const outputPath = path.join(__dirname, 'upload-results.json');
  fs.writeFileSync(outputPath, JSON.stringify({ storeName, results }, null, 2));
  console.log(`결과 저장: ${outputPath}`);
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
