namespace CalendarBooking;

alias DurationMinutes = 15 | 30 | 45 | 60;

model MeetingTypePublicationConflict {
  @doc("Причина отказа в публикации.")
  message: string;

  @doc("Присутствует, если в календаре уже опубликовано пять типов встреч.")
  code?: "publication_limit_reached";
}

model MeetingTypeDeletionConflict {
  @doc("Любая встреча, включая прошедшую, запрещает удаление типа.")
  message: "Нельзя удалить тип встречи, по которому есть встречи";
}

model BookingClosedError {
  @doc("Окончательное закрытие новых бронирований по прежней ссылке.")
  message: "Запись на этот тип встречи закрыта";
}

model ConfirmMeeting {
  @doc("UUID отдельной попытки. Повторы передают те же данные и UUID; новая попытка после определённого отказа получает новый UUID. Успешные попытки хранятся в памяти до перезапуска без TTL; ошибки не связывают UUID.")
  @format("uuid")
  @pattern("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
  attemptId: string;

  @doc("Начало выбранного слота в RFC 3339; проверяется по Europe/Moscow.")
  start: offsetDateTime;

  @doc("Обязательное имя, 1–100 символов Unicode после обрезки пробелов по краям.")
  guestName: string;

  @doc("Обязательный адрес email корректного формата, до 254 символов после обрезки пробелов по краям. Подтверждение письмом не выполняется.")
  guestEmail: string;
}

model Meeting {
  @doc("Уникальный идентификатор созданной встречи.")
  @minLength(1)
  id: string;

  meetingType: MeetingType;

  @doc("Календарная дата встречи по Europe/Moscow.")
  date: plainDate;

  @doc("Начало включительно, RFC 3339 по Москве.")
  start: offsetDateTime;

  @doc("Окончание исключительно, рассчитано из длительности типа, RFC 3339 по Москве.")
  end: offsetDateTime;

  @doc("Имя гостя с обрезанными пробелами по краям.")
  @minLength(1)
  @maxLength(100)
  guestName: string;

  @doc("Email гостя с обрезанными пробелами по краям.")
  @maxLength(254)
  guestEmail: string;

  @doc("Демонстрационная ссылка http://localhost/event/{event_id}, идентификатор встречи. Реальная видеосвязь и страница ссылки не реализуются.")
  callUrl: string;
}

@doc("Встречи с end больше текущего времени, по возрастанию start.")
model MeetingList is Meeting[];

model BookingConflict {
  @doc("Сообщение о занятом интервале.")
  message: string;

  availability: AvailableSlots;
}

@doc("Свободный интервал; выбор не создаёт встречу.")
model AvailableSlot {
  @doc("Начало включительно, RFC 3339.")
  start: offsetDateTime;

  @doc("Окончание исключительно, RFC 3339.")
  end: offsetDateTime;
}

model AvailableSlots {
  @doc("Точный момент следующего сдвига окна — ближайшая московская полночь.")
  nextWindowUpdate: offsetDateTime;

  @doc("Текущее время, захваченное один раз для этого ответа.")
  serverTime: offsetDateTime;

  @doc("Часовой пояс календаря; не зависит от окружения сервера или браузера.")
  timeZone: "Europe/Moscow";

  @doc("Первый день окна включительно по Москве.")
  windowStart: plainDate;

  @doc("Последний день окна включительно по Москве.")
  windowEnd: plainDate;

  @doc("Выбранная календарная дата по Москве.")
  selectedDate: plainDate;

  @doc("Интервалы в порядке начала; пустой список при отсутствии свободного времени.")
  slots: AvailableSlot[];
}

model MeetingTypeNotFoundError {
  @doc("Сообщение о недоступном типе встречи.")
  message: string;
}

model CreateMeetingType {
  @doc("Название; после обрезки пробелов по краям от 1 до 100 символов Unicode.")
  name: string;

  @doc("Необязательное описание обычным текстом, до 500 символов Unicode. Разметка не интерпретируется.")
  @maxLength(500)
  description?: string;

  @doc("Длительность встречи в минутах.")
  durationMinutes: DurationMinutes;
}

model MeetingType {
  @doc("Уникальный идентификатор, назначенный сервером.")
  @minLength(1)
  id: string;

  @doc("Название с обрезанными пробелами по краям.")
  @minLength(1)
  @maxLength(100)
  name: string;

  @doc("Обычный текст; пустая строка, если описание не задано.")
  @maxLength(500)
  description: string;

  @doc("Длительность встречи в минутах.")
  durationMinutes: DurationMinutes;

  @doc("Черновик недоступен гостям; опубликованный тип доступен в каталоге; withdrawn окончательно закрыт без повторной публикации.")
  status: "draft" | "published" | "withdrawn";
}

@doc("Типы встреч в порядке создания.")
model MeetingTypeList is MeetingType[];

model ValidationError {
  @doc("Общее сообщение об ошибке.")
  message: string;

  @doc("Сообщения по полям name, description, durationMinutes, date, start, guestName, guestEmail; body для ошибки всего запроса.")
  fields: Record<string>;
}
