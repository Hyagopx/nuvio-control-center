import { NextRequest, NextResponse } from 'next/server'

function baseUrl(raw:string){
  const u=new URL(raw); u.pathname=u.pathname.replace(/\/+$/,'').replace(/\/manifest\.json$/i,''); return u.toString()
}
function hasMeta(manifest:any){ return Array.isArray(manifest?.resources) && manifest.resources.some((r:any)=>String(r)==='meta' || String(r?.name||'')==='meta') }
async function getJson(url:string){
  try{const r=await fetch(url,{cache:'no-store',redirect:'follow',headers:{Accept:'application/json'},signal:AbortSignal.timeout(7000)}); if(!r.ok)return null; return await r.json().catch(()=>null)}catch{return null}
}
export async function POST(req:NextRequest){
  try{
    const {addons,items}=await req.json();
    if(!Array.isArray(addons)||!Array.isArray(items))return NextResponse.json({error:'addons e items são obrigatórios.'},{status:400})
    const usable:any[]=[]
    for(const addon of addons.slice(0,12)){
      if(!addon?.url)continue
      const manifest=await getJson(`${baseUrl(addon.url)}/manifest.json`)
      if(manifest && hasMeta(manifest)) usable.push({base:baseUrl(addon.url),name:manifest.name||addon.name||addon.url})
    }
    const resolved:any[]=[]
    for(const item of items.slice(0,80)){
      const id=String(item?.contentId||item?.content_id||item?.id||'').trim()
      if(!id)continue
      const type=String(item?.type||item?.contentType||item?.media_type||'').toLowerCase().includes('series')?'series':'movie'
      for(const addon of usable){
        const meta=await getJson(`${addon.base}/meta/${type}/${encodeURIComponent(id)}.json`)
        const m=meta?.meta || meta
        if(m && (m.name||m.title)){
          resolved.push({key:item.key||id,title:m.name||m.title,poster:m.poster||null,background:m.background||m.backdrop||null,description:m.description||null,year:m.year||null,seriesName:m.name||m.title,source:addon.name})
          break
        }
      }
    }
    return NextResponse.json({resolved})
  }catch(e:any){return NextResponse.json({error:e?.message||'Falha ao resolver títulos.'},{status:502})}
}
