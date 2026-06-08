-- ════════════════════════════════════════════════════════════════
-- 사용권(충전식 크레딧) 스키마  — 프로젝트: xmlcczczizqenrdsmnmi
-- Supabase SQL Editor에 통째로 붙여넣고 Run (재실행 안전 — IF NOT EXISTS / DROP IF EXISTS)
-- 1 크레딧 = 1원
-- ════════════════════════════════════════════════════════════════

-- 1) 잔액 컬럼 (profiles에 캐시)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS credit_balance integer NOT NULL DEFAULT 0;

-- 2) 충전 주문 (페이앱 멱등성 키 = payapp_order_id = mul_no)
CREATE TABLE IF NOT EXISTS public.credit_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  payapp_order_id text UNIQUE,                       -- 페이앱 mul_no
  amount          integer NOT NULL,                  -- 적립 크레딧 (= price, 1:1)
  price           integer NOT NULL,                  -- 결제 금액(원)
  status          text NOT NULL DEFAULT 'requested', -- requested | paid | cancelled
  recvphone       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  paid_at         timestamptz
);
CREATE INDEX IF NOT EXISTS idx_credit_orders_user ON public.credit_orders(user_id, created_at DESC);

-- 3) 거래 원장 (충전/사용 전부 기록)
CREATE TABLE IF NOT EXISTS public.credit_transactions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  delta         integer NOT NULL,        -- +충전 / -사용
  balance_after integer NOT NULL,
  kind          text NOT NULL,           -- charge | use | refund | bonus | adjust
  tool          text,                    -- chatbot | roleplay | content | review | payment
  ref           text,                    -- mul_no 또는 session_id 등
  memo          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_credit_tx_user ON public.credit_transactions(user_id, created_at DESC);

-- 4) RLS — 본인 것만 조회. INSERT/UPDATE 정책 없음 = 일반 사용자 쓰기 차단(서버 service_role만 RLS 우회)
ALTER TABLE public.credit_orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_orders_select_own ON public.credit_orders;
CREATE POLICY credit_orders_select_own ON public.credit_orders
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS credit_tx_select_own ON public.credit_transactions;
CREATE POLICY credit_tx_select_own ON public.credit_transactions
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 5) 원자적 충전 RPC (서버/웹훅이 service_role로 호출)
CREATE OR REPLACE FUNCTION public.add_credits(
  p_user uuid, p_amount integer, p_kind text, p_ref text, p_memo text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance integer;
BEGIN
  UPDATE public.profiles
     SET credit_balance = credit_balance + p_amount
   WHERE id = p_user
   RETURNING credit_balance INTO new_balance;
  IF NOT FOUND THEN RETURN -1; END IF;
  INSERT INTO public.credit_transactions(user_id, delta, balance_after, kind, tool, ref, memo)
       VALUES (p_user, p_amount, new_balance, p_kind, 'payment', p_ref, p_memo);
  RETURN new_balance;
END; $$;

-- 6) 원자적 차감 RPC (잔액 부족 시 -1 반환, 차감 안 함) — 2단계에서 AI 도구가 호출
CREATE OR REPLACE FUNCTION public.spend_credits(
  p_user uuid, p_amount integer, p_tool text, p_ref text
) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE new_balance integer;
BEGIN
  UPDATE public.profiles
     SET credit_balance = credit_balance - p_amount
   WHERE id = p_user AND credit_balance >= p_amount
   RETURNING credit_balance INTO new_balance;
  IF NOT FOUND THEN RETURN -1; END IF;   -- 잔액 부족
  INSERT INTO public.credit_transactions(user_id, delta, balance_after, kind, tool, ref)
       VALUES (p_user, -p_amount, new_balance, 'use', p_tool, p_ref);
  RETURN new_balance;
END; $$;

-- 7) 보안: 일반 사용자가 직접 호출 못 하게 막고 service_role만 허용 (자가 충전 방지!)
REVOKE EXECUTE ON FUNCTION public.add_credits(uuid,integer,text,text,text)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.spend_credits(uuid,integer,text,text)     FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.add_credits(uuid,integer,text,text,text)  TO service_role;
GRANT  EXECUTE ON FUNCTION public.spend_credits(uuid,integer,text,text)     TO service_role;
