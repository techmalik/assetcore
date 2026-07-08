import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { useAuth } from './AuthContext'
import { countUnread, listNotifications, markRead as doMarkRead, markAllRead as doMarkAllRead } from './db/notifications'

const NotifCtx = createContext(null)
const POLL_MS = 30_000

export function NotificationsProvider({ children }) {
  const { authed, user } = useAuth()
  const [unreadCount, setUnreadCount] = useState(0)
  const [notifications, setNotifications] = useState([])

  const refresh = useCallback(async () => {
    if (!authed) return
    try {
      const [count, items] = await Promise.all([countUnread(), listNotifications()])
      setUnreadCount(count)
      setNotifications(items)
    } catch {
      // non-fatal — tables may not exist yet in local dev
    }
  }, [authed])

  useEffect(() => {
    if (!authed || !user?.id) {
      setUnreadCount(0)
      setNotifications([])
      return
    }
    refresh()
    const interval = setInterval(refresh, POLL_MS)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(interval)
      window.removeEventListener('focus', onFocus)
    }
  }, [authed, user?.id, refresh])

  const markRead = useCallback(async (id) => {
    try {
      await doMarkRead(id)
      setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: true } : n))
      setUnreadCount(prev => Math.max(0, prev - 1))
    } catch { /* ignore */ }
  }, [])

  const markAllRead = useCallback(async () => {
    try {
      await doMarkAllRead()
      setNotifications(prev => prev.map(n => ({ ...n, read: true })))
      setUnreadCount(0)
    } catch { /* ignore */ }
  }, [])

  return (
    <NotifCtx.Provider value={{ unreadCount, notifications, refresh, markRead, markAllRead }}>
      {children}
    </NotifCtx.Provider>
  )
}

export function useNotifications() {
  const ctx = useContext(NotifCtx)
  if (!ctx) throw new Error('useNotifications must be used within NotificationsProvider')
  return ctx
}
