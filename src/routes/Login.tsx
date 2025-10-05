import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useNavigate } from 'react-router-dom'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignup, setIsSignup] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleEmailAuth(e: any) {
    e.preventDefault()
    setLoading(true)

    if (isSignup) {
      // ✳️ Create account
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) alert(error.message)
      else alert('Account created! Please check your email to confirm.')
    } else {
      // 🔑 Login
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) alert(error.message)
      else navigate('/')
    }

    setLoading(false)
  }

  async function handleGoogleLogin() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    })
    if (error) alert(error.message)
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
      <div className="bg-white shadow-lg rounded-2xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-semibold text-center mb-4">
          {isSignup ? 'Create an Account' : 'Sign In'}
        </h1>

        <form onSubmit={handleEmailAuth} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="input w-full"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="input w-full"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary w-full"
          >
            {loading ? 'Please wait...' : isSignup ? 'Sign up' : 'Sign in'}
          </button>
        </form>

        <div className="text-center my-4 text-gray-500">or</div>

        <button
          onClick={handleGoogleLogin}
          className="btn bg-red-500 text-white w-full"
        >
          Continue with Google
        </button>

        <p className="text-center mt-4 text-sm text-gray-600">
          {isSignup ? (
            <>
              Already have an account?{' '}
              <button
                onClick={() => setIsSignup(false)}
                className="text-blue-500 underline"
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              Don’t have an account?{' '}
              <button
                onClick={() => setIsSignup(true)}
                className="text-blue-500 underline"
              >
                Create one
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import { useNavigate } from 'react-router-dom'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isSignup, setIsSignup] = useState(false)
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleEmailAuth(e: any) {
    e.preventDefault()
    setLoading(true)

    if (isSignup) {
      // ✳️ Create account
      const { error } = await supabase.auth.signUp({ email, password })
      if (error) alert(error.message)
      else alert('Account created! Please check your email to confirm.')
    } else {
      // 🔑 Login
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) alert(error.message)
      else navigate('/')
    }

    setLoading(false)
  }

  async function handleGoogleLogin() {
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    })
    if (error) alert(error.message)
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50">
      <div className="bg-white shadow-lg rounded-2xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-semibold text-center mb-4">
          {isSignup ? 'Create an Account' : 'Sign In'}
        </h1>

        <form onSubmit={handleEmailAuth} className="space-y-4">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="input w-full"
            required
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Password"
            className="input w-full"
            required
          />
          <button
            type="submit"
            disabled={loading}
            className="btn btn-primary w-full"
          >
            {loading ? 'Please wait...' : isSignup ? 'Sign up' : 'Sign in'}
          </button>
        </form>

        <div className="text-center my-4 text-gray-500">or</div>

        <button
          onClick={handleGoogleLogin}
          className="btn bg-red-500 text-white w-full"
        >
          Continue with Google
        </button>

        <p className="text-center mt-4 text-sm text-gray-600">
          {isSignup ? (
            <>
              Already have an account?{' '}
              <button
                onClick={() => setIsSignup(false)}
                className="text-blue-500 underline"
              >
                Sign in
              </button>
            </>
          ) : (
            <>
              Don’t have an account?{' '}
              <button
                onClick={() => setIsSignup(true)}
                className="text-blue-500 underline"
              >
                Create one
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  )
}