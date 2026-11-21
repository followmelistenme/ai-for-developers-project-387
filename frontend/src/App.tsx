import {
  ArrowUpRight,
  CalendarCheck2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Globe2,
  LockKeyhole,
  UserRound,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { OwnerPage } from "@/OwnerPage"
import { BookingPage } from "@/BookingPage"

function Brand() {
  return (
    <a className="brand" href="/" aria-label="Календарь звонков — главная">
      <span className="brand-icon"><CalendarDays aria-hidden="true" /></span>
      <span className="brand-name">Календарь звонков</span>
    </a>
  )
}

function BookingLink() {
  return (
    <Button asChild className="booking-link">
      <a href="/booking">
        Перейти к записи <ArrowUpRight aria-hidden="true" />
      </a>
    </Button>
  )
}

function BookingPreview() {
  return (
    <figure className="booking-preview" aria-labelledby="preview-caption">
      <figcaption id="preview-caption" className="preview-caption">
        <span>Пример записи</span>
        <span className="demo-label">Демо</span>
        <span className="sr-only">
          Статичный пример: встреча «Знакомство» на 30 минут, календарь
          и варианты времени по Москве.
        </span>
      </figcaption>
      <div aria-hidden="true">
        <div className="preview-content">
          <div className="preview-meeting">
            <span className="meeting-icon"><CalendarDays /></span>
            <p className="preview-owner">Календарь звонков</p>
            <p className="meeting-title">Знакомство</p>
            <p className="meeting-duration"><Clock3 /> 30 минут</p>
            <p className="meeting-description">Начнём с короткого разговора.</p>
          </div>
          <div className="preview-calendar">
            <div className="calendar-month">
              <span>Апрель</span>
              <span className="calendar-arrows"><ChevronLeft /><ChevronRight /></span>
            </div>
            <table className="calendar-grid">
              <thead>
                <tr>{["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((day) => <th key={day}>{day}</th>)}</tr>
              </thead>
              <tbody>
                {Array.from({ length: 5 }, (_, week) => (
                  <tr key={week}>
                    {Array.from({ length: 7 }, (_, weekday) => {
                      const day = week * 7 + weekday - 1
                      return (
                        <td key={weekday}>
                          {day >= 1 && day <= 30 && (
                            <span className={day === 16 ? "calendar-day selected-day" : "calendar-day"}>{day}</span>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="preview-times">
              <p>Четверг, 16 апреля</p>
              <div className="time-options">
                <span>10:00</span>
                <span className="selected-time">10:30 <Check /></span>
                <span>11:00</span>
                <span>11:30</span>
              </div>
            </div>
          </div>
        </div>
        <div className="preview-footer"><Globe2 /> Время по Москве</div>
      </div>
    </figure>
  )
}

export default function App() {
  const isBookingPage = window.location.pathname === "/booking" || window.location.pathname.startsWith("/booking/")
  const isOwnerPage = window.location.pathname === "/owner"

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">К содержимому</a>
      <header className="site-header">
        <div className="container header-content">
          <Brand />
          <nav className="header-nav" aria-label="Главная навигация">
            <a className="owner-link" href="/owner" aria-current={isOwnerPage ? "page" : undefined}>Для владельца</a>
            {!isBookingPage && !isOwnerPage && <BookingLink />}
          </nav>
        </div>
      </header>
      {isOwnerPage ? <OwnerPage /> : isBookingPage ? <BookingPage /> : (
        <main id="main" tabIndex={-1}>
          <section className="container hero" aria-labelledby="hero-title">
            <div className="hero-copy">
              <p className="eyebrow hero-eyebrow"><span /> Просто договориться</p>
              <h1 id="hero-title">Запись на звонок <span>без лишней переписки</span></h1>
              <p className="hero-description">Выберите тип встречи, удобное время и подтвердите запись. Всё необходимое — в одном календаре.</p>
              <BookingLink />
              <p className="hero-note"><UserRound aria-hidden="true" /> Без регистрации</p>
            </div>
            <BookingPreview />
          </section>
          <section id="how-it-works" className="container how-section" aria-labelledby="how-title">
            <div className="section-heading">
              <p className="eyebrow">От выбора до встречи</p>
              <h2 id="how-title">Как это работает</h2>
              <p>Три простых шага. И время для разговора уже в ваших планах.</p>
            </div>
            <ol className="steps">
              <li className="step">
                <span className="step-number" aria-hidden="true">01</span>
                <h3>Выберите тип встречи</h3>
                <p>Найдите подходящий формат звонка. Описание и длительность — сразу перед вами.</p>
              </li>
              <li className="step">
                <span className="step-number" aria-hidden="true">02</span>
                <h3>Найдите удобное время</h3>
                <p>Посмотрите свободные слоты в календаре и выберите тот, что подходит вам.</p>
              </li>
              <li className="step">
                <span className="step-number" aria-hidden="true">03</span>
                <h3>Подтвердите запись</h3>
                <p>После подтверждения время закрепляется за вашей встречей.</p>
              </li>
            </ol>
          </section>
          <section className="container benefits-section" aria-labelledby="benefits-title">
            <div className="section-heading">
              <p className="eyebrow">Продумано для вашего времени</p>
              <h2 id="benefits-title">Меньше хлопот. Больше ясности.</h2>
            </div>
            <div className="benefits">
              <article className="benefit">
                <UserRound className="benefit-icon" aria-hidden="true" />
                <h3>Без регистрации</h3>
                <p>Сразу переходите к выбору встречи. Создавать аккаунт не нужно.</p>
              </article>
              <article className="benefit">
                <CalendarCheck2 className="benefit-icon" aria-hidden="true" />
                <h3>Свободное время — на виду</h3>
                <p>Календарь показывает доступные интервалы для выбранного типа встречи.</p>
              </article>
              <article className="benefit">
                <LockKeyhole className="benefit-icon" aria-hidden="true" />
                <h3>Время закреплено за вами</h3>
                <p>Подтверждённый интервал становится недоступным для других встреч.</p>
              </article>
            </div>
          </section>
        </main>
      )}
      <footer className="site-footer">
        <div className="container footer-content">
          <span>Календарь звонков</span>
          <span><Globe2 aria-hidden="true" /> Время календаря — по Москве</span>
        </div>
      </footer>
    </div>
  )
}
