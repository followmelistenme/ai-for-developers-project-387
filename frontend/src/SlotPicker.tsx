import { useCallback, useEffect, useRef, useState } from "react"
import { CalendarDays, RefreshCw } from "lucide-react"
import { MeetingConfirmation, type Meeting } from "@/MeetingDetails"
import { confirmMeeting, listAvailableSlots } from "@/api/generated/sdk.gen"
import type { AvailableSlot, AvailableSlots, ConfirmMeeting } from "@/api/generated/types.gen"
import { Button } from "@/components/ui/button"

type Availability = AvailableSlots
type Slot = AvailableSlot
type Attempt = { meetingTypeId: string, body: ConfirmMeeting }
type View = { data?: Availability, loading: boolean, failed: boolean, missing: boolean, deadline?: number }

function timeLabel(instant: string, timeZone: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(instant))
}

function dateLabel(date: string) {
  const [year, month, day] = date.split("-")
  return `${day}.${month}.${year}`
}

export function SlotPicker({ meetingTypeId }: { meetingTypeId: string }) {
  const [query, setQuery] = useState<{ date?: string, revision: number }>({ revision: 0 })
  const [view, setView] = useState<View>({ loading: true, failed: false, missing: false })
  const [selected, setSelected] = useState<Slot | null>(null)
  const [guestName, setGuestName] = useState("")
  const [guestEmail, setGuestEmail] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [unknown, setUnknown] = useState(false)
  const [closed, setClosed] = useState(false)
  const [confirmed, setConfirmed] = useState<Meeting | null>(null)
  const [message, setMessage] = useState("")
  const [fields, setFields] = useState<Record<string, string>>({})
  // A pending request can already have saved the meeting. Refresh never changes its state.
  const locked = useRef(false)
  const inFlight = useRef(false)
  const attempt = useRef<Attempt | null>(null)
  const refresh = useCallback(() => {
    if (locked.current || closed || view.missing) return
    setSelected(null)
    setView((current) => ({ ...current, loading: true, failed: false }))
    setQuery((current) => ({ ...current, revision: current.revision + 1 }))
  }, [closed, view.missing])

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      const started = performance.now()
      try {
        const options = { path: { meetingTypeId }, query: query.date ? { date: query.date } : {}, signal: controller.signal }
        const result = await listAvailableSlots(options)
        // An unrelated availability response must not replace a pending or recoverable attempt.
        if (controller.signal.aborted || locked.current) return
        if (result.response?.status === 410) { setClosed(true); return }
        // A date can leave the live window while the page is open. Ask the server for its new first day.
        if (result.response?.status === 400 && query.date && !controller.signal.aborted) {
          setQuery((current) => ({ date: undefined, revision: current.revision + 1 }))
          return
        }
        if (controller.signal.aborted) return
        if (result.response?.status === 404) { setView({ loading: false, failed: false, missing: true }); return }
        if (!result.response?.ok || !result.data) throw new Error("Failed to load slots")
        const data = result.data
        // Use server time and elapsed request time; the browser clock may be wrong.
        const deadline = started + Date.parse(data.nextWindowUpdate) - Date.parse(data.serverTime)
        setView({ data, loading: false, failed: false, missing: false, deadline })
      } catch {
        if (!controller.signal.aborted && !locked.current) setView((current) => ({ ...current, loading: false, failed: true }))
      }
    }
    void load()
    return () => controller.abort()
  }, [meetingTypeId, query])

  useEffect(() => {
    window.addEventListener("focus", refresh)
    function visible() { if (document.visibilityState === "visible") refresh() }
    document.addEventListener("visibilitychange", visible)
    return () => {
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", visible)
    }
  }, [refresh])

  useEffect(() => {
    if (view.deadline === undefined || view.loading || view.failed) return
    const timer = window.setTimeout(refresh, Math.max(0, view.deadline - performance.now()) + 25)
    return () => window.clearTimeout(timer)
  }, [view.deadline, view.loading, view.failed, refresh])

  async function confirm(retry = false) {
    if (inFlight.current || (!retry && locked.current)) return
    if (!retry) {
      if (!selected) return
      attempt.current = { meetingTypeId, body: { attemptId: crypto.randomUUID(), start: selected.start, guestName, guestEmail } }
    }
    const pending = attempt.current
    if (!pending) return
    inFlight.current = true
    locked.current = true
    function allowNewAttempt() {
      attempt.current = null
      locked.current = false
      setUnknown(false)
    }
    setSubmitting(true)
    setMessage("")
    setFields({})
    try {
      const result = await confirmMeeting({ path: { meetingTypeId: pending.meetingTypeId }, body: pending.body })
      if (result.response?.status === 201 && result.data) {
        setConfirmed(result.data)
      } else if (result.response?.status === 409 && result.error && "availability" in result.error) {
        const data = result.error.availability
        setView({ data, loading: false, failed: false, missing: false, deadline: performance.now() + Date.parse(data.nextWindowUpdate) - Date.parse(data.serverTime) })
        setSelected(null)
        setMessage(result.error.message)
        allowNewAttempt()
      } else if (result.response?.status === 400 && result.error && "fields" in result.error) {
        setMessage(result.error.message)
        setFields(result.error.fields)
        allowNewAttempt()
      } else if (result.response?.status === 410) {
        setClosed(true)
        setSelected(null)
        allowNewAttempt()
      } else if (result.response?.status === 404) {
        setView((current) => ({ ...current, missing: true }))
        setSelected(null)
        allowNewAttempt()
      } else {
        setUnknown(true)
      }
    } catch {
      setUnknown(true)
    } finally {
      inFlight.current = false
      setSubmitting(false)
    }
  }

  if (confirmed) return <MeetingConfirmation meeting={confirmed} />
  if (closed && !submitting && !unknown) return <section className="owner-panel slot-state">
    <p role="alert" className="booking-message">Запись на этот тип встречи закрыта</p>
    <p className="owner-description">Владелец календаря окончательно закрыл запись по этой ссылке. Выберите другой тип встречи в каталоге.</p>
  </section>
  if (view.missing && !submitting && !unknown) return <section className="owner-panel slot-state">
    <p role="alert" className="booking-message">Тип встречи больше недоступен. Выберите другой тип в каталоге.</p>
  </section>
  const data = view.data
  const ready = data && !view.loading && !view.failed && !view.missing
  return <section className="owner-panel slot-picker" aria-labelledby="slots-heading">
    <div className="slots-heading">
      <div><p className="eyebrow">Следующий шаг</p><h2 id="slots-heading">Выберите дату и время</h2></div>
      <CalendarDays aria-hidden="true" />
    </div>
    <p className="owner-description">Все даты и время — по Москве (Europe/Moscow).</p>
    {data && <div className="slot-date-row">
      <label className="slot-date-label" htmlFor="slot-date">Дата встречи по Москве
        <input id="slot-date" disabled={submitting || unknown} type="date" min={data.windowStart} max={data.windowEnd} value={query.date ?? data.selectedDate} onChange={(event) => {
          const date = event.target.value
          if (!date) return
          setSelected(null)
          setView((current) => ({ ...current, loading: true, failed: false }))
          setQuery((current) => ({ date, revision: current.revision + 1 }))
        }} />
      </label>
      <p className="field-hint">Окно записи: {dateLabel(data.windowStart)}–{dateLabel(data.windowEnd)}</p>
    </div>}
    {message && <p role="alert" className="booking-message">{message}</p>}
    {unknown && <div className="slot-state">
      <p role="alert" className="booking-message">Результат подтверждения неизвестен. Встреча могла быть создана. Повторите подтверждение с теми же данными, чтобы узнать результат. До ответа изменить данные нельзя. При перезагрузке страницы данные этой попытки будут потеряны.</p>
      <Button type="button" disabled={submitting} onClick={() => { void confirm(true) }}>Повторить подтверждение</Button>
    </div>}
    {view.loading && <p role="status" className="owner-description">Загружаем свободные слоты…</p>}
    {view.failed && <div className="slot-state"><p role="alert">Не удалось загрузить свободные слоты. Проверьте соединение и попробуйте ещё раз.</p><Button variant="outline" onClick={refresh}>Попробовать ещё раз</Button></div>}
    {ready && <>
      <div className="slots-date-heading"><h3>{dateLabel(data.selectedDate)}</h3><Button variant="ghost" size="sm" disabled={submitting || unknown} onClick={refresh}><RefreshCw aria-hidden="true" /> Обновить слоты</Button></div>
      {data.slots.length === 0 ? <p role="status" className="owner-description">На эту дату нет свободных слотов. Выберите другую дату.</p> : <div className="slot-grid" role="group" aria-label="Свободные слоты по Москве">{data.slots.map((slot) => {
        const pressed = selected?.start === slot.start
        return <Button key={slot.start} variant={pressed ? "default" : "outline"} className="slot-button" aria-pressed={pressed} disabled={submitting || unknown} onClick={() => setSelected(slot)}>{timeLabel(slot.start, data.timeZone)}–{timeLabel(slot.end, data.timeZone)}</Button>
      })}</div>}
      {selected && <div className="slot-summary" role="status"><strong>Выбран интервал</strong><span>{dateLabel(data.selectedDate)}, {timeLabel(selected.start, data.timeZone)}–{timeLabel(selected.end, data.timeZone)} по Москве</span><p>Выбор не резервирует время. При подтверждении мы снова проверим доступность.</p></div>}
    </>}
    {selected && ready && <form className="draft-form" noValidate aria-labelledby="guest-form-heading" onSubmit={(event) => { event.preventDefault(); void confirm() }}>
      <h3 id="guest-form-heading">Подтвердите запись</h3>
      <div className="form-field">
        <label htmlFor="guest-name">Ваше имя</label>
        <input id="guest-name" autoComplete="name" value={guestName} onChange={(event) => { setGuestName(event.target.value); setFields((current) => ({ ...current, guestName: "" })); setMessage("") }} disabled={submitting || unknown} required aria-invalid={Boolean(fields.guestName)} aria-describedby="guest-name-hint guest-name-error" />
        <p id="guest-name-hint" className="field-hint">От 1 до 100 символов без пробелов по краям.</p>
        <p id="guest-name-error" className="field-error">{fields.guestName}</p>
      </div>
      <div className="form-field">
        <label htmlFor="guest-email">Email</label>
        <input id="guest-email" type="email" autoComplete="email" value={guestEmail} onChange={(event) => { setGuestEmail(event.target.value); setFields((current) => ({ ...current, guestEmail: "" })); setMessage("") }} disabled={submitting || unknown} required aria-invalid={Boolean(fields.guestEmail)} aria-describedby="guest-email-hint guest-email-error" />
        <p id="guest-email-hint" className="field-hint">До 254 символов. Подтверждение письмом не требуется.</p>
        <p id="guest-email-error" className="field-error">{fields.guestEmail}</p>
      </div>
      {fields.start && <p role="alert" className="field-error">{fields.start} Обновите слоты и выберите время заново.</p>}
      {fields.body && <p role="alert" className="field-error">{fields.body}</p>}
      {fields.attemptId && <p role="alert" className="field-error">{fields.attemptId}</p>}
      <p className="field-hint">Имя и email увидит владелец календаря. Управление доступно без авторизации.</p>
      <div className="form-actions"><Button type="submit" disabled={submitting || unknown}>{submitting ? "Подтверждаем…" : "Подтвердить запись"}</Button></div>
    </form>}
  </section>
}
