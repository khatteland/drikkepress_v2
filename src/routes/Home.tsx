
import { Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function Home(){
  const [events, setEvents] = useState<any[]>([])
  useEffect(()=>{
    supabase.from('events').select('*, profiles!events_user_id_fkey(username, display_name, avatar_url)').eq('is_public', true).order('start_time',{ascending:true}).then(({data})=>setEvents(data||[]))
  },[])
  return (
    <div className="container-nice py-8">
      <h1 className="text-3xl font-semibold text-ink mb-4">Discover events</h1>
      <div className="grid md:grid-cols-2 gap-6">
        {events.map(ev=> <Link key={ev.id} to={`/${ev.profiles?.username}/${ev.slug}`} className="card overflow-hidden hover:-translate-y-0.5 transition">
          <img src={ev.cover_url || '/brand/drikke.png'} className="w-full h-56 object-cover"/>
          <div className="p-4">
            <div className="text-ink/60 text-sm">{new Date(ev.start_time).toLocaleString()}</div>
            <div className="text-xl font-semibold">{ev.title}</div>
            <div className="text-ink/70">{ev.location}</div>
          </div>
        </Link>)}
      </div>
    </div>
  )
}
