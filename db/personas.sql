-- ════════════════════════════════════════════════════════════════
-- 회사 카탈로그(관리자 등록) + 사용자 페르소나  — 프로젝트: xmlcczczizqenrdsmnmi
-- SQL Editor(dino-sales)에 붙여넣고 Run (재실행 안전)
-- ════════════════════════════════════════════════════════════════

-- 1) 회사 (옆집디노 admin이 등록)
CREATE TABLE IF NOT EXISTS public.companies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  website     text,
  brand_tone  text,             -- 브랜드 말투/이미지 한 줄
  notes       text,             -- 금지/주의 표현, 브랜드 가이드
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- 2) 회사 제품
CREATE TABLE IF NOT EXISTS public.company_products (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id  uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  name        text NOT NULL,
  category    text,
  benefits    text,             -- 핵심 효능
  cautions    text,             -- 금지/주의 표현
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_company_products_company ON public.company_products(company_id);

-- 3) profiles에 소속 회사 + 페르소나(개인 정보)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS persona    jsonb;
-- persona 예: { "products":["메타부스트"], "age_band":"30대", "gender":"여",
--               "region":"부산", "target":"다이어트 고민 직장맘", "purpose":"제품 알리기",
--               "sales_stage":"이제 시작", "motivation":"출산 후 14kg 감량" }

-- 4) RLS
ALTER TABLE public.companies        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_products ENABLE ROW LEVEL SECURITY;

-- 카탈로그 조회: 로그인 사용자 누구나 (페르소나 드롭다운 + 콘텐츠 생성에 필요)
DROP POLICY IF EXISTS companies_select_all ON public.companies;
CREATE POLICY companies_select_all ON public.companies
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS company_products_select_all ON public.company_products;
CREATE POLICY company_products_select_all ON public.company_products
  FOR SELECT TO authenticated USING (true);

-- 등록/수정/삭제: admin(옆집디노)만
DROP POLICY IF EXISTS companies_admin_write ON public.companies;
CREATE POLICY companies_admin_write ON public.companies
  FOR ALL TO authenticated
  USING      (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));
DROP POLICY IF EXISTS company_products_admin_write ON public.company_products;
CREATE POLICY company_products_admin_write ON public.company_products
  FOR ALL TO authenticated
  USING      (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'))
  WITH CHECK (auth.uid() IN (SELECT id FROM public.profiles WHERE role = 'admin'));
