
import { create } from 'zustand'
import { supabase } from '@/lib/supabase'

type State = {
  session: any | null
  profile: any | null
  loading: boolean
  signIn: (provider:'google'|'azure'|'email', email?:string, password?:string)=>Promise<void>
  signOut: ()=>Promise<void>
  refreshProfile: ()=>Promise<void>
}

export const useUser = create<State>((set,get)=>({ 
  session: null,
  profile: null,
  loading: true,
  async signIn(provider, email, password){
    if(provider==='google'){
      await supabase.auth.signInWithOAuth({ provider: 'google', options:{redirectTo: import.meta.env.VITE_SITE_URL + '/auth/callback'} })
    } else if(provider==='azure'){
      await supabase.auth.signInWithOAuth({ provider: 'azure', options:{redirectTo: import.meta.env.VITE_SITE_URL + '/auth/callback'} })
    } else {
      if(!email||!password) throw new Error('Email/password required')
      await supabase.auth.signInWithPassword({ email, password })
    }
  },
  async signOut(){
    await supabase.auth.signOut()
    set({session:null, profile:null})
  },
  async refreshProfile(){
    const { data: { session } } = await supabase.auth.getSession()
    set({ session })
    if(session?.user?.id){
      const { data } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      set({ profile: data ?? null })
    }
    set({ loading:false })
  }
}))
