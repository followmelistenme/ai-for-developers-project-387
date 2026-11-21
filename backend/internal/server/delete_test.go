package server_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/followmelistenme/ai-for-developers-project-387/backend/internal/server"
	"github.com/getkin/kin-openapi/openapi3"
	"github.com/getkin/kin-openapi/openapi3filter"
	"github.com/getkin/kin-openapi/routers/legacy"
)

func TestDeleteMeetingTypeInEveryStatePermanentlyRemovesOldLinks(t *testing.T) {
	for _, state := range []string{"draft", "published", "withdrawn"} {
		t.Run(state, func(t *testing.T) {
			h := calendarAt(t, "2026-11-15T12:00:00Z")
			created := post(t, h, `{"name":"Знакомство","durationMinutes":30}`)
			var item struct{ ID string }
			if err := json.Unmarshal(created.Body.Bytes(), &item); err != nil {
				t.Fatal(err)
			}
			path := "/api/owner/meeting-types/" + item.ID
			if state != "draft" {
				if got := request(h, http.MethodPost, path+"/publish"); got.Code != 200 {
					t.Fatal(got.Body.String())
				}
			}
			if state == "withdrawn" {
				if got := request(h, http.MethodPost, path+"/withdraw"); got.Code != 200 {
					t.Fatal(got.Body.String())
				}
			}
			got := request(h, http.MethodDelete, path)
			if got.Code != 204 || got.Body.Len() != 0 {
				t.Fatalf("delete: %d %s", got.Code, got.Body.String())
			}
			for _, id := range []string{item.ID, "unknown"} {
				if got := request(h, http.MethodDelete, "/api/owner/meeting-types/"+id); got.Code != 404 {
					t.Fatalf("repeat/unknown: %d", got.Code)
				}
			}
			for _, listPath := range []string{"/api/owner/meeting-types", "/api/meeting-types"} {
				if got := request(h, http.MethodGet, listPath); strings.TrimSpace(got.Body.String()) != "[]" {
					t.Fatal(got.Body.String())
				}
			}
			replacement := publishType(t, h, 30)
			if replacement == item.ID {
				t.Fatal("reused deleted ID")
			}
			for _, suffix := range []string{"", "/slots"} {
				if got := request(h, http.MethodGet, "/api/meeting-types/"+item.ID+suffix); got.Code != 404 {
					t.Fatalf("old link: %d %s", got.Code, got.Body.String())
				}
			}
			if got := confirm(t, h, item.ID, bookingBody("2026-11-16T09:00:00+03:00")); got.Code != 404 {
				t.Fatalf("deleted confirmation: %d", got.Code)
			}
			if len(ownerMeetings(t, h)) != 0 {
				t.Fatal("orphan meeting created")
			}
		})
	}
}

func TestAnyMeetingPreventsDeletionIncludingPastAndSavedAttemptsStayPrivate(t *testing.T) {
	for _, instant := range []string{"2026-11-15T12:00:00Z", "2026-11-16T06:15:00Z", "2026-12-01T12:00:00Z"} {
		t.Run(instant, func(t *testing.T) {
			now := time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC)
			h, err := server.NewWithClock(func() time.Time { return now })
			if err != nil {
				t.Fatal(err)
			}
			id := publishType(t, h, 30)
			body := bookingBody("2026-11-16T09:00:00+03:00")
			saved := confirm(t, h, id, body)
			if saved.Code != 201 {
				t.Fatal(saved.Body.String())
			}
			now, err = time.Parse(time.RFC3339, instant)
			if err != nil {
				t.Fatal(err)
			}
			path := "/api/owner/meeting-types/" + id
			for _, withdraw := range []bool{false, true} {
				if withdraw {
					if got := request(h, http.MethodPost, path+"/withdraw"); got.Code != 200 {
						t.Fatal(got.Body.String())
					}
				}
				got := request(h, http.MethodDelete, path)
				if got.Code != 409 || strings.TrimSpace(got.Body.String()) != `{"message":"Нельзя удалить тип встречи, по которому есть встречи"}` {
					t.Fatalf("meeting removed: %d %s", got.Code, got.Body.String())
				}
				replay := confirm(t, h, id, body)
				if replay.Code != 201 || replay.Body.String() != saved.Body.String() {
					t.Fatal("saved attempt lost")
				}
				other := confirm(t, h, id, strings.ReplaceAll(body, "anna@example.com", "other@example.com"))
				if other.Code != 400 || strings.Contains(other.Body.String(), "anna@example.com") || strings.Contains(other.Body.String(), "callUrl") {
					t.Fatalf("private replay: %d %s", other.Code, other.Body.String())
				}
			}
			listed := request(h, http.MethodGet, "/api/owner/meeting-types")
			if !strings.Contains(listed.Body.String(), id) {
				t.Fatal("meeting type lost")
			}
		})
	}
}

func TestConcurrentDeletionAndConfirmationNeverLeaveAnOrphan(t *testing.T) {
	for range 40 {
		h := calendarAt(t, "2026-11-15T12:00:00Z")
		id := publishType(t, h, 30)
		body := bookingBody("2026-11-16T09:00:00+03:00")
		start := make(chan struct{})
		booked := make(chan *httptest.ResponseRecorder, 1)
		deleted := make(chan *httptest.ResponseRecorder, 1)
		go func() { <-start; booked <- confirm(t, h, id, body) }()
		go func() { <-start; deleted <- request(h, http.MethodDelete, "/api/owner/meeting-types/"+id) }()
		close(start)
		b, d := <-booked, <-deleted
		meetings := ownerMeetings(t, h)
		switch {
		case d.Code == 204 && b.Code == 404:
			if len(meetings) != 0 {
				t.Fatal("orphan meeting")
			}
			if got := confirm(t, h, id, body); got.Code != 404 {
				t.Fatal("deleted type accepted retry")
			}
		case d.Code == 409 && b.Code == 201:
			if len(meetings) != 1 {
				t.Fatal("saved meeting lost")
			}
			replay := confirm(t, h, id, body)
			if replay.Code != 201 || replay.Body.String() != b.Body.String() {
				t.Fatal("saved attempt changed")
			}
			if got := request(h, http.MethodGet, "/api/meeting-types/"+id); got.Code != 200 {
				t.Fatal("saved meeting type lost")
			}
		default:
			t.Fatalf("invalid race: deletion %d %s; booking %d %s", d.Code, d.Body.String(), b.Code, b.Body.String())
		}
	}
}

func TestDeletionConflictMatchesServedOpenAPIContract(t *testing.T) {
	h := calendarAt(t, "2026-11-15T12:00:00Z")
	id := publishType(t, h, 30)
	if got := confirm(t, h, id, bookingBody("2026-11-16T09:00:00+03:00")); got.Code != 201 {
		t.Fatal(got.Body.String())
	}
	served := request(h, http.MethodGet, "/openapi.json")
	spec, err := openapi3.NewLoader().LoadFromData(served.Body.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	router, err := legacy.NewRouter(spec)
	if err != nil {
		t.Fatal(err)
	}
	input := httptest.NewRequest(http.MethodDelete, "/api/owner/meeting-types/"+id, nil)
	route, params, err := router.FindRoute(input)
	if err != nil {
		t.Fatal(err)
	}
	result := httptest.NewRecorder()
	h.ServeHTTP(result, input)
	if result.Code != 409 {
		t.Fatalf("expected conflict, got %d", result.Code)
	}
	response := &openapi3filter.ResponseValidationInput{
		RequestValidationInput: &openapi3filter.RequestValidationInput{Request: input, PathParams: params, Route: route},
		Status:                 result.Code, Header: result.Header(),
	}
	response.SetBodyBytes(result.Body.Bytes())
	if err := openapi3filter.ValidateResponse(context.Background(), response); err != nil {
		t.Fatalf("served 409 violates contract: %v", err)
	}
}
