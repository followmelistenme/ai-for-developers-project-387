package server_test

import (
	"encoding/json"
	"fmt"
	"html"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/followmelistenme/ai-for-developers-project-387/backend/internal/server"
)

func TestNewServerStartsWithNoMeetingTypes(t *testing.T) {
	handler, err := server.New()
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/owner/meeting-types", nil))
	if response.Code != http.StatusOK || strings.TrimSpace(response.Body.String()) != "[]" {
		t.Fatalf("wanted empty list, got %d: %s", response.Code, response.Body.String())
	}
}

func TestCreatedDraftIsListedAndNewServerIsEmpty(t *testing.T) {
	handler, err := server.New()
	if err != nil {
		t.Fatal(err)
	}
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/owner/meeting-types", strings.NewReader(`{"name":"  Знакомство  ","description":"Короткий разговор","durationMinutes":30}`))
	request.Header.Set("Content-Type", "application/json")
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated {
		t.Fatalf("wanted 201, got %d: %s", response.Code, response.Body.String())
	}
	var created map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created["id"] == "" || created["id"] == nil || created["status"] != "draft" || created["name"] != "Знакомство" || created["description"] != "Короткий разговор" || created["durationMinutes"] != float64(30) {
		t.Fatalf("unexpected draft: %v", created)
	}
	listed := httptest.NewRecorder()
	handler.ServeHTTP(listed, httptest.NewRequest(http.MethodGet, "/api/owner/meeting-types", nil))
	var drafts []map[string]any
	if err := json.Unmarshal(listed.Body.Bytes(), &drafts); err != nil {
		t.Fatal(err)
	}
	if len(drafts) != 1 || drafts[0]["id"] != created["id"] {
		t.Fatalf("draft not listed: %s", listed.Body.String())
	}
	fresh, err := server.New()
	if err != nil {
		t.Fatal(err)
	}
	reset := httptest.NewRecorder()
	fresh.ServeHTTP(reset, httptest.NewRequest(http.MethodGet, "/api/owner/meeting-types", nil))
	if strings.TrimSpace(reset.Body.String()) != "[]" {
		t.Fatalf("new server retained data: %s", reset.Body.String())
	}
}

func TestInvalidDraftIsRejectedWithFieldErrorsAndNeverSaved(t *testing.T) {
	cases := []struct{ name, body, field string }{
		{"blank name", `{"name":" \t ","durationMinutes":30}`, "name"},
		{"long unicode name", `{"name":"` + strings.Repeat("я", 101) + `","durationMinutes":30}`, "name"},
		{"long unicode description", `{"name":"Звонок","description":"` + strings.Repeat("я", 501) + `","durationMinutes":30}`, "description"},
		{"unsupported duration", `{"name":"Звонок","durationMinutes":20}`, "durationMinutes"},
		{"wrong type", `{"name":"Звонок","durationMinutes":"30"}`, "durationMinutes"},
		{"missing name", `{"durationMinutes":30}`, "name"},
		{"missing duration", `{"name":"Звонок"}`, "durationMinutes"},
		{"null name", `{"name":null,"durationMinutes":30}`, "name"},
		{"null description", `{"name":"Звонок","description":null,"durationMinutes":30}`, "description"},
		{"oversized body", `{"name":"Звонок","description":"` + strings.Repeat("я", 1<<20) + `","durationMinutes":30}`, "body"},
		{"malformed JSON", `{"name":`, "body"},
		{"trailing JSON", `{"name":"Звонок","durationMinutes":30} {}`, "body"},
		{"extra field", `{"name":"Звонок","durationMinutes":30,"status":"published"}`, "body"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h, err := server.New()
			if err != nil {
				t.Fatal(err)
			}
			response := post(t, h, tc.body)
			if response.Code != http.StatusBadRequest {
				t.Fatalf("wanted 400, got %d: %s", response.Code, response.Body.String())
			}
			var problem struct {
				Message string
				Fields  map[string]string
			}
			if err := json.Unmarshal(response.Body.Bytes(), &problem); err != nil {
				t.Fatal(err)
			}
			if problem.Message == "" || problem.Fields[tc.field] == "" {
				t.Fatalf("missing field error %s: %s", tc.field, response.Body.String())
			}
			list := httptest.NewRecorder()
			h.ServeHTTP(list, httptest.NewRequest(http.MethodGet, "/api/owner/meeting-types", nil))
			if strings.TrimSpace(list.Body.String()) != "[]" {
				t.Fatalf("invalid draft saved: %s", list.Body.String())
			}
		})
	}
}

func post(t *testing.T, h http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodPost, "/api/owner/meeting-types", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(response, request)
	return response
}

func TestAllowedBoundariesAndDuplicateNamesCreateDistinctDrafts(t *testing.T) {
	h, err := server.New()
	if err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, duration := range []int{15, 30, 45, 60} {
		response := post(t, h, fmt.Sprintf(`{"name":"  %s  ","description":"%s","durationMinutes":%d}`, strings.Repeat("я", 100), strings.Repeat("🙂", 500), duration))
		if response.Code != http.StatusCreated {
			t.Fatalf("valid unicode boundaries rejected: %d %s", response.Code, response.Body.String())
		}
		var draft struct {
			ID, Name, Description, Status string
			DurationMinutes               int
		}
		if err := json.Unmarshal(response.Body.Bytes(), &draft); err != nil {
			t.Fatal(err)
		}
		if draft.ID == "" || ids[draft.ID] || draft.Name != strings.Repeat("я", 100) || draft.Description != strings.Repeat("🙂", 500) || draft.Status != "draft" || draft.DurationMinutes != duration {
			t.Fatalf("unexpected draft: %+v", draft)
		}
		ids[draft.ID] = true
	}
	response := post(t, h, `{"name":"я","durationMinutes":15}`)
	if response.Code != http.StatusCreated {
		t.Fatalf("single-character name and omitted description rejected: %s", response.Body.String())
	}
}

func TestConcurrentCreateAndListKeepsEveryDistinctDraft(t *testing.T) {
	h, err := server.New()
	if err != nil {
		t.Fatal(err)
	}
	const count = 24
	var workers sync.WaitGroup
	for range count {
		workers.Go(func() {
			response := post(t, h, `{"name":"Знакомство","durationMinutes":30}`)
			if response.Code != http.StatusCreated {
				t.Errorf("create: %d %s", response.Code, response.Body.String())
			}
			list := httptest.NewRecorder()
			h.ServeHTTP(list, httptest.NewRequest(http.MethodGet, "/api/owner/meeting-types", nil))
			if list.Code != http.StatusOK {
				t.Errorf("list: %d", list.Code)
			}
		})
	}
	workers.Wait()
	response := httptest.NewRecorder()
	h.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/owner/meeting-types", nil))
	var drafts []struct{ ID string }
	if err := json.Unmarshal(response.Body.Bytes(), &drafts); err != nil {
		t.Fatal(err)
	}
	ids := map[string]bool{}
	for _, draft := range drafts {
		if draft.ID == "" || ids[draft.ID] {
			t.Fatalf("duplicate or missing ID: %s", draft.ID)
		}
		ids[draft.ID] = true
	}
	if len(drafts) != count {
		t.Fatalf("wanted %d saved drafts, got %d", count, len(drafts))
	}
}

func TestContractDocumentationAndNoGuestDraftOrEditRoutes(t *testing.T) {
	h, err := server.New()
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/openapi.json", "/openapi.yaml", "/docs"} {
		response := httptest.NewRecorder()
		h.ServeHTTP(response, httptest.NewRequest(http.MethodGet, path, nil))
		if response.Code != http.StatusOK {
			t.Errorf("%s: wanted 200, got %d", path, response.Code)
		}
		if path == "/openapi.json" && !json.Valid(response.Body.Bytes()) {
			t.Error("OpenAPI JSON is invalid")
		}
		if path == "/docs" {
			body := html.UnescapeString(response.Body.String())
			for _, detail := range []string{
				"POST /api/owner/meeting-types",
				"Сохраняет новый черновик. Одинаковые названия разрешены. Черновики недоступны в гостевом интерфейсе.",
				"CreateMeetingType", "durationMinutes", `"maxLength": 500`,
				"Некорректный запрос; данные не сохранены", "ValidationError",
				"POST /api/owner/meeting-types/{meetingTypeId}/publish", "GET /api/meeting-types/{meetingTypeId}", "MeetingTypeNotFoundError",
				"Сообщения по полям name, description, durationMinutes, date, start, guestName, guestEmail; body для ошибки всего запроса.",
			} {
				if !strings.Contains(body, detail) {
					t.Errorf("documentation is missing contract detail %q", detail)
				}
			}
		}
	}
	created := post(t, h, `{"name":"Скрытый черновик","durationMinutes":30}`)
	var draft struct{ ID string }
	if err := json.Unmarshal(created.Body.Bytes(), &draft); err != nil {
		t.Fatal(err)
	}
	for _, request := range []struct{ method, path string }{
		{http.MethodGet, "/api/meeting-types/" + draft.ID},
		{http.MethodPatch, "/api/owner/meeting-types/" + draft.ID}, {http.MethodPut, "/api/owner/meeting-types/" + draft.ID},
	} {
		response := httptest.NewRecorder()
		h.ServeHTTP(response, httptest.NewRequest(request.method, request.path, nil))
		if response.Code != http.StatusNotFound {
			t.Errorf("unexpected route %s %s: %d", request.method, request.path, response.Code)
		}
	}
}

func TestPublicationMakesOnlyPublishedTypeAvailableToGuests(t *testing.T) {
	h, err := server.New()
	if err != nil {
		t.Fatal(err)
	}
	draft := post(t, h, `{"name":"Знакомство","description":"Обсудим планы","durationMinutes":45}`)
	var created struct{ ID string }
	if err := json.Unmarshal(draft.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{"/api/meeting-types/" + created.ID, "/api/meeting-types/missing"} {
		response := request(h, http.MethodGet, path)
		if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), `"message"`) {
			t.Fatalf("draft/unknown visible: %d %s", response.Code, response.Body.String())
		}
	}
	if response := request(h, http.MethodGet, "/api/meeting-types"); response.Code != http.StatusOK || strings.TrimSpace(response.Body.String()) != "[]" {
		t.Fatalf("draft listed: %d %s", response.Code, response.Body.String())
	}
	published := request(h, http.MethodPost, "/api/owner/meeting-types/"+created.ID+"/publish")
	if published.Code != http.StatusOK || !strings.Contains(published.Body.String(), `"status":"published"`) {
		t.Fatalf("publication: %d %s", published.Code, published.Body.String())
	}
	var publishedType struct {
		ID, Name, Description string
		DurationMinutes       int
	}
	if err := json.Unmarshal(published.Body.Bytes(), &publishedType); err != nil {
		t.Fatal(err)
	}
	if publishedType.ID != created.ID || publishedType.Name != "Знакомство" || publishedType.Description != "Обсудим планы" || publishedType.DurationMinutes != 45 {
		t.Fatalf("publication changed saved fields: %s", published.Body.String())
	}
	if detail := request(h, http.MethodGet, "/api/meeting-types/"+created.ID); detail.Body.String() != published.Body.String() {
		t.Fatalf("detail differs: %s", detail.Body.String())
	}
	list := request(h, http.MethodGet, "/api/meeting-types")
	if list.Code != http.StatusOK || strings.TrimSpace(list.Body.String()) != "["+strings.TrimSpace(published.Body.String())+"]" {
		t.Fatalf("published not listed: %d %s", list.Code, list.Body.String())
	}
	owner := request(h, http.MethodGet, "/api/owner/meeting-types")
	if owner.Body.String() != list.Body.String() {
		t.Fatalf("owner status not persisted: %s", owner.Body.String())
	}
}

func request(h http.Handler, method, path string) *httptest.ResponseRecorder {
	response := httptest.NewRecorder()
	h.ServeHTTP(response, httptest.NewRequest(method, path, nil))
	return response
}

func TestRepeatedAndConcurrentPublicationPreservesUniqueTypes(t *testing.T) {
	h, err := server.New()
	if err != nil {
		t.Fatal(err)
	}
	var ids []string
	for range 2 {
		created := post(t, h, `{"name":"Знакомство","durationMinutes":30}`)
		var item struct{ ID string }
		if err := json.Unmarshal(created.Body.Bytes(), &item); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, item.ID)
	}
	if ids[0] == ids[1] {
		t.Fatal("duplicate names share an identifier")
	}
	var workers sync.WaitGroup
	for range 24 {
		workers.Go(func() {
			for _, id := range ids {
				result := request(h, http.MethodPost, "/api/owner/meeting-types/"+id+"/publish")
				if result.Code != http.StatusOK {
					t.Errorf("publication: %d %s", result.Code, result.Body.String())
				}
				if got := request(h, http.MethodGet, "/api/meeting-types/"+id); got.Code != http.StatusOK || got.Body.String() != result.Body.String() {
					t.Errorf("published read changed: %s", got.Body.String())
				}
			}
			if got := request(h, http.MethodGet, "/api/meeting-types"); got.Code != http.StatusOK {
				t.Errorf("list: %d", got.Code)
			}
		})
	}
	workers.Wait()
	var listed []struct{ ID, Status string }
	result := request(h, http.MethodGet, "/api/meeting-types")
	if err := json.Unmarshal(result.Body.Bytes(), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed) != 2 || listed[0].ID != ids[0] || listed[1].ID != ids[1] || listed[0].Status != "published" || listed[1].Status != "published" {
		t.Fatalf("publication duplicated or reordered types: %s", result.Body.String())
	}
	unknown := request(h, http.MethodPost, "/api/owner/meeting-types/missing/publish")
	if unknown.Code != http.StatusNotFound || !strings.Contains(unknown.Body.String(), `"message"`) {
		t.Fatalf("unknown publication: %d %s", unknown.Code, unknown.Body.String())
	}
}
