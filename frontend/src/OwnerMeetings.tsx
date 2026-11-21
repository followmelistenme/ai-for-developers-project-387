import { useCallback, useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { listOwnerMeetings } from "@/api/generated/sdk.gen"
import { MeetingDetails, type Meeting } from "@/MeetingDetails"
import { Button } from "@/components/ui/button"

export function OwnerMeetings() {
  const [meetings, setMeetings] = useState<Meeting[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => { setLoading(true); setFailed(false); setRevision((value) => value + 1) }, [])
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const { data, response } = await listOwnerMeetings({ signal: controller.signal })
        if (controller.signal.aborted) return
        if (!response?.ok || !data) throw new Error("Failed to load meetings")
        setMeetings(data)
      } catch {
        if (!controller.signal.aborted) setFailed(true)
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [revision])
  useEffect(() => {
    window.addEventListener("focus", refresh)
    function visible() { if (document.visibilityState === "visible") refresh() }
    document.addEventListener("visibilitychange", visible)
    return () => {
      window.removeEventListener("focus", refresh)
      document.removeEventListener("visibilitychange", visible)
    }
  }, [refresh])
  return <section className="owner-meetings" aria-labelledby="owner-meetings-heading">
    <div className="slots-date-heading"><h2 id="owner-meetings-heading">Предстоящие встречи</h2><Button variant="outline" onClick={refresh} disabled={loading}><RefreshCw aria-hidden="true" /> Обновить встречи</Button></div>
    <p className="owner-description">Все типы, от ближайших по времени. Начавшиеся встречи остаются в списке до окончания. Даты и время — по Москве.</p>
    {loading ? <p className="owner-description">Загружаем встречи…</p> : failed ? <div className="slot-state"><p role="alert">Не удалось загрузить встречи. Проверьте соединение и попробуйте ещё раз.</p><Button variant="outline" onClick={refresh}>Повторить загрузку встреч</Button></div> : meetings.length === 0 ? <p className="owner-description">Пока нет предстоящих встреч.</p> : <div className="owner-types">{meetings.map((meeting) => <article className="owner-panel" key={meeting.id}>
      <h3>{meeting.meetingType.name}</h3>
      <MeetingDetails meeting={meeting} />
      <a className="meeting-call-link" href={meeting.callUrl}>Ссылка для звонка</a>
      <p className="field-hint">Демонстрационная ссылка, без реальной видеосвязи.</p>
    </article>)}</div>}
  </section>
}
