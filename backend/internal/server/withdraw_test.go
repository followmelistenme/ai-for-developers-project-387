package server_test

import (
	"encoding/json"
	"github.com/followmelistenme/ai-for-developers-project-387/backend/internal/server"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestWithdrawalIsFinalAndIdempotentWithoutExposingClosedType(t *testing.T) {
	h := calendarAt(t, "2026-11-15T12:00:00Z")
	id := publishType(t, h, 45)
	path := "/api/owner/meeting-types/" + id
	before := request(h, http.MethodGet, "/api/meeting-types/"+id)
	got := request(h, http.MethodPost, path+"/withdraw")
	if got.Code != 200 {
		t.Fatalf("withdraw: %d %s", got.Code, got.Body.String())
	}
	var oldType, closedType map[string]any
	if err := json.Unmarshal(before.Body.Bytes(), &oldType); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal(got.Body.Bytes(), &closedType); err != nil {
		t.Fatal(err)
	}
	oldType["status"] = "withdrawn"
	if closedType["status"] != "withdrawn" || len(closedType) != len(oldType) {
		t.Fatalf("wrong state: %s", got.Body.String())
	}
	for key, value := range oldType {
		if closedType[key] != value {
			t.Fatalf("changed %s", key)
		}
	}
	repeat := request(h, http.MethodPost, path+"/withdraw")
	if repeat.Code != 200 || repeat.Body.String() != got.Body.String() {
		t.Fatalf("non-idempotent: %d %s", repeat.Code, repeat.Body.String())
	}
	if republish := request(h, http.MethodPost, path+"/publish"); republish.Code != 409 {
		t.Fatalf("revived: %d %s", republish.Code, republish.Body.String())
	}
	list := request(h, http.MethodGet, "/api/owner/meeting-types")
	if !strings.Contains(list.Body.String(), `"status":"withdrawn"`) {
		t.Fatal(list.Body.String())
	}
	for _, suffix := range []string{"", "/slots"} {
		response := request(h, http.MethodGet, "/api/meeting-types/"+id+suffix)
		if response.Code != 410 || strings.TrimSpace(response.Body.String()) != `{"message":"Запись на этот тип встречи закрыта"}` {
			t.Fatalf("closed guest read: %d %s", response.Code, response.Body.String())
		}
	}
	if catalog := request(h, http.MethodGet, "/api/meeting-types"); strings.TrimSpace(catalog.Body.String()) != "[]" {
		t.Fatal(catalog.Body.String())
	}
}

func TestWithdrawalRejectsNewAttemptButPreservesSavedConfirmationsAndBusyTime(t *testing.T) {
	now := time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
	h, err := server.NewWithClock(func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	id := publishType(t, h, 45)
	pastBody := bookingBody("2026-11-16T09:30:00+03:00")
	futureBody := bookingBody("2026-11-20T09:30:00+03:00")
	past := confirm(t, h, id, pastBody)
	future := confirm(t, h, id, futureBody)
	if past.Code != 201 || future.Code != 201 {
		t.Fatal("setup confirmations failed")
	}
	// Withdrawal happens after one meeting has ended; even past attempts remain retrievable.
	now = time.Date(2026, 11, 17, 12, 0, 0, 0, time.UTC)
	if got := request(h, http.MethodPost, "/api/owner/meeting-types/"+id+"/withdraw"); got.Code != 200 {
		t.Fatal(got.Body.String())
	}
	for _, saved := range []struct{ body, response string }{{pastBody, past.Body.String()}, {futureBody, future.Body.String()}} {
		got := confirm(t, h, id, saved.body)
		if got.Code != 201 || got.Body.String() != saved.response {
			t.Fatalf("saved replay lost: %d %s", got.Code, got.Body.String())
		}
	}
	got := confirm(t, h, id, bookingBody("2026-11-20T11:00:00+03:00"))
	if got.Code != 410 || strings.TrimSpace(got.Body.String()) != `{"message":"Запись на этот тип встречи закрыта"}` {
		t.Fatalf("new attempt not closed: %d %s", got.Code, got.Body.String())
	}
	for _, body := range []string{strings.ReplaceAll(futureBody, "anna@example.com", "other@example.com"), strings.ReplaceAll(futureBody, "Анна", "Борис"), strings.ReplaceAll(futureBody, "09:30:00", "11:00:00")} {
		mismatch := confirm(t, h, id, body)
		if mismatch.Code != 400 || !strings.Contains(mismatch.Body.String(), `"attemptId"`) {
			t.Fatalf("mismatch: %d %s", mismatch.Code, mismatch.Body.String())
		}
		for _, private := range []string{"anna@example.com", "Анна", "guestName", "guestEmail", "callUrl", `"id"`} {
			if strings.Contains(mismatch.Body.String(), private) {
				t.Fatalf("leaked %s", private)
			}
		}
	}
	listed := ownerMeetings(t, h)
	if len(listed) != 1 || listed[0].Start != "2026-11-20T09:30:00+03:00" {
		t.Fatalf("future meeting lost: %+v", listed)
	}
	for _, duration := range []int{15, 30, 45, 60} {
		other := publishType(t, h, duration)
		slots := readSlots(t, h, other, "?date=2026-11-20")
		for _, slot := range slots.Slots {
			if slot.Start == "2026-11-20T09:30:00+03:00" || slot.Start == "2026-11-20T10:00:00+03:00" || (duration > 30 && slot.Start == "2026-11-20T09:00:00+03:00") {
				t.Fatalf("duration %d offers retained busy time: %+v", duration, slot)
			}
		}
	}
}

func TestDraftAndUnknownWithdrawalDoNotChangeVisibility(t *testing.T) {
	h := calendarAt(t, "2026-11-15T12:00:00Z")
	created := post(t, h, `{"name":"Черновик","durationMinutes":30}`)
	var draft struct{ ID string }
	if err := json.Unmarshal(created.Body.Bytes(), &draft); err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		id     string
		status int
	}{{draft.ID, 409}, {"unknown", 404}} {
		got := request(h, http.MethodPost, "/api/owner/meeting-types/"+tc.id+"/withdraw")
		if got.Code != tc.status {
			t.Fatalf("withdraw %s: %d %s", tc.id, got.Code, got.Body.String())
		}
		for _, suffix := range []string{"", "/slots"} {
			if got := request(h, http.MethodGet, "/api/meeting-types/"+tc.id+suffix); got.Code != 404 {
				t.Fatalf("hidden type read: %d %s", got.Code, got.Body.String())
			}
		}
		if got := confirm(t, h, tc.id, bookingBody("2026-11-16T09:00:00+03:00")); got.Code != 404 {
			t.Fatalf("hidden type confirmed: %d %s", got.Code, got.Body.String())
		}
	}
	list := request(h, http.MethodGet, "/api/owner/meeting-types")
	if !strings.Contains(list.Body.String(), `"status":"draft"`) {
		t.Fatal(list.Body.String())
	}
	if got := request(h, http.MethodPost, "/api/owner/meeting-types/"+draft.ID+"/publish"); got.Code != 200 {
		t.Fatal(got.Body.String())
	}
}

func TestConcurrentWithdrawalAndConfirmationAreLinearizable(t *testing.T) {
	for range 40 {
		h := calendarAt(t, "2026-11-15T12:00:00Z")
		id := publishType(t, h, 30)
		body := bookingBody("2026-11-16T09:00:00+03:00")
		start := make(chan struct{})
		booked := make(chan *httptest.ResponseRecorder, 1)
		withdrawn := make(chan *httptest.ResponseRecorder, 1)
		go func() { <-start; booked <- confirm(t, h, id, body) }()
		go func() { <-start; withdrawn <- request(h, http.MethodPost, "/api/owner/meeting-types/"+id+"/withdraw") }()
		close(start)
		first, closed := <-booked, <-withdrawn
		if closed.Code != 200 {
			t.Fatalf("withdraw failed: %d %s", closed.Code, closed.Body.String())
		}
		meetings := ownerMeetings(t, h)
		switch first.Code {
		case 201:
			if len(meetings) != 1 {
				t.Fatalf("saved first meeting lost: %+v", meetings)
			}
			replay := confirm(t, h, id, body)
			if replay.Code != 201 || replay.Body.String() != first.Body.String() {
				t.Fatal("saved race winner cannot replay")
			}
		case 410:
			if len(meetings) != 0 {
				t.Fatal("withdraw-first created a meeting")
			}
		default:
			t.Fatalf("nonlinearizable confirmation: %d %s", first.Code, first.Body.String())
		}
		if next := confirm(t, h, id, bookingBody("2026-11-16T10:00:00+03:00")); next.Code != 410 {
			t.Fatalf("closed type accepted a later confirmation: %d", next.Code)
		}
	}
}

func TestConcurrentPublicationCannotReviveWithdrawnType(t *testing.T) {
	for range 40 {
		h := calendarAt(t, "2026-11-15T12:00:00Z")
		id := publishType(t, h, 30)
		start := make(chan struct{})
		published := make(chan *httptest.ResponseRecorder, 1)
		withdrawn := make(chan *httptest.ResponseRecorder, 1)
		path := "/api/owner/meeting-types/" + id
		go func() { <-start; published <- request(h, http.MethodPost, path+"/publish") }()
		go func() { <-start; withdrawn <- request(h, http.MethodPost, path+"/withdraw") }()
		close(start)
		p, w := <-published, <-withdrawn
		if w.Code != 200 || (p.Code != 200 && p.Code != 409) {
			t.Fatalf("invalid race: publish %d, withdraw %d", p.Code, w.Code)
		}
		if got := request(h, http.MethodGet, "/api/meeting-types/"+id); got.Code != 410 {
			t.Fatalf("revived after race: %d %s", got.Code, got.Body.String())
		}
		if got := request(h, http.MethodPost, path+"/publish"); got.Code != 409 {
			t.Fatalf("revived after race retry: %d", got.Code)
		}
	}
}
