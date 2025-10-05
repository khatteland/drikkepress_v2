
import { Link } from 'react-router-dom'
import { useUser } from '@/store/user'
import { t } from '@/lib/i18n'

export default function Layout({children}:{children:React.ReactNode}){
  const { session, profile, signOut, signIn } = useUser()
  return (
    <div>
      <header className="border-b border-ink/10 bg-white">
        <div className="container-nice py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-3">
            <img src="/brand/drikke.png" alt="drikkepress" className="h-10 rounded-xl" />
            <span className="font-semibold text-xl text-ink">drikkepress</span>
          </Link>
          <nav className="flex items-center gap-3">
            <Link to="/new" className="btn btn-secondary">{t('nav.createEvent')}</Link>
            {!session ? (
              <div className="flex gap-2">
                <button className="btn btn-primary" onClick={()=>signIn('google')}>{t('nav.loginGoogle')}</button>
                <button className="btn" onClick={()=>signIn('azure')}>{t('nav.loginMicrosoft')}</button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Link to={`/profile`} className="text-ink/80">{t('nav.myProfile')}</Link>
                <button className="btn" onClick={signOut}>{t('nav.logout')}</button>
              </div>
            )}
          </nav>
        </div>
      </header>
      <main>{children}</main>
      <footer className="container-nice py-10 text-ink/50 text-sm">© {new Date().getFullYear()} drikkepress</footer>
    </div>
  )
}
