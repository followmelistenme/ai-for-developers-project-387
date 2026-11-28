package server_test

import (
	"encoding/json"
	"net/http"
	"slices"
	"sync"
	"testing"
)

func TestPublicationLimitAllowsRetryAfterCapacityIsFreed(t *testing.T) {
	for _, release := range []struct {
		name, method, suffix string
		status               int
	}{
		{"withdrawal", http.MethodPost, "/withdraw", http.StatusOK},
		{"deletion", http.MethodDelete, "", http.StatusNoContent},
	} {
		t.Run(release.name, func(t *testing.T) {
			h := calendarAt(t, "2026-11-15T12:00:00Z")
			first := publishType(t, h, 15)
			for range 4 {
				publishType(t, h, 30)
			}
			draft := createDraft(t, h, 45)
			firstPath := "/api/owner/meeting-types/" + first
			draftPublish := "/api/owner/meeting-types/" + draft + "/publish"

			got := request(h, http.MethodPost, draftPublish)
			var conflict struct{ Code, Message string }
			if got.Code != http.StatusConflict || json.Unmarshal(got.Body.Bytes(), &conflict) != nil ||
				conflict.Code != "publication_limit_reached" || conflict.Message != "Уже опубликовано 5 типов встреч. Снимите публикацию с одного из них и попробуйте снова" {
				t.Fatalf("publication limit: %d %s", got.Code, got.Body.String())
			}

			owner := request(h, http.MethodGet, "/api/owner/meeting-types")
			var types []struct{ ID, Status string }
			if owner.Code != http.StatusOK || json.Unmarshal(owner.Body.Bytes(), &types) != nil ||
				!slices.ContainsFunc(types, func(item struct{ ID, Status string }) bool { return item.ID == draft && item.Status == "draft" }) {
				t.Fatalf("rejected draft not preserved: %d %s", owner.Code, owner.Body.String())
			}
			if hidden := request(h, http.MethodGet, "/api/meeting-types/"+draft); hidden.Code != http.StatusNotFound {
				t.Fatalf("rejected draft visible to guests: %d %s", hidden.Code, hidden.Body.String())
			}

			alreadyPublished := request(h, http.MethodGet, "/api/meeting-types/"+first)
			repeated := request(h, http.MethodPost, firstPath+"/publish")
			if repeated.Code != http.StatusOK || repeated.Body.String() != alreadyPublished.Body.String() {
				t.Fatalf("repeat at capacity: %d %s", repeated.Code, repeated.Body.String())
			}
			if released := request(h, release.method, firstPath+release.suffix); released.Code != release.status {
				t.Fatalf("release publication: %d %s", released.Code, released.Body.String())
			}
			if retry := request(h, http.MethodPost, draftPublish); retry.Code != http.StatusOK {
				t.Fatalf("retry after release: %d %s", retry.Code, retry.Body.String())
			}
		})
	}
}

func TestConcurrentDraftsCompeteForLastPublication(t *testing.T) {
	h := calendarAt(t, "2026-11-15T12:00:00Z")
	for range 4 {
		publishType(t, h, 30)
	}
	drafts := [2]string{createDraft(t, h, 15), createDraft(t, h, 60)}
	var codes [2]int
	var workers sync.WaitGroup
	start := make(chan struct{})
	for i, id := range drafts {
		workers.Go(func() {
			<-start
			codes[i] = request(h, http.MethodPost, "/api/owner/meeting-types/"+id+"/publish").Code
		})
	}
	close(start)
	workers.Wait()
	slices.Sort(codes[:])
	if codes != [2]int{http.StatusOK, http.StatusConflict} {
		t.Fatalf("publication results: %v", codes)
	}
	guests := request(h, http.MethodGet, "/api/meeting-types")
	var published []struct{ ID string }
	if guests.Code != http.StatusOK || json.Unmarshal(guests.Body.Bytes(), &published) != nil || len(published) != 5 {
		t.Fatalf("guest catalogue: %d %s", guests.Code, guests.Body.String())
	}
}
