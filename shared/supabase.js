/**
 * AI 세일즈 시스템 — 공통 Supabase 클라이언트
 * 모든 앱에서 <script src="/shared/supabase.js"></script>로 로드
 */

// Supabase CDN (v2)
(function() {
  if (window.__dinoSupabaseLoaded) return;
  window.__dinoSupabaseLoaded = true;

  const SUPABASE_URL = 'https://xmlcczczizqenrdsmnmi.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhtbGNjemN6aXpxZW5yZHNtbm1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MTQyMTUsImV4cCI6MjA5MDk5MDIxNX0.PaNDncMLVZ3yfaALPe2QjnuRZp2vfg4Gu7V2yM3o5UU';

  // Load Supabase JS library
  const script = document.createElement('script');
  script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
  script.onload = function() {
    window.dinoSupabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    window.dispatchEvent(new Event('dino-supabase-ready'));
  };
  document.head.appendChild(script);
})();
