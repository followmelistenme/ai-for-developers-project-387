import { useEffect, useRef, useState } from "react"
import { CalendarDays, Clock3, Plus } from "lucide-react"
import { OwnerMeetings } from "@/OwnerMeetings"
import { createOwnerMeetingType, deleteOwnerMeetingType, listOwnerMeetingTypes, publishOwnerMeetingType, withdrawOwnerMeetingType } from "@/api/generated/sdk.gen"
import type { CreateMeetingType, MeetingType } from "@/api/generated/types.gen"
import { Button } from "@/components/ui/button"

type DraftInput = CreateMeetingType

const durations: DraftInput["durationMinutes"][] = [15, 30, 45, 60]

export function OwnerPage() {
  const [types, setTypes] = useState<MeetingType[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState("")
  const [refresh, setRefresh] = useState(0)
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [durationMinutes, setDurationMinutes] = useState<DraftInput["durationMinutes"]>(30)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState("")
  const [fields, setFields] = useState<Record<string, string>>({})
  const [publishing, setPublishing] = useState<string[]>([])
  const [publishErrors, setPublishErrors] = useState<Record<string, string>>({})
  const [withdrawing, setWithdrawing] = useState<string[]>([])
  const [withdrawErrors, setWithdrawErrors] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState<string[]>([])
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({})
  const [message, setMessage] = useState("")
  const nameInput = useRef<HTMLInputElement>(null)
  const deletedIds = useRef(new Set<string>())

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const { data, response } = await listOwnerMeetingTypes({ signal: controller.signal })
        if (!controller.signal.aborted) {
          if (!response?.ok || !data) throw new Error("Не удалось загрузить типы встреч")
          setTypes(data.filter((type) => !deletedIds.current.has(type.id)))
          setLoadError("")
        }
      } catch {
        if (!controller.signal.aborted) setLoadError("Не удалось загрузить типы встреч. Попробуйте ещё раз.")
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [refresh])

  useEffect(() => {
    if (formOpen) nameInput.current?.focus()
  }, [formOpen])

  function openForm() {
    setMessage("")
    setSaveError("")
    setFields({})
    setFormOpen(true)
  }

  async function saveDraft() {
    if (saving) return
    setSaving(true)
    setSaveError("")
    setFields({})
    try {
      const { data, error, response } = await createOwnerMeetingType({ body: { name, description, durationMinutes } })
      if (!response) throw new Error("Draft request failed")
      if (error) {
        setSaveError(error.message)
        setFields(error.fields)
      } else if (data) {
        setTypes((previous) => [...previous, data])
        setFormOpen(false)
        setName("")
        setDescription("")
        setDurationMinutes(30)
        setMessage("Черновик сохранён")
      } else {
        setSaveError("Не удалось сохранить черновик. Попробуйте ещё раз.")
      }
    } catch {
      setSaveError("Не удалось сохранить черновик. Проверьте соединение и попробуйте ещё раз.")
    } finally {
      setSaving(false)
    }
  }

  async function publish(id: string) {
    if (publishing.includes(id)) return
    setPublishing((previous) => [...previous, id])
    setPublishErrors((previous) => ({ ...previous, [id]: "" }))
    try {
      const { data, response } = await publishOwnerMeetingType({ path: { meetingTypeId: id } })
      if (deletedIds.current.has(id)) return
      if (!response?.ok || !data) throw new Error("Publication failed")
      setTypes((previous) => previous.map((type) => type.id === id ? data : type))
      setMessage("Тип встречи опубликован")
    } catch {
      if (deletedIds.current.has(id)) return
      setPublishErrors((previous) => ({ ...previous, [id]: "Не удалось опубликовать тип встречи. Попробуйте ещё раз." }))
    } finally {
      setPublishing((previous) => previous.filter((item) => item !== id))
    }
  }

  async function withdraw(id: string) {
    if (withdrawing.includes(id)) return
    setWithdrawing((previous) => [...previous, id])
    setWithdrawErrors((previous) => ({ ...previous, [id]: "" }))
    try {
      const { data, response } = await withdrawOwnerMeetingType({ path: { meetingTypeId: id } })
      if (deletedIds.current.has(id)) return
      if (!response?.ok || !data) throw new Error("Withdrawal failed")
      setTypes((previous) => previous.map((type) => type.id === id ? data : type))
      setMessage("Публикация снята. Существующие встречи сохранены.")
    } catch {
      if (deletedIds.current.has(id)) return
      setWithdrawErrors((previous) => ({ ...previous, [id]: "Не удалось снять публикацию. Проверьте соединение и попробуйте ещё раз." }))
    } finally {
      setWithdrawing((previous) => previous.filter((item) => item !== id))
    }
  }

  async function deleteType(id: string) {
    if (deleting.includes(id)) return
    setDeleting((previous) => [...previous, id])
    setDeleteErrors((previous) => ({ ...previous, [id]: "" }))
    try {
      const { response, error } = await deleteOwnerMeetingType({ path: { meetingTypeId: id } })
      // A lost successful response can be retried: 404 also removes the stale card.
      if (response?.status === 204 || response?.status === 404) {
        deletedIds.current.add(id)
        setTypes((previous) => previous.filter((type) => type.id !== id))
        setMessage("Тип встречи удалён")
      } else if (response?.status === 409 && error) {
        setDeleteErrors((previous) => ({ ...previous, [id]: error.message }))
      } else {
        throw new Error("Deletion failed")
      }
    } catch {
      setDeleteErrors((previous) => ({ ...previous, [id]: "Не удалось удалить тип встречи. Проверьте соединение и попробуйте ещё раз." }))
    } finally {
      setDeleting((previous) => previous.filter((item) => item !== id))
    }
  }

  return (
    <main id="main" className="owner-page container" tabIndex={-1}>
      <div className="owner-heading">
        <div>
          <p className="eyebrow">Для владельца календаря</p>
          <h1>Типы встреч</h1>
          <p className="owner-description">Создавайте типы встреч и задавайте длительность звонков.</p>
        </div>
        {!loading && !loadError && !formOpen && types.length > 0 && (
          <Button onClick={openForm}><Plus aria-hidden="true" /> Создать тип встречи</Button>
        )}
      </div>
      <p className="owner-status" role="status">{message}</p>
      {loading && <p className="owner-description">Загружаем типы встреч…</p>}
      {loadError && (
        <div className="owner-panel">
          <p role="alert">{loadError}</p>
          <Button variant="outline" onClick={() => { setLoading(true); setLoadError(""); setRefresh((value) => value + 1) }}>Попробовать ещё раз</Button>
        </div>
      )}
      {formOpen && (
        <section className="owner-panel" aria-labelledby="draft-form-heading">
          <h2 id="draft-form-heading">Новый тип встречи</h2>
          <p className="owner-description">Сохраните черновик. Он будет виден только в управлении.</p>
          <form className="draft-form" noValidate onSubmit={(event) => { event.preventDefault(); void saveDraft() }}>
            {saveError && <p className="field-error" role="alert">{saveError} {fields.body}</p>}
            <div className="form-field">
              <label htmlFor="draft-name">Название</label>
              <input id="draft-name" ref={nameInput} value={name} onChange={(event) => setName(event.target.value)} required disabled={saving} aria-invalid={Boolean(fields.name)} aria-describedby="name-hint name-error" placeholder="Например, Знакомство" />
              <p id="name-hint" className="field-hint">От 1 до 100 символов без пробелов по краям</p>
              <p id="name-error" className="field-error">{fields.name}</p>
            </div>
            <div className="form-field">
              <label htmlFor="draft-description">Описание</label>
              <textarea id="draft-description" value={description} onChange={(event) => setDescription(event.target.value)} disabled={saving} rows={4} aria-invalid={Boolean(fields.description)} aria-describedby="description-hint description-error" placeholder="О чём будет разговор?" />
              <p id="description-hint" className="field-hint">Необязательно. Обычный текст до 500 символов</p>
              <p id="description-error" className="field-error">{fields.description}</p>
            </div>
            <div className="form-field duration-field">
              <label htmlFor="draft-duration">Длительность</label>
              <select id="draft-duration" value={durationMinutes} disabled={saving} aria-invalid={Boolean(fields.durationMinutes)} aria-describedby="duration-error" onChange={(event) => {
                const value = durations.find((duration) => String(duration) === event.target.value)
                if (value !== undefined) setDurationMinutes(value)
              }}>
                {durations.map((duration) => <option key={duration} value={duration}>{duration} минут</option>)}
              </select>
              <p id="duration-error" className="field-error">{fields.durationMinutes}</p>
            </div>
            <div className="form-actions">
              <Button type="submit" disabled={saving}>{saving ? "Сохраняем…" : "Сохранить черновик"}</Button>
              <Button type="button" variant="outline" disabled={saving} onClick={() => setFormOpen(false)}>Отмена</Button>
            </div>
          </form>
        </section>
      )}
      {!loading && !loadError && types.length === 0 && !formOpen && (
        <section className="owner-panel owner-empty" aria-labelledby="empty-heading">
          <span className="placeholder-icon"><CalendarDays aria-hidden="true" /></span>
          <h2 id="empty-heading">Пока нет типов встреч</h2>
          <p className="owner-description">Создайте первый тип встречи: добавьте название, описание и длительность.</p>
          <Button onClick={openForm}><Plus aria-hidden="true" /> Создать тип встречи</Button>
        </section>
      )}
      {!loadError && types.length > 0 && (
        <div className="owner-types">
          {types.map((type) => (
            <article key={type.id} className="owner-panel draft-card" aria-labelledby={`type-${type.id}`}>
              <div className="draft-card-heading"><h2 id={`type-${type.id}`}>{type.name}</h2><span className={`draft-badge ${type.status === "published" ? "published-badge" : ""}`}>{type.status === "published" ? "Опубликован" : type.status === "withdrawn" ? "Снят с публикации" : "Черновик"}</span></div>
              <p className="draft-duration"><Clock3 aria-hidden="true" /> {type.durationMinutes} минут</p>
              {type.description && <p className="draft-description">{type.description}</p>}
              {type.status === "draft" ? (
                <>
                  <p className="field-hint">Недоступен гостям. Опубликуйте тип, чтобы он появился в каталоге.</p>
                  {publishErrors[type.id] && <p className="field-error" role="alert">{publishErrors[type.id]}</p>}
                  <Button className="publish-button" disabled={publishing.includes(type.id) || deleting.includes(type.id)} onClick={() => { void publish(type.id) }}>{publishing.includes(type.id) ? "Публикуем…" : "Опубликовать"}</Button>
                </>
              ) : type.status === "published" ? (
                <>
                  <Button asChild variant="outline"><a href={`/booking/${encodeURIComponent(type.id)}`}>Открыть страницу типа</a></Button>
                  <p className="field-hint" id={`withdraw-hint-${type.id}`}>Снятие публикации окончательно. Новые записи прекратятся, существующие встречи сохранятся. Чтобы открыть запись снова, создайте новый тип встречи.</p>
                  {withdrawErrors[type.id] && <p className="field-error" role="alert">{withdrawErrors[type.id]}</p>}
                  <Button variant="outline" aria-describedby={`withdraw-hint-${type.id}`} disabled={withdrawing.includes(type.id) || deleting.includes(type.id)} onClick={() => { void withdraw(type.id) }}>{withdrawing.includes(type.id) ? "Снимаем публикацию…" : "Снять публикацию"}</Button>
                </>
              ) : (
                <p className="field-hint">Запись окончательно закрыта. Существующие встречи сохранены. Для новой записи создайте новый тип встречи.</p>
              )}
              <p className="field-hint" id={`delete-hint-${type.id}`}>Удаление доступно, только если по типу нет встреч, включая прошедшие.</p>
              {deleteErrors[type.id] && <p className="field-error" role="alert">{deleteErrors[type.id]}</p>}
              <Button variant="outline" aria-describedby={`delete-hint-${type.id}`} disabled={deleting.includes(type.id)} onClick={() => { void deleteType(type.id) }}>{deleting.includes(type.id) ? "Удаляем…" : "Удалить"}</Button>
            </article>
          ))}
        </div>
      )}
      <OwnerMeetings />
    </main>
  )
}
