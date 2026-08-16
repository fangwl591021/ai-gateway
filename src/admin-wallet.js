import { getWallet, listWalletLedger, topupWallet } from './wallet.js';

function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}})}
async function adminAuthorized(request,env){const supplied=request.headers.get('x-admin-key')||'';if(!env.ADMIN_API_KEY||!supplied)return false;const enc=new TextEncoder();const a=enc.encode(supplied),b=enc.encode(env.ADMIN_API_KEY);if(a.byteLength!==b.byteLength)return false;return crypto.subtle.timingSafeEqual(a,b)}
async function parseJson(request){try{return await request.json()}catch{return null}}

export async function handleWalletAdmin(request,env,url){
  if(!url.pathname.includes('/wallet'))return null;
  if(!(await adminAuthorized(request,env)))return json({error:'admin_unauthorized'},401);
  const match=url.pathname.match(/^\/admin\/tenants\/([^/]+)\/wallet(?:\/topup)?$/);
  if(!match)return null;
  const tenantId=decodeURIComponent(match[1]);
  const tenant=await env.DB.prepare(`SELECT id,name,billing_mode,status FROM tenants WHERE id=?1 LIMIT 1`).bind(tenantId).first();
  if(!tenant)return json({error:'tenant_not_found'},404);
  if(request.method==='GET'&&!url.pathname.endsWith('/topup')){
    const wallet=await getWallet(env,tenantId);const ledger=await listWalletLedger(env,tenantId,Number(url.searchParams.get('limit')||100));return json({tenant,wallet,ledger});
  }
  if(request.method==='POST'&&url.pathname.endsWith('/topup')){
    const body=await parseJson(request);const amount=Number(body?.amount_twd);if(!Number.isFinite(amount)||amount<=0)return json({error:'invalid_topup_amount'},400);
    try{const result=await topupWallet(env,{tenantId,amountTwd:amount,note:body?.note||null,referenceId:body?.reference_id||null});return json({tenant_id:tenantId,amount_twd:amount,...result},201)}catch(error){return json({error:error?.code||'wallet_topup_failed'},409)}
  }
  return json({error:'method_not_allowed'},405);
}
