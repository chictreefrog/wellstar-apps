/**
 * 푸시 알림 클라이언트 헬퍼
 * - 알림 권한 상태 조회
 * - 구독 등록/해제
 * - DinoAuth 로그인 완료 후 자동으로 호출 가능
 *
 * 사용법:
 *   await DinoPush.subscribe(); // 권한 요청 + 구독 등록
 *   await DinoPush.unsubscribe(); // 구독 해제
 *   DinoPush.getStatus(); // 'granted' | 'denied' | 'default' | 'unsupported'
 */

window.DinoPush = (function() {
  const VAPID_PUBLIC_KEY = 'BFtqpdARYrKzic3GM_8-MEu2o1ZG4n5Mz6fSLjCsoytl0DUkP23PRCbnEw6FYB-aeNUn2XGfKCdED-EI1P7I9TM';

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(base64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; ++i) out[i] = raw.charCodeAt(i);
    return out;
  }

  function isSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  }

  function getStatus() {
    if (!isSupported()) return 'unsupported';
    return Notification.permission; // 'granted' | 'denied' | 'default'
  }

  async function getAccessToken() {
    if (!window.dinoSupabase) return '';
    const { data } = await window.dinoSupabase.auth.getSession();
    return data?.session?.access_token || '';
  }

  async function getActiveRegistration() {
    if (!('serviceWorker' in navigator)) return null;
    let reg = await navigator.serviceWorker.getRegistration();
    if (!reg) {
      // 등록된 SW 없으면 main의 SW 등록 시도 (default scope = /main/)
      try { reg = await navigator.serviceWorker.register('/main/sw.js'); } catch {}
    }
    if (reg) {
      // SW가 아직 active 아니면 ready 기다림 (iOS PWA는 처음 등록 시 시간 걸림)
      try { await navigator.serviceWorker.ready; } catch {}
    }
    return reg || null;
  }

  async function subscribe() {
    const debug = {
      sw: 'serviceWorker' in navigator,
      push: 'PushManager' in window,
      notif: 'Notification' in window,
      standalone: window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true,
      ua: navigator.userAgent.slice(0, 80)
    };
    if (!isSupported()) return { ok: false, reason: 'unsupported', debug };

    const permission = await Notification.requestPermission();
    debug.permission = permission;
    if (permission !== 'granted') return { ok: false, reason: 'denied', debug };

    const reg = await getActiveRegistration();
    debug.hasRegistration = !!reg;
    debug.hasPushManager = !!(reg && reg.pushManager);
    debug.scope = reg?.scope || null;
    if (!reg || !reg.pushManager) return { ok: false, reason: 'no_sw', debug };

    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      try {
        subscription = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
        });
      } catch (e) {
        return { ok: false, reason: 'subscribe_failed', err: String(e), debug };
      }
    }

    // 백엔드에 등록
    const accessToken = await getAccessToken();
    if (!accessToken) return { ok: false, reason: 'not_logged_in', debug };

    const sub = subscription.toJSON();
    try {
      const res = await fetch('/api/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({
          endpoint: sub.endpoint,
          keys: sub.keys,
          user_agent: navigator.userAgent
        })
      });
      if (!res.ok) return { ok: false, reason: 'server_save_failed', debug };
      try { localStorage.setItem('dino_push_enabled', '1'); } catch {}
      return { ok: true, debug };
    } catch (e) {
      return { ok: false, reason: 'network', err: String(e), debug };
    }
  }

  async function unsubscribe() {
    if (!isSupported()) return { ok: false, reason: 'unsupported' };
    const reg = await getActiveRegistration();
    if (!reg) return { ok: true };
    const subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      try { localStorage.removeItem('dino_push_enabled'); } catch {}
      return { ok: true };
    }
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe().catch(() => {});

    const accessToken = await getAccessToken();
    if (accessToken) {
      await fetch('/api/push-subscribe', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${accessToken}` },
        body: JSON.stringify({ endpoint })
      }).catch(() => {});
    }
    try { localStorage.removeItem('dino_push_enabled'); } catch {}
    return { ok: true };
  }

  function isEnabled() {
    try { return localStorage.getItem('dino_push_enabled') === '1'; } catch { return false; }
  }

  return { isSupported, getStatus, subscribe, unsubscribe, isEnabled };
})();
