package server_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/followmelistenme/ai-for-developers-project-387/backend/internal/server"
)

type availabilityResponse struct {
	ServerTime, TimeZone, WindowStart, WindowEnd, SelectedDate, NextWindowUpdate string
	Slots                                                                        []struct{ Start, End string }
}

func publishType(t *testing.T, h http.Handler, duration int) string {
	t.Helper()
	created := post(t, h, fmt.Sprintf(`{"name":"Звонок","durationMinutes":%d}`, duration))
	if created.Code != http.StatusCreated {
		t.Fatalf("create: %s", created.Body.String())
	}
	var item struct{ ID string }
	if err := json.Unmarshal(created.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	if got := request(h, http.MethodPost, "/api/owner/meeting-types/"+item.ID+"/publish"); got.Code != http.StatusOK {
		t.Fatal(got.Body.String())
	}
	return item.ID
}

func readSlots(t *testing.T, h http.Handler, id, query string) availabilityResponse {
	t.Helper()
	got := request(h, http.MethodGet, "/api/meeting-types/"+id+"/slots"+query)
	if got.Code != http.StatusOK {
		t.Fatalf("slots: %d %s", got.Code, got.Body.String())
	}
	var result availabilityResponse
	if err := json.Unmarshal(got.Body.Bytes(), &result); err != nil {
		t.Fatal(err)
	}
	return result
}

func TestSlotsDefaultToTomorrowInMoscowOnUTCHost(t *testing.T) {
	t.Setenv("TZ", "UTC")
	now := time.Date(2026, 12, 31, 22, 0, 0, 0, time.UTC)
	h, err := server.NewWithClock(func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	id := publishType(t, h, 30)
	got := readSlots(t, h, id, "")
	if got.NextWindowUpdate != "2027-01-02T00:00:00+03:00" {
		t.Fatalf("next window update: %s", got.NextWindowUpdate)
	}
	if got.TimeZone != "Europe/Moscow" || got.WindowStart != "2027-01-02" || got.WindowEnd != "2027-01-15" || got.SelectedDate != "2027-01-02" {
		t.Fatalf("wrong Moscow window: %+v", got)
	}
	instant, err := time.Parse(time.RFC3339, got.ServerTime)
	if err != nil || !instant.Equal(now) {
		t.Fatalf("server time: %s", got.ServerTime)
	}
	if len(got.Slots) != 18 || got.Slots[0].Start != "2027-01-02T09:00:00+03:00" || got.Slots[17].End != "2027-01-02T18:00:00+03:00" {
		t.Fatalf("wrong intervals: %+v", got.Slots)
	}
}

func TestSlotsRejectInvalidDatesWithDateError(t *testing.T) {
	h, err := server.NewWithClock(func() time.Time { return time.Date(2026, 11, 15, 12, 0, 0, 0, time.UTC) })
	if err != nil {
		t.Fatal(err)
	}
	id := publishType(t, h, 30)
	for _, date := range []string{"garbage", "2026-02-30", "2026-11-15", "2026-11-30", "2026-11-16T00:00:00Z", ""} {
		t.Run(date, func(t *testing.T) {
			got := request(h, http.MethodGet, "/api/meeting-types/"+id+"/slots?date="+date)
			var problem struct {
				Message string
				Fields  map[string]string
			}
			if err := json.Unmarshal(got.Body.Bytes(), &problem); err != nil {
				t.Fatal(err)
			}
			if got.Code != http.StatusBadRequest || problem.Message == "" || problem.Fields["date"] == "" {
				t.Fatalf("expected date error: %d %s", got.Code, got.Body.String())
			}
		})
	}
}

func TestSlotsWindowMovesAtMoscowMidnightOnSameHandler(t *testing.T) {
	now := time.Date(2026, 12, 31, 20, 59, 59, 0, time.UTC)
	calls := 0
	h, err := server.NewWithClock(func() time.Time { calls++; return now })
	if err != nil {
		t.Fatal(err)
	}
	id := publishType(t, h, 30)
	before := readSlots(t, h, id, "?date=2027-01-14")
	if before.WindowStart != "2027-01-01" || before.WindowEnd != "2027-01-14" || before.SelectedDate != "2027-01-14" {
		t.Fatalf("before midnight: %+v", before)
	}
	now = now.Add(time.Second)
	after := readSlots(t, h, id, "")
	if after.WindowStart != "2027-01-02" || after.WindowEnd != "2027-01-15" || after.SelectedDate != "2027-01-02" {
		t.Fatalf("after midnight: %+v", after)
	}
	if got := request(h, http.MethodGet, "/api/meeting-types/"+id+"/slots?date=2027-01-01"); got.Code != http.StatusBadRequest {
		t.Fatalf("yesterday's window accepted: %d", got.Code)
	}
	if calls != 3 {
		t.Fatalf("clock must be captured once per availability request: %d", calls)
	}
}

func TestSlotsAllDurationsStayOnHalfHourGridAndWithinWorkday(t *testing.T) {
	for _, tc := range []struct {
		duration, count    int
		lastStart, lastEnd string
	}{
		{15, 18, "17:30", "17:45"}, {30, 18, "17:30", "18:00"}, {45, 17, "17:00", "17:45"}, {60, 17, "17:00", "18:00"},
	} {
		t.Run(fmt.Sprint(tc.duration), func(t *testing.T) {
			h, err := server.NewWithClock(func() time.Time { return time.Date(2028, 2, 28, 10, 0, 0, 0, time.UTC) })
			if err != nil {
				t.Fatal(err)
			}
			id := publishType(t, h, tc.duration)
			got := readSlots(t, h, id, "?date=2028-02-29")
			if got.WindowStart != "2028-02-29" || got.WindowEnd != "2028-03-13" || len(got.Slots) != tc.count {
				t.Fatalf("leap year window/slot count: %+v", got)
			}
			if got.Slots[0].Start != "2028-02-29T09:00:00+03:00" || got.Slots[1].Start != "2028-02-29T09:30:00+03:00" || got.Slots[tc.count-1].Start != "2028-02-29T"+tc.lastStart+":00+03:00" || got.Slots[tc.count-1].End != "2028-02-29T"+tc.lastEnd+":00+03:00" {
				t.Fatalf("grid or final interval: %+v", got.Slots)
			}
			var previous time.Time
			for _, slot := range got.Slots {
				start, err := time.Parse(time.RFC3339, slot.Start)
				if err != nil {
					t.Fatal(err)
				}
				end, err := time.Parse(time.RFC3339, slot.End)
				if err != nil {
					t.Fatal(err)
				}
				if end.Sub(start) != time.Duration(tc.duration)*time.Minute || (!previous.IsZero() && start.Sub(previous) != 30*time.Minute) {
					t.Fatalf("wrong duration/grid: %+v", slot)
				}
				previous = start
			}
			repeated := readSlots(t, h, id, "?date=2028-02-29")
			if len(repeated.Slots) != tc.count || repeated.Slots[0] != got.Slots[0] {
				t.Fatal("reading slots reserved time")
			}
		})
	}
}

func TestSlotsDraftAndUnknownTypeAreUnavailable(t *testing.T) {
	h, err := server.New()
	if err != nil {
		t.Fatal(err)
	}
	created := post(t, h, `{"name":"Черновик","durationMinutes":30}`)
	var item struct{ ID string }
	if err := json.Unmarshal(created.Body.Bytes(), &item); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{item.ID, "missing"} {
		got := request(h, http.MethodGet, "/api/meeting-types/"+id+"/slots")
		if got.Code != http.StatusNotFound || !strings.Contains(got.Body.String(), `"message"`) {
			t.Fatalf("private type slots: %d %s", got.Code, got.Body.String())
		}
	}
}

func TestSlotsUseCalendarWorkHoursAcrossMoscowOffsetChange(t *testing.T) {
	h, err := server.NewWithClock(func() time.Time { return time.Date(2011, 3, 26, 12, 0, 0, 0, time.UTC) })
	if err != nil {
		t.Fatal(err)
	}
	id := publishType(t, h, 30)
	got := readSlots(t, h, id, "")
	if got.Slots[0].Start != "2011-03-27T09:00:00+04:00" || got.Slots[17].End != "2011-03-27T18:00:00+04:00" {
		t.Fatalf("offset change moved working hours: %+v", got.Slots)
	}
}
