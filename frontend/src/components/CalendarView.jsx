import React, { useState, useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { DARK, BRAND } from '../constants/theme'

const PRIORITY_COLORS = {
  high: '#facc15',
  medium: '#ffa42b',
  low: '#facc15',
}

const GRID_BORDER = 'rgba(255,255,255,0.06)'
const DIMMED_TEXT = 'rgba(255,255,255,0.15)'

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfWeek(year, month) {
  return new Date(year, month, 1).getDay()
}

function isSameDay(d1, d2) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}

function formatDateISO(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}T00:00:00`
}

export default function CalendarView({ tasks, onUpdateTask, projectId: _projectId }) {
  const { t } = useTranslation()
  const today = new Date()
  const [currentYear, setCurrentYear] = useState(today.getFullYear())
  const [currentMonth, setCurrentMonth] = useState(today.getMonth())

  const dayKeys = useMemo(
    () => ['cal.sun', 'cal.mon', 'cal.tue', 'cal.wed', 'cal.thu', 'cal.fri', 'cal.sat'],
    [],
  )

  const goToPrevMonth = useCallback(() => {
    setCurrentMonth((prev) => {
      if (prev === 0) {
        setCurrentYear((y) => y - 1)
        return 11
      }
      return prev - 1
    })
  }, [])

  const goToNextMonth = useCallback(() => {
    setCurrentMonth((prev) => {
      if (prev === 11) {
        setCurrentYear((y) => y + 1)
        return 0
      }
      return prev + 1
    })
  }, [])

  // Build a map of date string -> tasks for quick lookup
  const tasksByDate = useMemo(() => {
    const map = {}
    if (!tasks) return map
    for (const task of tasks) {
      if (!task.due_date) continue
      const d = new Date(task.due_date)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      if (!map[key]) map[key] = []
      map[key].push(task)
    }
    return map
  }, [tasks])

  // Build calendar grid cells
  const calendarCells = useMemo(() => {
    const daysInMonth = getDaysInMonth(currentYear, currentMonth)
    const firstDay = getFirstDayOfWeek(currentYear, currentMonth)

    // Previous month fill
    const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1
    const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear
    const daysInPrevMonth = getDaysInMonth(prevYear, prevMonth)

    const cells = []

    // Fill leading days from previous month
    for (let i = firstDay - 1; i >= 0; i--) {
      const day = daysInPrevMonth - i
      cells.push({
        date: new Date(prevYear, prevMonth, day),
        day,
        isCurrentMonth: false,
      })
    }

    // Current month days
    for (let day = 1; day <= daysInMonth; day++) {
      cells.push({
        date: new Date(currentYear, currentMonth, day),
        day,
        isCurrentMonth: true,
      })
    }

    // Fill trailing days from next month
    const nextMonth = currentMonth === 11 ? 0 : currentMonth + 1
    const nextYear = currentMonth === 11 ? currentYear + 1 : currentYear
    const remaining = 7 - (cells.length % 7)
    if (remaining < 7) {
      for (let day = 1; day <= remaining; day++) {
        cells.push({
          date: new Date(nextYear, nextMonth, day),
          day,
          isCurrentMonth: false,
        })
      }
    }

    return cells
  }, [currentYear, currentMonth])

  const handleDragStart = useCallback((e, taskId) => {
    e.dataTransfer.setData('text/plain', String(taskId))
    e.dataTransfer.effectAllowed = 'move'
  }, [])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
  }, [])

  const handleDrop = useCallback(
    (e, targetDate) => {
      e.preventDefault()
      const taskId = parseInt(e.dataTransfer.getData('text/plain'), 10)
      if (!taskId || isNaN(taskId)) return
      onUpdateTask(taskId, { due_date: formatDateISO(targetDate) })
    },
    [onUpdateTask],
  )

  const handleTaskClick = useCallback(
    (taskId) => {
      onUpdateTask(taskId, {})
    },
    [onUpdateTask],
  )

  const monthNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ]

  const rows = []
  for (let i = 0; i < calendarCells.length; i += 7) {
    rows.push(calendarCells.slice(i, i + 7))
  }

  return (
    <div style={{ width: '100%' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          padding: '0 4px',
        }}
      >
        <button
          onClick={goToPrevMonth}
          style={{
            background: 'none',
            border: 'none',
            color: DARK.text,
            cursor: 'pointer',
            padding: 6,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
          }}
          aria-label="Previous month"
        >
          <ChevronLeft size={20} />
        </button>

        <span
          style={{
            color: DARK.text,
            fontSize: 16,
            fontWeight: 600,
          }}
        >
          {monthNames[currentMonth]} {currentYear}
        </span>

        <button
          onClick={goToNextMonth}
          style={{
            background: 'none',
            border: 'none',
            color: DARK.text,
            cursor: 'pointer',
            padding: 6,
            borderRadius: 4,
            display: 'flex',
            alignItems: 'center',
          }}
          aria-label="Next month"
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Calendar grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          border: `1px solid ${GRID_BORDER}`,
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {/* Day header row */}
        {dayKeys.map((key) => (
          <div
            key={key}
            style={{
              padding: '8px 4px',
              textAlign: 'center',
              fontSize: 11,
              fontWeight: 600,
              color: DARK.textMid,
              borderBottom: `1px solid ${GRID_BORDER}`,
              background: DARK.surface,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {t(key)}
          </div>
        ))}

        {/* Day cells */}
        {calendarCells.map((cell, idx) => {
          const dateKey = `${cell.date.getFullYear()}-${cell.date.getMonth()}-${cell.date.getDate()}`
          const dayTasks = tasksByDate[dateKey] || []
          const isToday = isSameDay(cell.date, today)

          return (
            <div
              key={idx}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, cell.date)}
              style={{
                minHeight: 90,
                padding: 6,
                borderRight: (idx + 1) % 7 !== 0 ? `1px solid ${GRID_BORDER}` : 'none',
                borderBottom:
                  idx < calendarCells.length - 7 ? `1px solid ${GRID_BORDER}` : 'none',
                background: isToday ? 'rgba(250,204,21,0.04)' : 'transparent',
                border: isToday ? `2px solid ${BRAND}` : undefined,
                boxSizing: 'border-box',
              }}
            >
              {/* Day number */}
              <div
                style={{
                  fontSize: 12,
                  fontWeight: isToday ? 700 : 400,
                  color: cell.isCurrentMonth ? DARK.textMid : DIMMED_TEXT,
                  marginBottom: 4,
                }}
              >
                {cell.day}
              </div>

              {/* Tasks */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {dayTasks.map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, task.id)}
                    onClick={() => handleTaskClick(task.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '2px 4px',
                      borderRadius: 4,
                      cursor: 'grab',
                      fontSize: 11,
                      color: DARK.text,
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                      textOverflow: 'ellipsis',
                    }}
                    title={task.title}
                  >
                    <span
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        backgroundColor:
                          PRIORITY_COLORS[task.priority] || PRIORITY_COLORS.low,
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {task.title}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
