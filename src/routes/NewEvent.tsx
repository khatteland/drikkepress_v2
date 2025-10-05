
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { sluggify } from '@/utils/slug'
import { supabase } from '@/lib/supabase'
import { useNavigate } from 'react-router-dom'
import { useUser } from '@/store/user'
import { t } from '@/lib/i18n'

const schema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  start_time: z.string(),
  end_time: z.string().optional(),
  location: z.string().min(2),
  is_public: z.boolean().default(true),
  participants_public: z.boolean().default(true),
  slug: z.string().optional()
})

export default function NewEvent(){
  const { profile } = useUser()
  const nav = useNavigate()
  const { register, handleSubmit, watch, setValue } = useForm({ resolver: zodResolver(schema) })
  const title = watch('title') as string || ''
  const slug = sluggify(title)
  return (
    <div className="container-nice py-8 max-w-3xl">
      <h1 className="text-3xl font-semibold mb-6">New event</h1>
      <form className="card p-6 space-y-4" onSubmit={handleSubmit(async (values:any)=>{
        const { data: ev, error } = await supabase.from('events').insert({
          user_id: profile?.id,
          title: values.title,
          slug: values.slug || sluggify(values.title),
          description: values.description,
          start_time: new Date(values.start_time).toISOString(),
          end_time: values.end_time ? new Date(values.end_time).toISOString() : null,
          location: values.location,
          is_public: values.is_public,
          participants_public: values.participants_public
        }).select().single()
        if(error) { alert(error.message); return }
        nav(`/e/${ev.id}/edit`)
      })}>
        <div>
          <label className="label">Title</label>
          <input className="input" {...register('title')} placeholder="Margarita Monday" onChange={e=>setValue('slug', sluggify(e.target.value))}/>
          <div className="text-xs text-ink/50 mt-1">URL: /{profile?.username}/{slug}</div>
        </div>
        <div>
          <label className="label">Description</label>
          <textarea className="input h-32" {...register('description')} />
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div><label className="label">Start</label><input type="datetime-local" className="input" {...register('start_time')} /></div>
          <div><label className="label">End</label><input type="datetime-local" className="input" {...register('end_time')} /></div>
        </div>
        <div><label className="label">Location</label><input className="input" {...register('location')}/></div>
        <div className="flex items-center gap-2">
          <input type="checkbox" {...register('participants_public')} defaultChecked />
          <span>{t('events.publicParticipants')}</span>
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" {...register('is_public')} defaultChecked />
          <span>Public</span>
        </div>
        <button className="btn btn-primary">Save & add images</button>
      </form>
    </div>
  )
}
