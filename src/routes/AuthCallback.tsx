
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser } from '@/store/user'

export default function AuthCallback(){
  const nav = useNavigate()
  const { refreshProfile } = useUser()
  useEffect(()=>{ (async()=>{ await refreshProfile(); nav('/') })() },[])
  return <div className="container-nice py-8">Signing in...</div>
}
