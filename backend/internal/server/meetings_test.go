package server_test

import (
	"encoding/json"
	"fmt"
	"github.com/google/uuid"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/followmelistenme/ai-for-developers-project-387/backend/internal/server"
)

type meetingResponse struct {
	ID, Date, Start, End, GuestName, GuestEmail, CallURL string
	MeetingType                                          struct {
		ID, Name        string
		DurationMinutes int
	}
}

func calendarAt(t *testing.T, instant string) http.Handler {
	t.Helper()
	now, err := time.Parse(time.RFC3339, instant)
	if err != nil {
		t.Fatal(err)
	}
	h, err := server.NewWithClock(func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func confirm(t *testing.T, h http.Handler, id, body string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(http.MethodPost, "/api/meeting-types/"+id+"/meetings", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w
}

func bookingBody(start string) string {
	return fmt.Sprintf(`{"attemptId":%q,"start":%q,"guestName":"  Анна  ","guestEmail":" anna@example.com "}`, uuid.NewString(), start)
}

func ownerMeetings(t *testing.T, h http.Handler) []meetingResponse {
	t.Helper()
	got := request(h, http.MethodGet, "/api/owner/meetings")
	if got.Code != http.StatusOK {
		t.Fatalf("owner meetings: %d %s", got.Code, got.Body.String())
	}
	var result []meetingResponse
	if err := json.Unmarshal(got.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestGuestConfirmationCreatesMeetingShownToOwner(t *testing.T) {
	h := calendarAt(t, "2026-11-15T22:00:00Z") // Already November 16 in Moscow.
	id := publishType(t, h, 45)
	got := confirm(t, h, id, bookingBody("2026-11-17T09:00:00+03:00"))
	if got.Code != http.StatusCreated {
		t.Fatalf("confirm: %d %s", got.Code, got.Body.String())
	}
	var meeting meetingResponse
	if err := json.Unmarshal(got.Body.Bytes(), &meeting); err != nil {
		t.Fatal(err)
	}
	if meeting.ID == "" || meeting.ID == id || meeting.Date != "2026-11-17" || meeting.Start != "2026-11-17T09:00:00+03:00" || meeting.End != "2026-11-17T09:45:00+03:00" || meeting.MeetingType.ID != id || meeting.MeetingType.DurationMinutes != 45 || meeting.GuestName != "Анна" || meeting.GuestEmail != "anna@example.com" || meeting.CallURL != "http://localhost/event/"+meeting.ID {
		t.Fatalf("wrong meeting details: %+v", meeting)
	}
	listed := ownerMeetings(t, h)
	if len(listed) != 1 || listed[0] != meeting {
		t.Fatalf("owner differs: %+v", listed)
	}
	fresh := calendarAt(t, "2026-11-15T22:00:00Z")
	if len(ownerMeetings(t, fresh)) != 0 {
		t.Fatal("new server retained meetings")
	}
}

func TestConfirmationRejectsInvalidGuestAndForgedData(t *testing.T) {
	cases := []struct{ name, body, field string }{
		{"blank name", `{"start":"2026-11-16T09:00:00+03:00","guestName":" \t ","guestEmail":"anna@example.com"}`, "guestName"},
		{"long name", `{"start":"2026-11-16T09:00:00+03:00","guestName":"` + strings.Repeat("я", 101) + `","guestEmail":"anna@example.com"}`, "guestName"},
		{"blank email", `{"start":"2026-11-16T09:00:00+03:00","guestName":"Анна","guestEmail":" "}`, "guestEmail"},
		{"bad email", `{"start":"2026-11-16T09:00:00+03:00","guestName":"Анна","guestEmail":"no-at"}`, "guestEmail"},
		{"display name email", `{"start":"2026-11-16T09:00:00+03:00","guestName":"Анна","guestEmail":"Anna <anna@example.com>"}`, "guestEmail"},
		{"long email", `{"start":"2026-11-16T09:00:00+03:00","guestName":"Анна","guestEmail":"` + strings.Repeat("a", 243) + `@example.com"}`, "guestEmail"},
		{"missing name", `{"start":"2026-11-16T09:00:00+03:00","guestEmail":"anna@example.com"}`, "guestName"},
		{"missing email", `{"start":"2026-11-16T09:00:00+03:00","guestName":"Анна"}`, "guestEmail"},
		{"null email", `{"start":"2026-11-16T09:00:00+03:00","guestName":"Анна","guestEmail":null}`, "guestEmail"},
		{"number name", `{"start":"2026-11-16T09:00:00+03:00","guestName":42,"guestEmail":"anna@example.com"}`, "guestName"},
		{"malformed start", `{"start":"tomorrow","guestName":"Анна","guestEmail":"anna@example.com"}`, "start"},
		{"forged end", `{"start":"2026-11-16T09:00:00+03:00","guestName":"Анна","guestEmail":"anna@example.com","end":"2026-11-16T09:15:00+03:00"}`, "body"},
		{"forged duration", `{"start":"2026-11-16T09:00:00+03:00","guestName":"Анна","guestEmail":"anna@example.com","durationMinutes":15}`, "body"},
		{"malformed JSON", `{"start":`, "body"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h := calendarAt(t, "2026-11-15T12:00:00Z")
			id := publishType(t, h, 30)
			body := tc.body
			if json.Valid([]byte(body)) {
				body = strings.Replace(body, "{", `{"attemptId":"`+uuid.NewString()+`",`, 1)
			}
			got := confirm(t, h, id, body)
			var problem struct {
				Message string
				Fields  map[string]string
			}
			if err := json.Unmarshal(got.Body.Bytes(), &problem); err != nil {
				t.Fatal(err)
			}
			if got.Code != http.StatusBadRequest || problem.Message == "" || problem.Fields[tc.field] == "" {
				t.Fatalf("wanted %s field error: %d %s", tc.field, got.Code, got.Body.String())
			}
			if len(ownerMeetings(t, h)) != 0 {
				t.Fatal("invalid meeting saved")
			}
		})
	}
}

func TestGuestContactBoundariesAreTrimmedAndPreserved(t *testing.T) {
	for _, name := range []string{"я", strings.Repeat("🙂", 100)} {
		t.Run(fmt.Sprint(len(name)), func(t *testing.T) {
			h := calendarAt(t, "2026-11-15T12:00:00Z")
			id := publishType(t, h, 15)
			email := strings.Repeat("a", 64) + "@" + strings.Repeat("b", 63) + "." + strings.Repeat("c", 63) + "." + strings.Repeat("d", 61)
			got := confirm(t, h, id, fmt.Sprintf(`{"attemptId":%q,"start":"2026-11-16T09:00:00+03:00","guestName":%q,"guestEmail":%q}`, uuid.NewString(), "  "+name+"  ", "  "+email+"  "))
			if got.Code != http.StatusCreated {
				t.Fatalf("valid boundaries rejected: %d %s", got.Code, got.Body.String())
			}
			list := ownerMeetings(t, h)
			if len(list) != 1 || list[0].GuestName != name || list[0].GuestEmail != email {
				t.Fatalf("boundary contacts changed: %+v", list)
			}
		})
	}
}

func TestConfirmationRechecksCalendarRulesForEveryDuration(t *testing.T) {
	for _, duration := range []int{15, 30, 45, 60} {
		t.Run(fmt.Sprint(duration), func(t *testing.T) {
			for _, tc := range []struct {
				start  string
				status int
			}{
				{"2026-11-16T09:00:00+03:00", 201},
				{"2026-11-29T09:00:00+03:00", 201},
				{"2026-11-15T09:00:00+03:00", 400},
				{"2026-11-30T09:00:00+03:00", 400},
				{"2026-11-16T08:30:00+03:00", 400},
				{"2026-11-16T18:00:00+03:00", 400},
				{"2026-11-16T09:15:00+03:00", 400},
				{"2026-11-16T09:00:01+03:00", 400},
				{"2026-11-16T09:00:00.001+03:00", 400},
				{"2026-11-16T06:00:00Z", 201},
			} {
				t.Run(tc.start, func(t *testing.T) {
					h := calendarAt(t, "2026-11-15T12:00:00Z")
					id := publishType(t, h, duration)
					got := confirm(t, h, id, bookingBody(tc.start))
					if got.Code != tc.status {
						t.Fatalf("duration %d at %s: %d %s", duration, tc.start, got.Code, got.Body.String())
					}
					if tc.status == 400 {
						var problem struct{ Fields map[string]string }
						if err := json.Unmarshal(got.Body.Bytes(), &problem); err != nil {
							t.Fatal(err)
						}
						if problem.Fields["start"] == "" || len(ownerMeetings(t, h)) != 0 {
							t.Fatalf("invalid start saved or no field error: %s", got.Body.String())
						}
					}
				})
			}
			h := calendarAt(t, "2026-11-15T12:00:00Z")
			id := publishType(t, h, duration)
			last := "2026-11-16T17:30:00+03:00"
			expected := 201
			if duration > 30 {
				expected = 400
			}
			if got := confirm(t, h, id, bookingBody(last)); got.Code != expected {
				t.Fatalf("end-of-day %d: %d %s", duration, got.Code, got.Body.String())
			}
			if duration > 30 {
				if got := confirm(t, h, id, bookingBody("2026-11-16T17:00:00+03:00")); got.Code != 201 {
					t.Fatalf("last full interval: %d %s", got.Code, got.Body.String())
				}
			}
		})
	}
}

func TestConfirmationRejectsDraftAndUnknownMeetingType(t *testing.T) {
	h := calendarAt(t, "2026-11-15T12:00:00Z")
	draft := post(t, h, `{"name":"Скрытый тип","durationMinutes":30}`)
	var item struct{ ID string }
	if err := json.Unmarshal(draft.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{item.ID, "unknown"} {
		got := confirm(t, h, id, bookingBody("2026-11-16T09:00:00+03:00"))
		if got.Code != 404 || !strings.Contains(got.Body.String(), `"message"`) {
			t.Fatalf("unavailable type booked: %d %s", got.Code, got.Body.String())
		}
	}
	if len(ownerMeetings(t, h)) != 0 {
		t.Fatal("draft/unknown booking saved")
	}
}

func TestConfirmationRechecksMoscowWindowAtMidnight(t *testing.T) {
	now := time.Date(2026, 12, 31, 20, 59, 59, 0, time.UTC)
	h, err := server.NewWithClock(func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	id := publishType(t, h, 30)
	readSlots(t, h, id, "?date=2027-01-01")
	now = now.Add(time.Second)
	got := confirm(t, h, id, bookingBody("2027-01-01T09:00:00+03:00"))
	if got.Code != 400 {
		t.Fatalf("expired window booked: %d %s", got.Code, got.Body.String())
	}
	if got := confirm(t, h, id, bookingBody("2027-01-15T09:00:00+03:00")); got.Code != 201 {
		t.Fatalf("new window end rejected: %d %s", got.Code, got.Body.String())
	}
}

func TestAllTypesShareHalfOpenIntervalsAndConflictIncludesFreshSelectedDate(t *testing.T) {
	for _, tc := range []struct {
		name, savedStart, nextStart         string
		savedDuration, nextDuration, status int
	}{
		{"equal", "09:30", "09:30", 45, 45, 409},
		{"nested", "09:30", "10:00", 60, 15, 409},
		{"enclosing", "09:30", "09:00", 15, 60, 409},
		{"partial from before", "09:30", "09:00", 45, 60, 409},
		{"partial from after", "09:30", "10:00", 45, 30, 409},
		{"adjacent before", "09:30", "09:00", 45, 30, 201},
		{"adjacent after", "09:30", "10:30", 60, 30, 201},
	} {
		t.Run(tc.name, func(t *testing.T) {
			h := calendarAt(t, "2026-11-15T12:00:00Z")
			first := publishType(t, h, tc.savedDuration)
			second := publishType(t, h, tc.nextDuration)
			date := "2026-11-20T"
			if got := confirm(t, h, first, bookingBody(date+tc.savedStart+":00+03:00")); got.Code != 201 {
				t.Fatal(got.Body.String())
			}
			got := confirm(t, h, second, bookingBody(date+tc.nextStart+":00+03:00"))
			if got.Code != tc.status {
				t.Fatalf("%s: %d %s", tc.name, got.Code, got.Body.String())
			}
			if tc.status == 409 {
				var problem struct {
					Message      string
					Availability availabilityResponse
				}
				if err := json.Unmarshal(got.Body.Bytes(), &problem); err != nil {
					t.Fatal(err)
				}
				live := readSlots(t, h, second, "?date=2026-11-20")
				if problem.Message == "" || problem.Availability.SelectedDate != "2026-11-20" || fmt.Sprint(problem.Availability.Slots) != fmt.Sprint(live.Slots) {
					t.Fatalf("conflict has stale/wrong date slots: %s", got.Body.String())
				}
				for _, slot := range problem.Availability.Slots {
					if slot.Start == date+tc.nextStart+":00+03:00" {
						t.Fatal("conflicting interval offered again")
					}
				}
				if strings.Contains(got.Body.String(), "anna@example.com") || strings.Contains(got.Body.String(), "guestName") {
					t.Fatal("conflict leaks contacts")
				}
				if len(ownerMeetings(t, h)) != 1 {
					t.Fatal("conflicting meeting saved")
				}
			} else if len(ownerMeetings(t, h)) != 2 {
				t.Fatal("adjacent meeting missing")
			}
		})
	}
}

func TestConfirmedTimeDisappearsForEveryTypeWithoutLeakingContacts(t *testing.T) {
	h := calendarAt(t, "2026-11-15T12:00:00Z")
	booked := publishType(t, h, 45)
	if got := confirm(t, h, booked, bookingBody("2026-11-16T09:30:00+03:00")); got.Code != 201 {
		t.Fatal(got.Body.String())
	}
	for _, duration := range []int{15, 30, 45, 60} {
		id := publishType(t, h, duration)
		got := readSlots(t, h, id, "")
		first := "2026-11-16T09:00:00+03:00"
		if duration > 30 {
			first = "2026-11-16T10:30:00+03:00"
		}
		if got.Slots[0].Start != first {
			t.Fatalf("duration %d first free slot: %+v", duration, got.Slots)
		}
		for _, slot := range got.Slots {
			if slot.Start == "2026-11-16T09:30:00+03:00" || slot.Start == "2026-11-16T10:00:00+03:00" {
				t.Fatalf("duration %d still offers occupied time", duration)
			}
		}
		for _, path := range []string{"/api/meeting-types", "/api/meeting-types/" + id, "/api/meeting-types/" + id + "/slots"} {
			body := request(h, http.MethodGet, path).Body.String()
			for _, secret := range []string{"anna@example.com", "guestName", "guestEmail", "callUrl"} {
				if strings.Contains(body, secret) {
					t.Fatalf("public %s leaked %s", path, secret)
				}
			}
		}
	}
}

func TestConcurrentIntersectingConfirmationsHaveExactlyOneWinner(t *testing.T) {
	h := calendarAt(t, "2026-11-15T12:00:00Z")
	ids := []string{publishType(t, h, 60), publishType(t, h, 45)}
	const count = 24
	start := make(chan struct{})
	results := make(chan *httptest.ResponseRecorder, count)
	var workers sync.WaitGroup
	for i := range count {
		workers.Go(func() {
			<-start
			instant := "2026-11-16T09:30:00+03:00"
			if i%2 == 1 {
				instant = "2026-11-16T10:00:00+03:00"
			}
			results <- confirm(t, h, ids[i%2], bookingBody(instant))
		})
	}
	close(start)
	workers.Wait()
	close(results)
	winners := 0
	for got := range results {
		if got.Code == 201 {
			winners++
			continue
		}
		if got.Code != 409 || !strings.Contains(got.Body.String(), `"availability"`) {
			t.Fatalf("unexpected loser: %d %s", got.Code, got.Body.String())
		}
	}
	if winners != 1 || len(ownerMeetings(t, h)) != 1 {
		t.Fatalf("concurrent winners: %d, owner list: %+v", winners, ownerMeetings(t, h))
	}
}

func TestOwnerSeesChronologicalFutureAndOngoingMeetingsUntilTheirEnd(t *testing.T) {
	now := time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
	h, err := server.NewWithClock(func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	short := publishType(t, h, 30)
	long := publishType(t, h, 60)
	for _, item := range []struct{ id, start string }{
		{short, "2026-11-16T10:30:00+03:00"},
		{short, "2026-11-16T09:00:00+03:00"},
		{long, "2026-11-16T09:30:00+03:00"},
	} {
		if got := confirm(t, h, item.id, bookingBody(item.start)); got.Code != 201 {
			t.Fatal(got.Body.String())
		}
	}
	list := ownerMeetings(t, h)
	if len(list) != 3 || list[0].Start != "2026-11-16T09:00:00+03:00" || list[1].Start != "2026-11-16T09:30:00+03:00" || list[2].Start != "2026-11-16T10:30:00+03:00" {
		t.Fatalf("owner order: %+v", list)
	}
	now = time.Date(2026, 11, 16, 6, 45, 0, 0, time.UTC) // 09:45 in Moscow.
	list = ownerMeetings(t, h)
	if len(list) != 2 || list[0].Start != "2026-11-16T09:30:00+03:00" {
		t.Fatalf("ongoing missing or finished retained: %+v", list)
	}
	now = time.Date(2026, 11, 16, 7, 30, 0, 0, time.UTC) // Exactly the ongoing meeting's end.
	list = ownerMeetings(t, h)
	if len(list) != 1 || list[0].Start != "2026-11-16T10:30:00+03:00" {
		t.Fatalf("end not exclusive: %+v", list)
	}
	now = time.Date(2026, 11, 16, 8, 0, 0, 0, time.UTC)
	if len(ownerMeetings(t, h)) != 0 {
		t.Fatal("finished meeting retained")
	}
}

func TestSuccessfulAttemptReplaysOriginalMeetingOnce(t *testing.T) {
	h := calendarAt(t, "2026-11-15T12:00:00Z")
	id := publishType(t, h, 30)
	body := bookingBody("2026-11-16T09:00:00+03:00")
	original := confirm(t, h, id, body)
	replay := confirm(t, h, id, body)
	if original.Code != 201 || replay.Code != 201 || replay.Body.String() != original.Body.String() {
		t.Fatalf("replay differs: original %d %s; replay %d %s", original.Code, original.Body.String(), replay.Code, replay.Body.String())
	}
	if len(ownerMeetings(t, h)) != 1 {
		t.Fatal("replay created another meeting")
	}
	if slots := readSlots(t, h, id, ""); slots.Slots[0].Start != "2026-11-16T09:30:00+03:00" {
		t.Fatalf("occupied time offered: %+v", slots.Slots)
	}
	// A new process forgets accepted attempts and meetings together.
	fresh := calendarAt(t, "2026-11-15T12:00:00Z")
	if got := confirm(t, fresh, id, body); got.Code != 404 {
		t.Fatalf("new process retained attempt: %d %s", got.Code, got.Body.String())
	}
	newType := publishType(t, fresh, 30)
	if got := confirm(t, fresh, newType, body); got.Code != 201 || got.Body.String() == original.Body.String() {
		t.Fatalf("new process could not use fresh attempt: %d %s", got.Code, got.Body.String())
	}
}

func TestSavedAttemptRejectsChangedDataWithoutLeakingOriginal(t *testing.T) {
	h := calendarAt(t, "2026-11-15T12:00:00Z")
	id := publishType(t, h, 30)
	other := publishType(t, h, 30)
	body := bookingBody("2026-11-16T09:00:00+03:00")
	original := confirm(t, h, id, body)
	if original.Code != 201 {
		t.Fatal(original.Body.String())
	}
	for _, tc := range []struct{ name, id, body string }{
		{"email", id, strings.ReplaceAll(body, "anna@example.com", "boris@example.com")},
		{"email case", id, strings.ReplaceAll(body, "anna@example.com", "Anna@example.com")},
		{"name", id, strings.ReplaceAll(body, "Анна", "Борис")},
		{"invalid name", id, strings.ReplaceAll(body, "Анна", "")},
		{"start", id, strings.ReplaceAll(body, "09:00:00", "10:00:00")},
		{"type", other, body},
		{"unknown type", "missing", body},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := confirm(t, h, tc.id, tc.body)
			var problem struct{ Fields map[string]string }
			if err := json.Unmarshal(got.Body.Bytes(), &problem); err != nil {
				t.Fatal(err)
			}
			if got.Code != 400 || problem.Fields["attemptId"] == "" {
				t.Fatalf("mismatch accepted or wrong field: %d %s", got.Code, got.Body.String())
			}
			for _, secret := range []string{"guestName", "guestEmail", "callUrl", "anna@example.com", "Анна", `"id"`} {
				if strings.Contains(got.Body.String(), secret) {
					t.Fatalf("mismatch leaked %s: %s", secret, got.Body.String())
				}
			}
		})
	}
	if len(ownerMeetings(t, h)) != 1 {
		t.Fatal("changed attempt saved")
	}
	replay := confirm(t, h, id, body)
	if replay.Body.String() != original.Body.String() {
		t.Fatal("original attempt changed")
	}
}

func TestConfirmationRequiresUUIDAttemptID(t *testing.T) {
	for _, value := range []string{`""`, `"not-a-uuid"`, `"00000000000000000000000000000000"`, `null`, `42`, "missing"} {
		t.Run(value, func(t *testing.T) {
			h := calendarAt(t, "2026-11-15T12:00:00Z")
			id := publishType(t, h, 30)
			body := `{"start":"2026-11-16T09:00:00+03:00","guestName":"Анна","guestEmail":"anna@example.com"}`
			if value != "missing" {
				body = strings.Replace(body, "{", `{"attemptId":`+value+`,`, 1)
			}
			got := confirm(t, h, id, body)
			var problem struct{ Fields map[string]string }
			if err := json.Unmarshal(got.Body.Bytes(), &problem); err != nil {
				t.Fatal(err)
			}
			if got.Code != 400 || problem.Fields["attemptId"] == "" || len(ownerMeetings(t, h)) != 0 {
				t.Fatalf("invalid attempt: %d %s", got.Code, got.Body.String())
			}
		})
	}
}

func TestSuccessfulAttemptSurvivesMidnightMeetingEndAndWindowExpiry(t *testing.T) {
	now := time.Date(2026, 11, 15, 20, 59, 59, 0, time.UTC)
	h, err := server.NewWithClock(func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	id := publishType(t, h, 30)
	body := bookingBody("2026-11-16T09:00:00+03:00")
	original := confirm(t, h, id, body)
	if original.Code != 201 {
		t.Fatal(original.Body.String())
	}
	// A canonical replay trims contacts and compares instants, not RFC3339 strings.
	canonical := strings.ReplaceAll(strings.ReplaceAll(strings.ReplaceAll(body, "  Анна  ", "Анна"), " anna@example.com ", "anna@example.com"), "2026-11-16T09:00:00+03:00", "2026-11-16T06:00:00Z")
	for _, instant := range []string{"2026-11-15T21:00:00Z", "2026-11-16T06:30:00Z", "2027-01-01T12:00:00Z"} {
		now, err = time.Parse(time.RFC3339, instant)
		if err != nil {
			t.Fatal(err)
		}
		replay := confirm(t, h, id, canonical)
		if replay.Code != 201 || replay.Body.String() != original.Body.String() {
			t.Fatalf("lost attempt at %s: %d %s", instant, replay.Code, replay.Body.String())
		}
	}
	if len(ownerMeetings(t, h)) != 0 {
		t.Fatal("ended meeting remained in upcoming list")
	}
}

func TestConcurrentAttemptsPreserveIdentityAndGuestPrivacy(t *testing.T) {
	for _, sameGuest := range []bool{true, false} {
		t.Run(fmt.Sprint(sameGuest), func(t *testing.T) {
			h := calendarAt(t, "2026-11-15T12:00:00Z")
			id := publishType(t, h, 30)
			body := bookingBody("2026-11-16T09:00:00+03:00")
			const count = 24
			start := make(chan struct{})
			results := make(chan struct {
				body     string
				response *httptest.ResponseRecorder
			}, count)
			var workers sync.WaitGroup
			for i := range count {
				workers.Go(func() {
					payload := body
					if !sameGuest {
						payload = strings.ReplaceAll(payload, "anna@example.com", fmt.Sprintf("guest%d@example.com", i))
					}
					<-start
					results <- struct {
						body     string
						response *httptest.ResponseRecorder
					}{payload, confirm(t, h, id, payload)}
				})
			}
			close(start)
			workers.Wait()
			close(results)
			identity := ""
			successes := 0
			for result := range results {
				got := result.response
				if got.Code == 201 {
					var m meetingResponse
					if err := json.Unmarshal(got.Body.Bytes(), &m); err != nil {
						t.Fatal(err)
					}
					if !strings.Contains(result.body, m.GuestEmail) {
						t.Fatal("another guest received confirmation")
					}
					if identity != "" && identity != m.ID {
						t.Fatal("concurrent replay created different identities")
					}
					identity = m.ID
					successes++
				} else {
					if got.Code != 400 || !strings.Contains(got.Body.String(), `"attemptId"`) || strings.Contains(got.Body.String(), "guestEmail") {
						t.Fatalf("wrong mismatch: %d %s", got.Code, got.Body.String())
					}
				}
			}
			expected := 1
			if sameGuest {
				expected = count
			}
			if successes != expected || len(ownerMeetings(t, h)) != 1 {
				t.Fatalf("successes %d, expected %d; meetings %+v", successes, expected, ownerMeetings(t, h))
			}
		})
	}
}

func TestFailedAttemptDoesNotBindIdentifierOrCacheFailure(t *testing.T) {
	for _, failure := range []string{"contacts", "start", "missing type", "conflict"} {
		t.Run(failure, func(t *testing.T) {
			h := calendarAt(t, "2026-11-15T12:00:00Z")
			id := publishType(t, h, 30)
			body := bookingBody("2026-11-16T10:00:00+03:00")
			failedBody, failedID, expected := body, id, 400
			switch failure {
			case "contacts":
				failedBody = strings.ReplaceAll(body, "Анна", "")
			case "start":
				failedBody = strings.ReplaceAll(body, "10:00:00", "08:00:00")
			case "missing type":
				failedID = "missing"
				expected = 404
			case "conflict":
				occupied := confirm(t, h, id, bookingBody("2026-11-16T09:00:00+03:00"))
				if occupied.Code != 201 {
					t.Fatal(occupied.Body.String())
				}
				failedBody = strings.ReplaceAll(body, "10:00:00", "09:00:00")
				expected = 409
			}
			failed := confirm(t, h, failedID, failedBody)
			if failed.Code != expected {
				t.Fatalf("expected definite failure %d: %d %s", expected, failed.Code, failed.Body.String())
			}
			corrected := confirm(t, h, id, body)
			if corrected.Code != 201 {
				t.Fatalf("failure bound identifier: %d %s", corrected.Code, corrected.Body.String())
			}
			// New independent attempts still conflict without disclosure.
			contender := strings.ReplaceAll(bookingBody("2026-11-16T10:00:00+03:00"), "anna@example.com", "boris@example.com")
			conflict := confirm(t, h, id, contender)
			if conflict.Code != 409 || strings.Contains(conflict.Body.String(), "anna@example.com") || !strings.Contains(conflict.Body.String(), `"availability"`) {
				t.Fatalf("contender: %d %s", conflict.Code, conflict.Body.String())
			}
		})
	}
}
