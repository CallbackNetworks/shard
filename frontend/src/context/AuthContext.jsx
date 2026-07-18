import { createContext, useContext, useState, useEffect } from 'react'
import axios from 'axios'

const AuthContext = createContext(null)

const TOKEN_KEY = 'auth_token'

export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [authRequired, setAuthRequired] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem(TOKEN_KEY)
    axios.get('/api/auth/me', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }).then(res => {
      if (!res.data.auth_required) {
        // Server has no password set — always authenticated
        setAuthRequired(false)
        setIsAuthenticated(true)
      } else {
        setAuthRequired(true)
        setIsAuthenticated(!!token && res.data.ok)
      }
    }).catch(() => {
      setAuthRequired(true)
      setIsAuthenticated(false)
    }).finally(() => {
      setIsLoading(false)
    })
  }, [])

  const login = async (password) => {
    const res = await axios.post('/api/auth/login', { password })
    const { token, auth_required } = res.data
    localStorage.setItem(TOKEN_KEY, token)
    setAuthRequired(auth_required)
    setIsAuthenticated(true)
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    setIsAuthenticated(false)
    window.location.href = '/login'
  }

  return (
    <AuthContext.Provider value={{ isAuthenticated, authRequired, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
