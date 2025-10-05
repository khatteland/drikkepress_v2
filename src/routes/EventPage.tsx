
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useUser } from '@/store/user'
import { googleCalendarUrl, icsFile } from '@/utils/calendar'
import { googleMapsUrl, appleMapsUrl } from '@/utils/maps'
import { t } from '@/lib/i18n'

export default function EventPage(){
  const { username, eventSlug } = useParams()
  const [event, setEvent] = useState<any|null>(null)
  const [host, setHost] = useState<any|null>(null)
  const [comments, setComments] = useState<any[]>([])
  const [participants, setParticipants] = useState<any[]>([])
  const { session } = useUser()

  useEffect(()=>{
    ;(async ()=>{
      const { data: user } = await supabase.from('profiles').select('*').eq('username', username).single()
      setHost(user)
      if(user){
        const { data: ev } = await supabase.from('events').select('*').eq('user_id', user.id).eq('slug', eventSlug).single()
        setEvent(ev||null)
        if(ev){
          supabase.from('comments').select('*, profiles!comments_user_id_fkey(username, avatar_url)').eq('event_id', ev.id).order('created_at',{ascending:true}).then(({data})=>setComments(data||[]))
          supabase.from('participants').select('*, profiles!participants_user_id_fkey(username, avatar_url, display_name)').eq('event_id', ev.id).then(({data})=>setParticipants(data||[]))
        }
      }
    })()
  },[username, eventSlug])

  const gcal = useMemo(()=> event? googleCalendarUrl({
    title: event.title, details: event.description, location: event.location,
    start: new Date(event.start_time), end: new Date(event.end_time || event.start_time)
  }): '#', [event])

  function downloadICS(){
    if(!event) return
    const blob = new Blob([icsFile({
      title: event.title, description: event.description, location: event.location,
      start: new Date(event.start_time), end: new Date(event.end_time || event.start_time)
    })], {type:'text/calendar;charset=utf-8'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${event.slug}.ics`; a.click()
    URL.revokeObjectURL(url)
  }

  async function setStatus(status:'going'|'interested'|'cant'){
    if(!session || !event) return alert('Sign in to set status')
    await supabase.from('participants').upsert({ event_id: event.id, user_id: session.user.id, status })
    const { data } = await supabase.from('participants').select('*, profiles!participants_user_id_fkey(username, avatar_url, display_name)').eq('event_id', event.id)
    setParticipants(data||[])
  }

  async function sendComment(e:any){
    e.preventDefault()
    if(!session || !event) return alert('Sign in to comment')
    const content = e.target.content.value.trim()
    if(!content) return
    await supabase.from('comments').insert({ event_id: event.id, user_id: session.user.id, content })
    e.target.reset()
    const { data } = await supabase.from('comments').select('*, profiles!comments_user_id_fkey(username, avatar_url)').eq('event_id', event.id).order('created_at',{ascending:true})
    setComments(data||[])
  }

  if(!event) return <div className="container-nice py-8">Loading event...</div>

  return (
    <div>
      <div className="h-64 md:h-96 w-full">
        <img src={event.cover_url || '/brand/drikke.png'} className="w-full h-full object-cover" />
      </div>
      <div className="container-nice -mt-10 relative z-10">
        <div className="card p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div>
              <div className="text-ink/60">{new Date(event.start_time).toLocaleString()}</div>
              <h1 className="text-3xl font-semibold">{event.title}</h1>
              <div className="text-ink/80">{event.location}</div>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-primary" onClick={()=>setStatus('going')}>{t('participation.going')}</button>
              <button className="btn" onClick={()=>setStatus('interested')}>{t('participation.interested')}</button>
              <button className="btn" onClick={()=>setStatus('cant')}>{t('participation.cant')}</button>
              <a className="btn" href={gcal} target="_blank">{t('events.addToCalendar')}</a>
              <button className="btn" onClick={downloadICS}>Apple Calendar</button>
              <a className="btn" href={googleMapsUrl(event.location)} target="_blank">Google Maps</a>
              <a className="btn" href={appleMapsUrl(event.location)} target="_blank">Apple Maps</a>
            </div>
          </div>
          <p className="mt-4 whitespace-pre-wrap">{event.description}</p>
          {(event.participants_public || (session?.user?.id===host?.id)) && (<div className="mt-6 border-t pt-4">
            <h3 className="font-semibold mb-2">Participants</h3>
            <div className="flex flex-wrap gap-3">
              {participants.map(p=>(
                <div key={p.id} className="px-3 py-1 rounded-full bg-ink/5 text-ink/80 text-sm">
                  {p.profiles?.display_name || p.profiles?.username} — {p.status}
                </div>
              ))}
            </div>
          </div>)}
          <div className="mt-6 border-t pt-4">
            <h3 className="font-semibold mb-2">Comments</h3>
            <form onSubmit={sendComment} className="flex gap-2">
              <input name="content" className="input" placeholder="Write a comment..." />
              <button className="btn btn-primary">Send</button>
            </form>
            <div className="mt-4 space-y-3">
              {comments.map(c=>(
                <div key={c.id} className="flex gap-3">
                  <img src={c.profiles?.avatar_url || '/brand/drikke.png'} className="h-8 w-8 rounded-full object-cover"/>
                  <div>
                    <div className="text-sm text-ink/60">{c.profiles?.username} • {new Date(c.created_at).toLocaleString()}</div>
                    <div>{c.content}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
