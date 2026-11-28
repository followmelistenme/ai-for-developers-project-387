import "@typespec/http";
import "@typespec/openapi";
import "./models.tsp";

using TypeSpec.Http;
using TypeSpec.OpenAPI;

@service(#{ title: "Календарь звонков" })
@info(#{ version: "0.1.0" })
@doc("Типы встреч одного владельца календаря: создание, публикация, окончательное снятие публикации и удаление без встреч, гостевой каталог, свободные слоты и подтверждение встречи. Авторизации нет.")
namespace CalendarBooking;

model MeetingTypeId {
  @path
  @doc("Уникальный идентификатор типа встречи.")
  @minLength(1)
  meetingTypeId: string;
}

@doc(Description)
model JsonResponse<
  Status extends int32,
  Body,
  Description extends valueof string
> {
  @statusCode statusCode: Status;
  @body body: Body;
}

@doc("Тип удалён; тело ответа отсутствует")
model DeletedMeetingTypeResponse is NoContentResponse;

alias BookingClosed = JsonResponse<
  410,
  BookingClosedError,
  "Запись на этот тип встречи окончательно закрыта; без сведений о гостях"
>;

alias InvalidTypeTransition = JsonResponse<
  409,
  MeetingTypeNotFoundError,
  "Переход состояния типа встречи запрещён"
>;

alias MeetingTypeNotFound = JsonResponse<
  404,
  MeetingTypeNotFoundError,
  "Тип встречи не найден или недоступен гостю"
>;

@get
@route("/api/owner/meeting-types")
@summary("Список типов встреч владельца")
@doc("Возвращает сохранённые типы встреч, включая черновики. Новый процесс начинает с пустого списка.")
op listOwnerMeetingTypes(): JsonResponse<
  200,
  MeetingTypeList,
  "Список типов встреч"
>;

@post
@route("/api/owner/meeting-types")
@summary("Создать черновик типа встречи")
@doc("Сохраняет новый черновик. Одинаковые названия разрешены. Черновики недоступны в гостевом интерфейсе.")
op createOwnerMeetingType(@body body: CreateMeetingType):
  | JsonResponse<201, MeetingType, "Черновик создан">
  | JsonResponse<
      400,
      ValidationError,
      "Некорректный запрос; данные не сохранены"
    >;

@delete
@route("/api/owner/meeting-types/{meetingTypeId}")
@summary("Удалить тип встречи без встреч")
@doc("Окончательно удаляет тип в любом состоянии только при отсутствии любых встреч, включая прошедшие. Проверка и удаление атомарны с подтверждением. Старые ссылки получают 404; одноимённый новый тип имеет отдельный ID. Тело запроса не требуется.")
op deleteOwnerMeetingType(...MeetingTypeId):
  | DeletedMeetingTypeResponse
  | MeetingTypeNotFound
  | JsonResponse<
      409,
      MeetingTypeDeletionConflict,
      "Есть хотя бы одна встреча; тип и все встречи сохранены. Опубликованный тип можно снять с публикации."
    >;

@post
@route("/api/owner/meeting-types/{meetingTypeId}/publish")
@summary("Опубликовать тип встречи")
@doc("Публикует черновик без изменения его данных. Проверка лимита пяти опубликованных типов и публикация выполняются атомарно. Повтор возвращает тот же опубликованный тип даже при заполненном лимите. Тело запроса не требуется.")
op publishOwnerMeetingType(...MeetingTypeId):
  | JsonResponse<200, MeetingType, "Опубликованный тип встречи">
  | MeetingTypeNotFound
  | JsonResponse<
      409,
      MeetingTypePublicationConflict,
      "Публикация снятого типа запрещена или все пять мест заняты. При заполненном лимите черновик сохраняется."
    >;

@post
@route("/api/owner/meeting-types/{meetingTypeId}/withdraw")
@summary("Окончательно снять публикацию типа встречи")
@doc("Опубликованный тип переходит в withdrawn, повтор возвращает тот же тип. Черновик снять нельзя (409). Переход окончательный, встречи и общая занятость сохраняются. Снятие атомарно с подтверждением новой встречи. Тело запроса не требуется.")
op withdrawOwnerMeetingType(...MeetingTypeId):
  | JsonResponse<200, MeetingType, "Снятый с публикации тип встречи">
  | MeetingTypeNotFound
  | InvalidTypeTransition;

@get
@route("/api/meeting-types")
@summary("Каталог опубликованных типов встреч")
@doc("Возвращает только опубликованные типы в порядке создания. Черновики недоступны гостям.")
op listPublishedMeetingTypes(): JsonResponse<
  200,
  MeetingTypeList,
  "Опубликованные типы встреч; пустой список, если публикаций нет"
>;

@get
@route("/api/meeting-types/{meetingTypeId}")
@summary("Опубликованный тип встречи по отдельной ссылке")
@doc("Возвращает опубликованный тип по уникальному идентификатору, независимо от его названия. Черновики и неизвестные идентификаторы недоступны.")
op getPublishedMeetingType(...MeetingTypeId):
  | JsonResponse<200, MeetingType, "Опубликованный тип встречи">
  | MeetingTypeNotFound
  | BookingClosed;

@get
@route("/api/meeting-types/{meetingTypeId}/slots")
@summary("Свободные слоты опубликованного типа")
@doc("Окно по Europe/Moscow от завтра до сегодня + 14 дней включительно. Рабочие часы 09:00–18:00, шаг стартов 30 минут. Выбор не резервирует время.")
op listAvailableSlots(
  ...MeetingTypeId,

  @query(#{ explode: true })
  @doc("Календарная дата по Москве, YYYY-MM-DD. Без параметра выбирается первый день текущего окна.")
  date?: plainDate,
):
  | JsonResponse<
      200,
      AvailableSlots,
      "Актуальное окно записи и интервалы для выбранной даты"
    >
  | JsonResponse<
      400,
      ValidationError,
      "Некорректная дата или дата вне текущего окна записи"
    >
  | MeetingTypeNotFound
  | BookingClosed;

@get
@route("/api/owner/meetings")
@summary("Предстоящие встречи владельца")
@doc("Все типы, включая уже начавшиеся встречи, пока end больше текущего времени. Порядок по началу от ближайших. Контакты доступны только здесь и в результате подтверждения; авторизации нет.")
op listOwnerMeetings(): JsonResponse<
  200,
  MeetingList,
  "Предстоящие и продолжающиеся встречи, пустой массив при отсутствии"
>;

@post
@route("/api/meeting-types/{meetingTypeId}/meetings")
@summary("Подтвердить запись на звонок")
@doc("Атомарно проверяет опубликованный тип, московское окно, рабочие часы, сетку и отсутствие пересечений для всех типов. Длительность и окончание определяются сервером. Выбор слота не резервирует время. Успешная попытка связывает attemptId с типом, моментом начала и обрезанными по краям именем/email (регистр email сохраняется). Точный повтор возвращает исходную встречу до перезапуска, даже после снятия публикации, окончания встречи и выхода даты из окна. Проверка сохранённой попытки предшествует проверке публикации; новая попытка после снятия получает 410. Несовпадение данных сохранённой попытки возвращает 400 fields.attemptId без сведений о встрече. Проверка попытки и сохранение атомарны; неуспешные ответы не запоминаются.")
op confirmMeeting(...MeetingTypeId, @body body: ConfirmMeeting):
  | JsonResponse<
      201,
      Meeting,
      "Встреча создана или возвращена исходная встреча успешной попытки; сохраните сведения самостоятельно, писем и напоминаний нет"
    >
  | JsonResponse<
      400,
      ValidationError,
      "Некорректный attemptId, контакты или начало; либо attemptId успешной попытки использован с другими данными (fields.attemptId). Новая встреча не создана, сведения прежней не возвращаются"
    >
  | MeetingTypeNotFound
  | JsonResponse<
      409,
      BookingConflict,
      "Интервал уже занят; актуальные свободные слоты выбранной московской даты без сведений о других гостях"
    >
  | BookingClosed;
