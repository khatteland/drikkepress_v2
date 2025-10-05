
import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { sluggify } from '@/utils/slug'
import { useUser } from '@/store/user'

export default function EditEvent(){
  const { id } = useParams()
  const nav = useNavigate()
  const { profile } = useUser()
  const [ev,setEv] = useState<any|null>(null)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [location, setLocation] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [participantsPublic, setParticipantsPublic] = useState(true)
  const [cover, setCover] = useState('')

  useEffect(()=>{
    supabase.from('events').select('*').eq('id', id).single().then(({data})=>{
      if(!data) return
      setEv(data)
      setTitle(data.title||'')
      setDesc(data.description||'')
      setStart(data.start_time?.slice(0,16)||'')
      setEnd(data.end_time?.slice(0,16)||'')
      setLocation(data.location||'')
      setIsPublic(!!data.is_public)
      setParticipantsPublic(data.participants_public ?? true)
      setCover(data.cover_url||'')
    })
  },[id])

  async function uploadCover(file: File){
    if(!ev) return
    const path = `user_${profile?.id}/events/${ev.id}/cover_${Date.now()}_${file.name}`
    const { error } = await supabase.storage.from(import.meta.env.VITE_STORAGE_BUCKET).upload(path, file)
    if(error){ alert(error.message); return }
    const { data: { publicUrl } } = supabase.storage.from(import.meta.env.VITE_STORAGE_BUCKET).getPublicUrl(path)
    setCover(publicUrl)
  }

  async function save(){
    if(!ev) return
    const { error } = await supabase.from('events').update({
      title, description: desc, start_time: new Date(start).toISOString(),
      end_time: end?new Date(end).toISOString():null, location, is_public: isPublic,
      participants_public: participantsPublic,
      slug: sluggify(title), cover_url: cover, updated_at: new Date().toISOString()
    }).eq('id', ev.id)
    if(error){ alert(error.message); return }
    nav(`/${profile?.username}/${sluggify(title)}`)
  }

  if(!ev) return <div className="container-nice py-8">Loading...</div>

  return (
    <div className="container-nice py-8 max-w-3xl">
      <h1 className="text-3xl font-semibold mb-6">Edit: {ev.title}</h1>
      <div className="card p-6 space-y-4">
        <div>
          <label className="label">Title</label>
          <input className="input" value={title} onChange={e=>setTitle(e.target.value)} />
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input h-32" value={desc} onChange={e=>setDesc(e.target.value)} />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div><label className="label">Start</label><input type="datetime-local" className="input" value={start} onChange={e=>setStart(e.target.value)} /></div>
          <div><label className="label">End</label><input type="datetime-local" className="input" value={end} onChange={e=>setEnd(e.target.value)} /></div>
        </div>
        <div><label className="label">Location</label><input className="input" value={location} onChange={e=>setLocation(e.target.value)} /></div>
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={participantsPublic} onChange={e=>setParticipantsPublic(e.target.checked)} />
          <span>Show participants publicly</span>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" checked={isPublic} onChange={e=>setIsPublic(e.target.checked)} />
          <span>Public</span>
        </div>
        <div>
          <label className="label">Cover image</label>
          <input type="file" accept="image/*" onChange={e=>e.target.files && uploadCover(e.target.files[0])} />
          {cover && <img src={cover} className="mt-3 h-48 rounded-xl object-cover" />}
        </div>
        <div className="flex gap-3">
          <button className="btn btn-primary" onClick={save}>Save</button>
          <Link className="btn" to={`/${profile?.username}/${sluggify(title)}`}>View</Link>
        </div>
      </div>
    </div>
  )
}
