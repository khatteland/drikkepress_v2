
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useUser } from '@/store/user'
import { t } from '@/lib/i18n'
import { Link } from 'react-router-dom'

export default function MyProfile(){
  const { session, profile, refreshProfile } = useUser()
  const [fullName, setFullName] = useState(profile?.display_name || '')
  const [phone, setPhone] = useState('')
  const [avatar, setAvatar] = useState(profile?.avatar_url || '')
  const [myEvents, setMyEvents] = useState<any[]>([])

  useEffect(()=>{
    (async()=>{
      await refreshProfile()
      const { data: p } = await supabase.from('profiles').select('*').eq('id', session?.user?.id).single()
      if(p){
        setFullName(p.display_name || '')
        setAvatar(p.avatar_url || '')
        // @ts-ignore
        if(p.phone) setPhone(p.phone)
      }
      const { data: ev } = await supabase.from('events').select('*').eq('user_id', session?.user?.id).order('start_time',{ascending:false})
      setMyEvents(ev||[])
    })()
  },[session?.user?.id])

  async function uploadAvatar(file: File){
    if(!session) return
    const path = `avatars/${session.user.id}_${Date.now()}_${file.name}`
    const { error } = await supabase.storage.from(import.meta.env.VITE_STORAGE_BUCKET).upload(path, file)
    if(error){ alert(error.message); return }
    const { data: { publicUrl } } = supabase.storage.from(import.meta.env.VITE_STORAGE_BUCKET).getPublicUrl(path)
    setAvatar(publicUrl)
  }

  async function saveProfile(){
    if(!session) return
    const { error } = await supabase.from('profiles').update({
      display_name: fullName, avatar_url: avatar, phone
    }).eq('id', session.user.id)
    if(error){ alert(error.message); return }
    alert(t('profile.saved'))
    await refreshProfile()
  }

  async function deleteEvent(id:string){
    if(!confirm(t('events.confirmDelete'))) return
    const { error } = await supabase.from('events').delete().eq('id', id)
    if(error){ alert(error.message); return }
    setMyEvents(prev=>prev.filter(e=>e.id!==id))
  }

  return (
    <div className="container-nice py-8">
      <h1 className="text-3xl font-semibold mb-6">{t('profile.title')}</h1>
      <div className="grid md:grid-cols-3 gap-6">
        <div className="card p-6 md:col-span-1">
          <div className="flex flex-col items-center gap-3">
            <img src={avatar || '/brand/drikke.png'} className="h-24 w-24 rounded-full object-cover"/>
            <label className="btn">
              {t('profile.upload')}
              <input type="file" className="hidden" accept="image/*" onChange={e=>e.target.files && uploadAvatar(e.target.files[0])}/>
            </label>
          </div>
          <div className="mt-4 space-y-3">
            <div>
              <label className="label">{t('profile.name')}</label>
              <input className="input" value={fullName} onChange={e=>setFullName(e.target.value)} />
            </div>
            <div>
              <label className="label">{t('profile.phone')}</label>
              <input className="input" value={phone} onChange={e=>setPhone(e.target.value)} />
            </div>
            <button className="btn btn-primary w-full mt-2" onClick={saveProfile}>{t('profile.save')}</button>
          </div>
        </div>
        <div className="md:col-span-2 card p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">{t('events.myEvents')}</h2>
            <Link to="/new" className="btn">{t('nav.createEvent')}</Link>
          </div>
          <div className="mt-4 divide-y">
            {myEvents.map(ev=>(
              <div key={ev.id} className="py-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div className="flex items-center gap-3">
                  <img src={ev.cover_url || '/brand/drikke.png'} className="h-16 w-24 object-cover rounded-lg"/>
                  <div>
                    <div className="font-medium">{ev.title}</div>
                    <div className="text-sm text-ink/60">{new Date(ev.start_time).toLocaleString()} • {ev.location}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Link to={`/e/${ev.id}/edit`} className="btn">{t('events.edit')}</Link>
                  <button className="btn" onClick={()=>deleteEvent(ev.id)}>{t('events.delete')}</button>
                  <Link to={`/${profile?.username}/${ev.slug}`} className="btn">{t('events.open')}</Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
