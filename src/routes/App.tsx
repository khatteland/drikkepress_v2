
import { useEffect } from 'react'
import { Route, Routes, useLocation, Navigate } from 'react-router-dom'
import Home from './Home'
import NewEvent from './NewEvent'
import EditEvent from './EditEvent'
import EventPage from './EventPage'
import MyProfile from './MyProfile'
import AuthCallback from './AuthCallback'
import Layout from '@/ui/Layout'
import { useUser } from '@/store/user'

export default function App(){
  const { refreshProfile } = useUser()
  const loc = useLocation()
  useEffect(()=>{ refreshProfile() },[])
  useEffect(()=>{ window.scrollTo(0,0) },[loc])
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home/>} />
        <Route path="/auth/callback" element={<AuthCallback/>} />
        <Route path="/new" element={<RequireAuth><NewEvent/></RequireAuth>} />
        <Route path="/e/:id/edit" element={<RequireAuth><EditEvent/></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth><MyProfile/></RequireAuth>} />
        <Route path="/:username/:eventSlug" element={<EventPage/>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

function RequireAuth({children}:{children:React.ReactNode}){
  const { session, loading } = useUser()
  if(loading) return <div className="container-nice py-10">Loading...</div>
  if(!session) return <Navigate to="/" replace />
  return <>{children}</>
}
