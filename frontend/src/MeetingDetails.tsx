import { useEffect, useRef, useState } from "react"
import { CalendarCheck2, Copy } from "lucide-react"
import type { Meeting } from "@/api/generated/types.gen"
import { Button } from "@/components/ui/button"

export type { Meeting }

export function MeetingDetails({ meeting }: { meeting: Meeting }) {
  const [year, month, day] = meeting.date.split("-")
  const time = (value: string) => new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
  return <dl className="meeting-details">
    <div><dt>Тип встречи</dt><dd>{meeting.meetingType.name}</dd></div>
    <div><dt>Дата</dt><dd>{day}.{month}.{year}</dd></div>
    <div><dt>Время</dt><dd>{time(meeting.start)}–{time(meeting.end)} по Москве</dd></div>
    <div><dt>Гость</dt><dd>{meeting.guestName}</dd></div>
    <div><dt>Email</dt><dd>{meeting.guestEmail}</dd></div>
  </dl>
}

export function MeetingConfirmation({ meeting }: { meeting: Meeting }) {
  const [copyMessage, setCopyMessage] = useState("")
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  async function copy() {
    try {
      await navigator.clipboard.writeText(meeting.callUrl)
      setCopyMessage("Ссылка скопирована")
    } catch {
      setCopyMessage("Не удалось скопировать. Выделите ссылку и скопируйте её вручную.")
    }
  }
  return <section className="owner-panel meeting-confirmation" aria-labelledby="confirmation-heading">
    <span className="confirmation-icon"><CalendarCheck2 aria-hidden="true" /></span>
    <p className="eyebrow">Встреча подтверждена</p>
    <h2 id="confirmation-heading" ref={heading} tabIndex={-1}>Вы записаны на звонок</h2>
    <MeetingDetails meeting={meeting} />
    <div className="form-field">
      <label htmlFor="call-link">Ссылка для звонка</label>
      <input id="call-link" value={meeting.callUrl} readOnly onFocus={(event) => event.target.select()} />
      <p className="field-hint">Демонстрационная ссылка. Реальная видеосвязь не подключена.</p>
    </div>
    <Button variant="outline" onClick={() => { void copy() }}><Copy aria-hidden="true" /> Копировать ссылку</Button>
    <p role="status" className="copy-status">{copyMessage}</p>
    <p className="owner-description">Сохраните сведения самостоятельно. Письма и напоминания не отправляются.</p>
  </section>
}
